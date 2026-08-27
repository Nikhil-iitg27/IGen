import secrets
import uuid

from django.db import models


class Job(models.Model):
    class Status(models.TextChoices):
        PENDING = "PENDING"        # in our queue, not yet sent to RunPod
        IN_QUEUE = "IN_QUEUE"      # sent to RunPod, RunPod says queued
        IN_PROGRESS = "IN_PROGRESS"
        COMPLETED = "COMPLETED"
        FAILED = "FAILED"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.PENDING)
    payload = models.JSONField()
    runpod_job_id = models.CharField(max_length=64, null=True, blank=True)
    image = models.TextField(null=True, blank=True)
    error = models.TextField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    dispatched_at = models.DateTimeField(null=True, blank=True)
    completed_at = models.DateTimeField(null=True, blank=True)
    # From RunPod's /status response (top-level delayTime/executionTime,
    # both ms) -- delayTime is RunPod's own queue/cold-start wait, distinct
    # from our own dispatched_at->completed_at window which also includes
    # our polling cadence.
    runpod_delay_time_ms = models.IntegerField(null=True, blank=True)
    runpod_execution_time_ms = models.IntegerField(null=True, blank=True)

    def __str__(self):
        return f"Job({self.id}, {self.status})"


class AccessKey(models.Model):
    """
    Gates the API behind a passkey. Two independent scopes -- "app" (the
    Generate/Inpaint flow) and "metrics" -- so access to one can be issued
    or revoked without touching the other. Deliberately DB-backed, not an
    env var: an env var can't revoke one person's access without changing
    the value for everyone. Managed via Django admin, not a custom UI.
    """

    class Scope(models.TextChoices):
        APP = "app"
        METRICS = "metrics"

    key = models.CharField(max_length=64, unique=True, blank=True)
    label = models.CharField(max_length=100, help_text="Who this was issued to.")
    scope = models.CharField(max_length=10, choices=Scope.choices)
    revoked = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)
    last_used_at = models.DateTimeField(null=True, blank=True)
    # Minimum seconds required between this key's generation requests --
    # 0 (default) means no cooldown. This is a property of the key itself,
    # not its label: "label" is just a human-readable note (e.g. "guest
    # for so-and-so"), it has no functional effect. Only enforced on
    # generate_image (view.py), not on status polling or metrics.
    cooldown_seconds = models.PositiveIntegerField(default=0)

    def save(self, *args, **kwargs):
        # Leave "key" blank in admin and a strong random one is generated
        # automatically -- 24 bytes (48 hex chars) of entropy, no realistic
        # collision risk against the unique constraint.
        if not self.key:
            self.key = secrets.token_hex(24)
        super().save(*args, **kwargs)

    def __str__(self):
        return f"{self.label} ({self.scope}){' [revoked]' if self.revoked else ''}"
