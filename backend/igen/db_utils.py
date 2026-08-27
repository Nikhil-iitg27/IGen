import logging
import time

from django.db.utils import OperationalError

logger = logging.getLogger(__name__)

DB_RETRY_ATTEMPTS = 3
DB_RETRY_BASE_DELAY_SECONDS = 0.5  # doubles each attempt: 0.5s, 1s, 2s


def retry_on_db_lock(fn, *args, **kwargs):
    """
    Retry `fn(*args, **kwargs)` a few times with exponential backoff if it
    raises a "database is locked" OperationalError.

    This is mainly a safety net for local SQLite, where the background
    dispatcher thread and a web request can race for the same file-level
    lock (see docs/10-postgres-deployment.md). Postgres uses real row-level
    locking via select_for_update(skip_locked=True) and shouldn't hit this
    under normal operation -- the retry is cheap insurance against any
    transient DB hiccup (e.g. a brief reconnect), not a substitute for
    using Postgres.

    Any OperationalError that isn't a lock error is re-raised immediately
    without retrying, since retrying wouldn't help.
    """
    for attempt in range(1, DB_RETRY_ATTEMPTS + 1):
        try:
            return fn(*args, **kwargs)
        except OperationalError as e:
            is_lock_error = "locked" in str(e).lower()
            if not is_lock_error or attempt == DB_RETRY_ATTEMPTS:
                raise
            delay = DB_RETRY_BASE_DELAY_SECONDS * (2 ** (attempt - 1))
            logger.warning(
                f"DB locked (attempt {attempt}/{DB_RETRY_ATTEMPTS}), "
                f"retrying in {delay}s: {e}"
            )
            time.sleep(delay)
