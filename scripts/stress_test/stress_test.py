"""
Bursty-load stress test for the IGen backend's job queue.

Sequentially runs one test per arrival-rate level: submits jobs at
Poisson-process arrivals (exponential inter-arrival, mean = the level's
RATE_LEVELS_MEAN_SECONDS entry) for RUN_DURATION_SECONDS, drains
outstanding jobs, then pulls authoritative created_at/dispatched_at/
completed_at timestamps from /metrics/jobs/ (server-side ground truth,
not reconstructed from local polling) to compute wait time, service
time, and blocking/timeout/failure rates.

Requires two env vars: IGEN_APP_KEY, IGEN_METRICS_KEY.
Usage: python stress_test.py
"""

import csv
import json
import os
import random
import statistics
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone

import requests

BASE_URL = os.environ.get("IGEN_BASE_URL", "https://igen-sdql.onrender.com")
APP_KEY = os.environ.get("IGEN_APP_KEY")
METRICS_KEY = os.environ.get("IGEN_METRICS_KEY")

RATE_LEVELS_MEAN_SECONDS = [8, 5, 3, 2, 1]
RUN_DURATION_SECONDS = 300
COOLDOWN_BETWEEN_RUNS_SECONDS = 15
DRAIN_TIMEOUT_SECONDS = 900
POLL_INTERVAL_SECONDS = 2
SUBMIT_CONCURRENCY = 50
DRAIN_CONCURRENCY = 20
METRICS_PAGE_SAFETY_LIMIT = 500

JOB_PAYLOAD = {
    "prompt": "a photo of a mountain landscape at sunrise",
    "unprompt": "",
    "steps": 30,
    "seed": 42,
    "strength": 0.9,
    "do_scale": True,
    "scale": 8,
}

RESULTS_DIR = os.path.join(os.path.dirname(__file__), "results")

TERMINAL_STATUSES = {"COMPLETED", "FAILED", "TIMEOUT"}


def submit_job(session):
    submitted_at = time.time()
    try:
        resp = session.post(
            f"{BASE_URL}/api/igen/generate/",
            json=JOB_PAYLOAD,
            headers={"X-Access-Key": APP_KEY},
            timeout=15,
        )
    except requests.RequestException as exc:
        return {"id": None, "submitted_at": submitted_at, "outcome": "submit_error", "detail": str(exc)}

    if resp.status_code == 200:
        return {"id": resp.json().get("job_id"), "submitted_at": submitted_at, "outcome": "admitted"}
    if resp.status_code == 429:
        data = resp.json() if resp.content else {}
        return {"id": data.get("job_id"), "submitted_at": submitted_at, "outcome": "rejected"}
    return {"id": None, "submitted_at": submitted_at, "outcome": f"submit_error_{resp.status_code}"}


def run_arrivals(session, mean_seconds, duration):
    """Fires submissions at Poisson-process arrival times for `duration` seconds."""
    records = []
    end_time = time.time() + duration
    with ThreadPoolExecutor(max_workers=SUBMIT_CONCURRENCY) as pool:
        futures = []
        while time.time() < end_time:
            time.sleep(random.expovariate(1 / mean_seconds))
            futures.append(pool.submit(submit_job, session))
        for future in futures:
            records.append(future.result())
    return records


def drain(session, admitted_ids):
    """Polls admitted jobs until each reaches a terminal status, or DRAIN_TIMEOUT_SECONDS elapses."""
    unresolved = set(admitted_ids)
    deadline = time.time() + DRAIN_TIMEOUT_SECONDS

    def check(job_id):
        try:
            resp = session.get(
                f"{BASE_URL}/api/igen/status/{job_id}/",
                headers={"X-Access-Key": APP_KEY},
                timeout=15,
            )
            return job_id, resp.json().get("status") if resp.status_code == 200 else None
        except requests.RequestException:
            return job_id, None

    with ThreadPoolExecutor(max_workers=DRAIN_CONCURRENCY) as pool:
        while unresolved and time.time() < deadline:
            for job_id, status in pool.map(check, list(unresolved)):
                if status in TERMINAL_STATUSES:
                    unresolved.discard(job_id)
            if unresolved:
                time.sleep(POLL_INTERVAL_SECONDS)
    return unresolved  # whatever's left timed out on the drain wait itself, not a job outcome


def fetch_metrics_rows(session, ids_needed, run_start):
    found = {}
    page = 1
    while ids_needed and page <= METRICS_PAGE_SAFETY_LIMIT:
        resp = session.get(
            f"{BASE_URL}/api/igen/metrics/jobs/",
            params={"page": page},
            headers={"X-Access-Key": METRICS_KEY},
            timeout=30,
        )
        data = resp.json()
        results = data.get("results", [])
        if not results:
            break
        for row in results:
            if row["id"] in ids_needed:
                found[row["id"]] = row
                ids_needed.discard(row["id"])
        oldest_created = datetime.fromisoformat(results[-1]["created_at"])
        if oldest_created < run_start:
            break
        if page >= data.get("num_pages", page):
            break
        page += 1
    return found


