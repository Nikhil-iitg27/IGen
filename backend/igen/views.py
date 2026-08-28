import json
import logging
import os

from django.core.paginator import Paginator
from django.http import JsonResponse
from django.utils import timezone
from django.views.decorators.csrf import csrf_exempt
from dotenv import load_dotenv

from .auth import rate_limited, require_scope
from .models import AccessKey, Job

# --- Load Environment Variables ---
load_dotenv()

# --- Configure Logging ---
logger = logging.getLogger(__name__)
logging.basicConfig(level=logging.DEBUG, format='[%(asctime)s] %(levelname)s: %(message)s')

VERIFY_KEY_MAX_ATTEMPTS = 10
VERIFY_KEY_WINDOW_SECONDS = 60
MAX_QUEUE_DEPTH = int(os.environ.get("MAX_QUEUE_DEPTH", "20"))


def _queue_position(job: Job) -> int:
    """
    How many jobs are ahead of this one -- any IN_PROGRESS job (blocking
    the one GPU right now) plus PENDING jobs created earlier (the order
    the background dispatcher claims them in). 0 once this job is no
    longer waiting.
    """
    if job.status != Job.Status.PENDING:
        return 0
    ahead_in_progress = Job.objects.filter(status=Job.Status.IN_PROGRESS).count()
    ahead_pending = Job.objects.filter(
        status=Job.Status.PENDING, created_at__lt=job.created_at
    ).count()
    return ahead_in_progress + ahead_pending


@csrf_exempt
@require_scope(AccessKey.Scope.APP)
def generate_image(request):
    if request.method != "POST":
        logger.warning("Non-POST request received.")
        return JsonResponse({"error": "Only POST method is allowed."}, status=405)

    access_key = request.access_key
    if access_key.cooldown_seconds and request.access_key_previous_used_at:
        elapsed = (timezone.now() - request.access_key_previous_used_at).total_seconds()
        if elapsed < access_key.cooldown_seconds:
            remaining = int(access_key.cooldown_seconds - elapsed)
            return JsonResponse({
                "error": f"This key is on cooldown. Try again in {remaining}s.",
            }, status=429)

    try:
        try:
            body = request.body.decode("utf-8")
            data = json.loads(body)
        except json.JSONDecodeError:
            logger.error("Invalid JSON received.")
            return JsonResponse({"error": "Invalid JSON format."}, status=400)

        prompt = data.get("prompt")
        if not prompt:
            logger.warning("Missing prompt in request.")
            return JsonResponse({"error": "Prompt is required."}, status=400)

        payload = {
            "prompt": prompt,
            "unprompt": data.get("unprompt", ""),
            "steps": int(data.get("steps", 50)),
            "seed": int(data.get("seed", 42)),
            "strength": float(data.get("strength", 0.9)),
            "do_scale": bool(data.get("do_scale", True)),
            "scale": float(data.get("scale", 8)),
        }

        # Optional inpainting inputs -- base64 PNGs, forwarded as-is.
        # Django doesn't decode/validate these, same as every other field
        # here; StableDiffusion/app/api.py is what interprets them.
        if data.get("image"):
            payload["image"] = data["image"]
        if data.get("mask"):
            payload["mask"] = data["mask"]

        in_queue = Job.objects.filter(
            status__in=[Job.Status.PENDING, Job.Status.IN_PROGRESS]
        ).count()
        if in_queue >= MAX_QUEUE_DEPTH:
            return JsonResponse({"error": "Queue is full. Please try again shortly."}, status=429)

        # Always PENDING, dispatched by the background thread
        # (igen/apps.py) -- never inline here. A Pod's /inference call
        # blocks for the full generation time, so calling dispatch_job()
        # directly in this request/response cycle would reintroduce the
        # exact blocking-request problem the async redesign fixed.
        job = Job.objects.create(status=Job.Status.PENDING, payload=payload)
        logger.info(f"Job {job.id} created.")

        return JsonResponse({
            "job_id": str(job.id),
            "status": job.status,
            "queue_position": _queue_position(job),
        })

    except Exception as e:
        logger.exception("Unexpected error in generate_image view.")
        return JsonResponse({
            "error": "Unexpected error occurred.",
            "details": str(e),
        }, status=500)


@csrf_exempt
@require_scope(AccessKey.Scope.APP)
def job_status(request, job_id):
    """
    A straight DB lookup -- unlike the RunPod Serverless version, there's
    no external job-id/status API to poll anymore. The background thread
    (igen/apps.py -> dispatcher.dispatch_job) is the only thing that talks
    to the Pod, and it writes the final result straight onto this row
    when the Pod responds. This view just reads whatever's there.
    """
    if request.method != "GET":
        return JsonResponse({"error": "Only GET method is allowed."}, status=405)

    try:
        job = Job.objects.get(id=job_id)
    except (Job.DoesNotExist, ValueError):
        return JsonResponse({"error": "Job not found."}, status=404)

    return _job_response(job)


