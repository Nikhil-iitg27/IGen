from functools import wraps

from django.core.cache import cache
from django.http import JsonResponse
from django.utils import timezone

from .db_utils import retry_on_db_lock
from .models import AccessKey


def require_scope(scope):
    """
    Gate a view behind an AccessKey of the given scope, read from the
    X-Access-Key header. Two independent scopes exist (app, metrics) so
    access to one can be issued/revoked without affecting the other.

    Attaches the resolved AccessKey to request.access_key so a view can
    inspect it afterward (e.g. generate_image checking cooldown_seconds)
    without a second lookup.
    """

    def decorator(view_func):
        @wraps(view_func)
        def wrapped(request, *args, **kwargs):
            key = request.headers.get("X-Access-Key")
            if not key:
                return JsonResponse({"error": "Access key required."}, status=401)
            try:
                access_key = AccessKey.objects.get(key=key, scope=scope, revoked=False)
            except AccessKey.DoesNotExist:
                return JsonResponse({"error": "Invalid or revoked access key."}, status=401)
            # Captured before overwriting -- a cooldown check (generate_image)
            # needs "when was this key last used before *this* request",
            # not the timestamp this same call is about to write.
            request.access_key_previous_used_at = access_key.last_used_at
            access_key.last_used_at = timezone.now()
            retry_on_db_lock(access_key.save, update_fields=["last_used_at"])
            request.access_key = access_key
            return view_func(request, *args, **kwargs)

        return wrapped

    return decorator


def client_ip(request):
    # Render (and most PaaS) sit behind a proxy -- the real client IP is
    # the first entry in X-Forwarded-For when present, REMOTE_ADDR only
    # reflects the proxy itself otherwise.
    forwarded = request.META.get("HTTP_X_FORWARDED_FOR")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.META.get("REMOTE_ADDR", "unknown")


def rate_limited(request, *, bucket, max_attempts, window_seconds):
    """
    Simple per-IP sliding-window-ish limiter using Django's cache
    (in-memory by default). Best-effort, not perimeter-grade: resets on
    process restart and doesn't share state across multiple worker
    processes if this ever scales beyond one Gunicorn worker -- acceptable
    here since the actual security boundary is the key's own entropy
    (48 hex chars); this just slows down a determined brute-force attempt,
    it doesn't need to be airtight to be worth having.
    """
    cache_key = f"ratelimit:{bucket}:{client_ip(request)}"
    attempts = cache.get(cache_key, 0)
    if attempts >= max_attempts:
        return True
    cache.set(cache_key, attempts + 1, timeout=window_seconds)
    return False
