import logging
import os
from datetime import timedelta
from django.db import transaction
from django.utils import timezone
import requests

from .db_utils import retry_on_db_lock
from .models import Job

logger = logging.getLogger(__name__)

# Free-tier Postgres, so the Job.image TEXT blob (a full base64 PNG) can't
# accumulate forever -- clear it after this many days. The Job row itself
# is kept (metrics history stays intact), only the heavy payload is dropped.
IMAGE_RETENTION_DAYS = int(os.environ.get("IMAGE_RETENTION_DAYS", "3"))

# The StableDiffusion Pod's /inference endpoint, e.g.
# http://<pod-public-ip>:<mapped-port>/inference -- direct TCP, not the
# RunPod HTTP Proxy (which has a hard 100s timeout, too short for real
# generation calls). See docs/13-pod-deployment-guide.md.
POD_INFERENCE_URL = os.getenv("POD_INFERENCE_URL")
POD_API_KEY = os.getenv("POD_API_KEY")

# Generous: this call blocks for the actual generation time now (no more
# fast "submit and get a job id back" like RunPod Serverless's /run was).
DISPATCH_TIMEOUT_SECONDS = 300


def pod_headers():
    return {
        "Authorization": f"Bearer {POD_API_KEY}",
        "Content-Type": "application/json",
    }


def dispatch_job(job: Job) -> Job:
    """
    Send a PENDING job straight to the Pod's /inference endpoint and
    write the final result onto the job -- there's no async job-id/status
    abstraction on a Pod like Serverless had, so this call blocks until
    the image is actually done (or fails) and IS the completion, not a
    submission.
    """
    job.status = Job.Status.IN_PROGRESS
    job.dispatched_at = timezone.now()
    retry_on_db_lock(job.save, update_fields=["status", "dispatched_at"])

    try:
        response = requests.post(
            POD_INFERENCE_URL,
            headers=pod_headers(),
            json=job.payload,
            timeout=DISPATCH_TIMEOUT_SECONDS,
        )
        response_data = response.json() if response.content else {}

        if not response.ok:
            logger.error(f"Pod /inference failed for job {job.id}: {response.status_code} {response_data}")
            job.status = Job.Status.FAILED
            job.error = response_data.get("error", f"Inference failed with status {response.status_code}")
        elif "error" in response_data:
            job.status = Job.Status.FAILED
            job.error = response_data["error"]
        else:
            job.status = Job.Status.COMPLETED
            job.image = response_data.get("image")

    except requests.exceptions.Timeout:
        logger.exception(f"Pod did not respond within {DISPATCH_TIMEOUT_SECONDS}s for job {job.id}.")
        job.status = Job.Status.TIMEOUT
        job.error = "The inference server took too long to respond. Please try again shortly."
    except requests.exceptions.RequestException:
        # The raw exception text can contain the Pod's internal IP/port
        # (and on Windows, a raw object repr) -- fine for our own logs,
        # not something a client should ever see. Full detail goes to
        # the log only; the client gets a generic, safe message.
        logger.exception(f"Network error dispatching job {job.id} to the Pod.")
        job.status = Job.Status.FAILED
        job.error = "Could not reach the inference server. Please try again shortly."

    job.completed_at = timezone.now()
    retry_on_db_lock(job.save)
    return job


def count_in_flight() -> int:
    return Job.objects.filter(status=Job.Status.IN_PROGRESS).count()


def purge_stale_images():
    """Clear the `image` blob off Job rows older than IMAGE_RETENTION_DAYS."""
    cutoff = timezone.now() - timedelta(days=IMAGE_RETENTION_DAYS)

    def _purge():
        return (
            Job.objects.filter(completed_at__lt=cutoff)
            .exclude(image__isnull=True)
            .exclude(image="")
            .update(image=None)
        )

    updated = retry_on_db_lock(_purge)
    if updated:
        logger.info(f"Purged images from {updated} job(s) older than {IMAGE_RETENTION_DAYS} days.")


def claim_next_pending_job():
    """Atomically claim one PENDING job, or None if there isn't one to claim."""

    def _claim():
        with transaction.atomic():
            job = (
                Job.objects.select_for_update(skip_locked=True)
                .filter(status=Job.Status.PENDING)
                .order_by("created_at")
                .first()
            )
            if job is None:
                return None
            # Mark it claimed inside the same lock so no other thread grabs
            # it while dispatch_job() makes the (unlocked, long-running)
            # network call to the Pod.
            job.status = Job.Status.IN_PROGRESS
            job.save(update_fields=["status"])
            return job

    return retry_on_db_lock(_claim)
