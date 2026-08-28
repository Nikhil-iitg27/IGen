# Backend – Django + Gunicorn

This is the backend for IGen: a Django REST API, backed by Postgres, that sits between the frontend and the GPU inference server. It is not a synchronous proxy — every generation request becomes a row in a job queue, and a background dispatcher thread is what actually talks to the inference server, one job at a time. That design exists because a single RunPod GPU pod can only run one generation at a time, and a real HTTP request/response cycle would otherwise have to sit open for however long generation takes; queuing the work instead lets the frontend submit instantly and poll for the result, and lets the backend apply backpressure (reject, not queue forever) once too much work has piled up.

---

## Project Structure

```
backend/
├── manage.py
├── requirements.txt
├── .env                        # local secrets/config, gitignored
├── backend/
│   ├── settings.py             # DB selection, CORS, HTTPS/cookie hardening
│   ├── urls.py
│   ├── asgi.py
│   └── wsgi.py
└── igen/
    ├── models.py                # Job, AccessKey
    ├── views.py                 # generate/status/metrics/verify-key endpoints
    ├── dispatcher.py            # claims jobs, calls the Pod, purges old images
    ├── apps.py                  # starts the dispatcher thread on boot
    ├── auth.py                  # X-Access-Key scope gate, IP rate limiting
    ├── db_utils.py               # SQLite-lock retry helper
    ├── admin.py
    ├── migrations/
    └── tests.py
```

`dispatcher.py` and `apps.py` are where the actual job-processing logic lives — worth reading first if you're trying to understand how a request goes from "submitted" to "an image comes back."

---

## Request Lifecycle

A generation request never runs inline inside the view that receives it. Instead:

1. `POST /api/igen/generate/` (requires `X-Access-Key` for the `app` scope) validates the payload, checks the requesting key's cooldown, and — if the queue isn't already full — creates a `Job` row with `status=PENDING` and returns immediately with `{"job_id", "status", "queue_position"}`.
2. A background thread (started in `apps.py`'s `AppConfig.ready()`, one per Gunicorn worker) polls the database every `DISPATCH_POLL_INTERVAL_SECONDS`, atomically claims the oldest `PENDING` job (`select_for_update(skip_locked=True)`, so concurrent workers never double-claim), and calls the inference server's `/inference` endpoint directly over TCP.
3. That call blocks until the Pod actually finishes — there's no separate "submitted vs. done" state on the Pod side — so the dispatcher writes the final outcome straight onto the same `Job` row: `COMPLETED` (with the image), `FAILED` (a genuine error response or network failure), or `TIMEOUT` (the Pod didn't respond within `DISPATCH_TIMEOUT_SECONDS`, 300s).
4. The frontend polls `GET /api/igen/status/<job_id>/` (same `app`-scope key) until it sees one of those terminal states.

If the queue is already at `MAX_QUEUE_DEPTH` when step 1 runs, the request is rejected outright: a `Job` row is still written (`status=REJECTED`) so the rejection is permanent, queryable history, but the request never enters the dispatch queue and gets a `429` back immediately instead of waiting. This bounded-queue behavior — and what it actually costs in wait time vs. rejection rate under load — is measured in the [root README's stress test section](../README.md#stress-test-results).

Two more endpoints round out the API: `POST /api/igen/verify-key/` checks whether a key is valid for a scope without using it (this is what the frontend's passkey gate calls before it has a confirmed-good key), and `GET /api/igen/metrics/summary/` / `GET /api/igen/metrics/jobs/` (both `metrics`-scope) expose aggregate and per-job outcome/latency data for exactly this kind of analysis.

---

## Access Control

Every endpoint except `/verify-key/` requires an `X-Access-Key` header matching a non-revoked `AccessKey` row of the right scope. There are two independent scopes — `app` (Generate/Inpaint) and `metrics` — so one can be issued or revoked without touching the other, and each key can carry its own `cooldown_seconds` (minimum time between that key's generation requests). Keys are managed through Django admin (`/admin/`), not an env var, specifically so access can be granted or revoked per-person without redeploying. `/verify-key/` itself is rate-limited per IP, since it's the one endpoint someone could otherwise hammer to brute-force a key.

---

## Setup Instructions

### 1. Prerequisites
- Python 3.10+
- pip

### 2. Install dependencies

```bash
pip install -r requirements.txt
```

### 3. Configure environment

Create a `.env` file in `backend/` (see `backend/settings.py` and `igen/dispatcher.py`/`views.py`/`apps.py` for how each is read):

| Variable | Purpose | Default |
| --- | --- | --- |
| `DEBUG` | Django debug mode; also gates HTTPS/cookie hardening (only enforced when `False`) | `False` |
| `ALLOWED_HOSTS` | Comma-separated host list | empty |
| `CORS_ALLOWED_ORIGINS` | Comma-separated frontend origin(s) | empty |
| `DATABASE_URL` | Postgres connection string; omitted → falls back to local SQLite | unset |
| `POD_INFERENCE_URL` | The Pod's `/inference` URL | — required |
| `POD_API_KEY` | Bearer token sent to the Pod | — required |
| `MAX_QUEUE_DEPTH` | Jobs allowed in `PENDING`+`IN_PROGRESS` before new requests are rejected | `20` |
| `MAX_CONCURRENT_DISPATCHED` | Jobs dispatched at once (matches GPU count) | `1` |
| `DISPATCH_POLL_INTERVAL_SECONDS` | How often the dispatcher checks for new work | `2` |
| `IMAGE_RETENTION_DAYS` | How long a completed job's image blob is kept before being purged | `3` |
| `PURGE_INTERVAL_SECONDS` | How often the retention purge runs | `3600` |

Without `DATABASE_URL` set, the backend runs against a local SQLite file — useful for development, but the job queue's DB-backed state needs Postgres to actually survive restarts/multiple workers in production.

### 4. Migrate and run

```bash
python manage.py migrate
python manage.py runserver
```

---

## Deployment (Render + Gunicorn)

In production this same app runs under Gunicorn:

```bash
gunicorn backend.wsgi
```

Render is configured to run `migrate` and start Gunicorn on every deploy — the dispatcher thread deliberately does *not* start during `migrate` itself (`apps.py` checks `sys.argv` for this), since starting it before migrations finish would try to query tables that don't exist yet. Set the environment variables from the table above in Render's dashboard; `DATABASE_URL` is provided automatically if you provision a Render Postgres instance and attach it to this service.

---

## Acknowledgements

- [Django](https://www.djangoproject.com/)
- [Gunicorn](https://gunicorn.org/)
- [PostgreSQL](https://www.postgresql.org/)
- [Render](https://render.com/)

---

## License

This project is for research and educational purposes. See the root `LICENSE` file for details.