def percentile(values, pct):
    if not values:
        return None
    ordered = sorted(values)
    k = (len(ordered) - 1) * pct
    f, c = int(k), min(int(k) + 1, len(ordered) - 1)
    return round(ordered[f] + (ordered[c] - ordered[f]) * (k - f), 3)


def summarize(mean_seconds, records, metrics_rows, unresolved_after_drain):
    admitted = [r for r in records if r["outcome"] == "admitted"]
    rejected = [r for r in records if r["outcome"] == "rejected"]
    submit_errors = [r for r in records if r["outcome"].startswith("submit_error")]

    wait_times, service_times, total_latencies = [], [], []
    by_status = {"COMPLETED": 0, "FAILED": 0, "TIMEOUT": 0, "unresolved": len(unresolved_after_drain)}
    for row in metrics_rows.values():
        status = row["status"]
        if status in by_status:
            by_status[status] += 1
        if row["dispatched_at"]:
            dispatched = datetime.fromisoformat(row["dispatched_at"])
            created = datetime.fromisoformat(row["created_at"])
            wait_times.append((dispatched - created).total_seconds())
            if row["completed_at"]:
                completed = datetime.fromisoformat(row["completed_at"])
                service_times.append((completed - dispatched).total_seconds())
                total_latencies.append((completed - created).total_seconds())

    total_offered = len(admitted) + len(rejected)
    return {
        "mean_interarrival_seconds": mean_seconds,
        "jobs_offered": total_offered,
        "jobs_admitted": len(admitted),
        "jobs_rejected": len(rejected),
        "submit_errors": len(submit_errors),
        "blocking_probability": round(len(rejected) / total_offered, 4) if total_offered else None,
        "outcome_counts": by_status,
        "completion_rate": round(by_status["COMPLETED"] / len(admitted), 4) if admitted else None,
        "timeout_rate": round(by_status["TIMEOUT"] / len(admitted), 4) if admitted else None,
        "failed_rate": round(by_status["FAILED"] / len(admitted), 4) if admitted else None,
        "avg_wait_seconds": round(statistics.mean(wait_times), 3) if wait_times else None,
        "p95_wait_seconds": percentile(wait_times, 0.95),
        "avg_service_seconds": round(statistics.mean(service_times), 3) if service_times else None,
        "p95_service_seconds": percentile(service_times, 0.95),
        "avg_total_latency_seconds": round(statistics.mean(total_latencies), 3) if total_latencies else None,
        "p95_total_latency_seconds": percentile(total_latencies, 0.95),
    }


def run_one_level(session, mean_seconds):
    print(f"\n=== mean inter-arrival {mean_seconds}s, {RUN_DURATION_SECONDS}s window ===")
    run_start = datetime.now(timezone.utc)
    records = run_arrivals(session, mean_seconds, RUN_DURATION_SECONDS)
    admitted_ids = {r["id"] for r in records if r["outcome"] == "admitted" and r["id"]}
    print(f"offered={len(records)} admitted={len(admitted_ids)}; draining...")

    unresolved = drain(session, admitted_ids)
    if unresolved:
        print(f"WARNING: {len(unresolved)} job(s) still not terminal after drain timeout.")

    metrics_rows = fetch_metrics_rows(session, set(admitted_ids), run_start)
    summary = summarize(mean_seconds, records, metrics_rows, unresolved)
    print(json.dumps(summary, indent=2))

    stamp = run_start.strftime("%Y%m%dT%H%M%SZ")
    with open(os.path.join(RESULTS_DIR, f"{stamp}_mean{mean_seconds}s.json"), "w") as f:
        json.dump({"summary": summary, "records": records, "metrics_rows": metrics_rows}, f, indent=2)

    return summary


def main():
    os.makedirs(RESULTS_DIR, exist_ok=True)
    session = requests.Session()
    summaries = []
    for i, mean_seconds in enumerate(RATE_LEVELS_MEAN_SECONDS):
        summaries.append(run_one_level(session, mean_seconds))
        if i < len(RATE_LEVELS_MEAN_SECONDS) - 1:
            time.sleep(COOLDOWN_BETWEEN_RUNS_SECONDS)

    csv_path = os.path.join(RESULTS_DIR, "summary.csv")
    with open(csv_path, "w", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=[k for k in summaries[0] if k != "outcome_counts"])
        writer.writeheader()
        for s in summaries:
            writer.writerow({k: v for k, v in s.items() if k != "outcome_counts"})
    print(f"\nAll runs complete. Combined summary: {csv_path}")


if __name__ == "__main__":
    if "IGEN_APP_KEY" not in os.environ or "IGEN_METRICS_KEY" not in os.environ:
        sys.exit("Set IGEN_APP_KEY and IGEN_METRICS_KEY env vars before running.")
    main()