@csrf_exempt
def verify_key(request):
    """
    Checks whether a key is valid for a scope, without granting anything
    itself -- deliberately not behind require_scope, since this IS the
    pre-auth check the frontend's passkey gate calls before it has a
    known-good key to send. Doesn't update last_used_at (that only
    happens on real, authenticated use via require_scope). Rate-limited
    per IP since this is the one endpoint someone could hammer to guess
    a key.
    """
    if request.method != "POST":
        return JsonResponse({"error": "Only POST method is allowed."}, status=405)

    if rate_limited(
        request,
        bucket="verify_key",
        max_attempts=VERIFY_KEY_MAX_ATTEMPTS,
        window_seconds=VERIFY_KEY_WINDOW_SECONDS,
    ):
        return JsonResponse({"error": "Too many attempts. Try again later."}, status=429)

    try:
        data = json.loads(request.body.decode("utf-8"))
    except json.JSONDecodeError:
        return JsonResponse({"valid": False}, status=400)

    key = data.get("key")
    scope = data.get("scope")
    if not key or scope not in AccessKey.Scope.values:
        return JsonResponse({"valid": False}, status=400)

    valid = AccessKey.objects.filter(key=key, scope=scope, revoked=False).exists()
    return JsonResponse({"valid": valid})


def _job_response(job: Job) -> JsonResponse:
    result = {"status": job.status, "queue_position": _queue_position(job)}
    if job.status == Job.Status.COMPLETED:
        result["image"] = job.image
    elif job.status == Job.Status.FAILED:
        result["error"] = job.error
    return JsonResponse(result)


def _avg(values):
    return round(sum(values) / len(values), 3) if values else None


@csrf_exempt
@require_scope(AccessKey.Scope.METRICS)
def metrics_summary(request):
    """Overall aggregates -- no more direct-vs-queued split, that toggle had no remaining behavioral effect."""
    if request.method != "GET":
        return JsonResponse({"error": "Only GET method is allowed."}, status=405)

    jobs = Job.objects.all()
    completed = jobs.filter(status=Job.Status.COMPLETED)

    total_latencies, queue_waits, delay_times, exec_times = [], [], [], []
    for job in completed.only(
        "created_at", "dispatched_at", "completed_at",
        "runpod_delay_time_ms", "runpod_execution_time_ms",
    ):
        if job.completed_at:
            total_latencies.append((job.completed_at - job.created_at).total_seconds())
        if job.dispatched_at:
            queue_waits.append((job.dispatched_at - job.created_at).total_seconds())
        if job.runpod_delay_time_ms is not None:
            delay_times.append(job.runpod_delay_time_ms)
        if job.runpod_execution_time_ms is not None:
            exec_times.append(job.runpod_execution_time_ms)

    return JsonResponse({
        "total_jobs": jobs.count(),
        "completed": completed.count(),
        "failed": jobs.filter(status=Job.Status.FAILED).count(),
        "pending_now": jobs.filter(status=Job.Status.PENDING).count(),
        "avg_total_latency_seconds": _avg(total_latencies),
        "avg_queue_wait_seconds": _avg(queue_waits),
        "avg_runpod_delay_time_ms": _avg(delay_times),
        "avg_runpod_execution_time_ms": _avg(exec_times),
    })


@csrf_exempt
@require_scope(AccessKey.Scope.METRICS)
def metrics_jobs(request):
    """Paginated raw job rows, for exporting your own charts/analysis."""
    if request.method != "GET":
        return JsonResponse({"error": "Only GET method is allowed."}, status=405)

    jobs = Job.objects.all().order_by("-created_at")

    paginator = Paginator(jobs, 50)
    page = paginator.get_page(request.GET.get("page", 1))

    results = [
        {
            "id": str(job.id),
            "status": job.status,
            "created_at": job.created_at.isoformat(),
            "dispatched_at": job.dispatched_at.isoformat() if job.dispatched_at else None,
            "completed_at": job.completed_at.isoformat() if job.completed_at else None,
            "runpod_delay_time_ms": job.runpod_delay_time_ms,
            "runpod_execution_time_ms": job.runpod_execution_time_ms,
        }
        for job in page.object_list
    ]

    return JsonResponse({
        "page": page.number,
        "num_pages": paginator.num_pages,
        "total_jobs": paginator.count,
        "results": results,
    })
