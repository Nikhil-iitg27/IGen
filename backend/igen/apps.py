import logging
import os
import sys
import threading
import time

from django.apps import AppConfig

logger = logging.getLogger(__name__)

DISPATCH_POLL_INTERVAL_SECONDS = float(os.environ.get("DISPATCH_POLL_INTERVAL_SECONDS", "2"))
PURGE_INTERVAL_SECONDS = float(os.environ.get("PURGE_INTERVAL_SECONDS", "3600"))


class IgenConfig(AppConfig):
    default_auto_field = 'django.db.models.BigAutoField'
    name = 'igen'

    def ready(self):
        # ready() fires for every manage.py command, not just the ones
        # that actually serve requests -- including `migrate` itself,
        # which starting a thread during is actively wrong (it can start
        # dispatching/purging against tables migrate hasn't created yet;
        # this really happened on the first Render deploy: "relation
        # igen_job does not exist" mid-migrate). Only start the thread
        # for the real serving process: gunicorn (no manage.py in
        # sys.argv[0] at all), or manage.py runserver specifically -- and
        # even then only in runserver's actual child process, not the
        # autoreloader's parent watcher (RUN_MAIN='true' identifies the
        # child; under gunicorn or any other manage.py command RUN_MAIN
        # is never set).
        if "manage.py" in sys.argv[0]:
            if "runserver" not in sys.argv:
                return
            if os.environ.get("RUN_MAIN") != "true":
                return
        threading.Thread(target=self._dispatch_loop, daemon=True).start()

    def _dispatch_loop(self):
        # Imported lazily so this only touches the DB/app registry once
        # Django has fully finished starting up.
        from .dispatcher import claim_next_pending_job, dispatch_job, count_in_flight, purge_stale_images

        logger.info("Dispatcher thread started.")
        last_purge_at = 0.0
        while True:
            try:
                # Piggybacks on this already-running loop rather than a
                # separate thread/cron -- gated to once/hour so the purge
                # query doesn't run on every ~2s dispatch tick.
                now = time.monotonic()
                if now - last_purge_at >= PURGE_INTERVAL_SECONDS:
                    purge_stale_images()
                    last_purge_at = now
                # Every PENDING job goes through this loop -- a Pod's
                # /inference call blocks for the real generation time, so
                # there's no separate "fast inline path" possible for a
                # view to take instead (see generate_image in views.py).
                # There used to be a "direct vs queued" dispatch_mode
                # toggle; it was retired once the Pod migration made both
                # modes behaviorally identical (single GPU, single
                # dispatch thread either way) -- see docs/09/13.
                #
                # MAX_CONCURRENT_DISPATCHED defaults to 1, matching the
                # physical reality of one GPU on one Pod. It mainly
                # matters when Gunicorn runs multiple worker processes
                # (each with its own copy of this thread, see ready()'s
                # docstring) -- count_in_flight() is a shared DB read, so
                # it stops two different processes' threads from both
                # trying to dispatch to the single Pod at once.
                max_in_flight = int(os.environ.get("MAX_CONCURRENT_DISPATCHED", "1"))
                if count_in_flight() < max_in_flight:
                    job = claim_next_pending_job()
                    if job is not None:
                        dispatch_job(job)
                        continue  # check for another job immediately
            except Exception:
                logger.exception("Dispatcher loop iteration failed.")
            time.sleep(DISPATCH_POLL_INTERVAL_SECONDS)
