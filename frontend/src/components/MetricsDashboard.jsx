import React, { useCallback, useEffect, useState } from "react";
import style from "./assets/MetricsDashboard.module.css";
import { metricsClient } from "../utils/apiClient";

function formatSeconds(value) {
  return value == null ? "—" : `${value.toFixed(2)}s`;
}

function formatMs(value) {
  return value == null ? "—" : `${Math.round(value)}ms`;
}

function MetricsDashboard() {
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState(null);
  const [showJobs, setShowJobs] = useState(false);
  const [jobs, setJobs] = useState(null);

  const loadSummary = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const response = await metricsClient.get("/api/igen/metrics/summary/");
      setSummary(response.data);
    } catch (err) {
      console.error("Error loading metrics summary:", err);
      setLoadError("Failed to load metrics.");
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    loadSummary();
  }, [loadSummary]);

  async function toggleJobs() {
    const next = !showJobs;
    setShowJobs(next);
    if (next && !jobs) {
      try {
        const response = await metricsClient.get("/api/igen/metrics/jobs/");
        setJobs(response.data.results);
      } catch (err) {
        console.error("Error loading raw jobs:", err);
      }
    }
  }

  return (
    <div className={style.mainContent}>
      <div className={style.headerRow}>
        <h2 className={style.heading}>Generation stats</h2>
        <button className={style.refreshButton} onClick={loadSummary} disabled={loading}>
          {loading ? "Refreshing…" : "Refresh"}
        </button>
      </div>

      {loadError && <p className={style.errorText}>{loadError}</p>}

      <div className={style.cardRow}>
        {summary && (
          <div className={style.card}>
            <dl className={style.statList}>
              <dt>Jobs</dt>
              <dd>{summary.total_jobs}</dd>
              <dt>Completed</dt>
              <dd>{summary.completed}</dd>
              <dt>Failed</dt>
              <dd>{summary.failed}</dd>
              <dt>Pending now</dt>
              <dd>{summary.pending_now}</dd>
              <dt>Avg total latency</dt>
              <dd>{formatSeconds(summary.avg_total_latency_seconds)}</dd>
              <dt>Avg queue wait</dt>
              <dd>{formatSeconds(summary.avg_queue_wait_seconds)}</dd>
              <dt>Avg RunPod delay</dt>
              <dd>{formatMs(summary.avg_runpod_delay_time_ms)}</dd>
              <dt>Avg RunPod execution</dt>
              <dd>{formatMs(summary.avg_runpod_execution_time_ms)}</dd>
            </dl>
          </div>
        )}
      </div>

      <button className={style.jobsToggle} onClick={toggleJobs} type="button">
        {showJobs ? "Hide raw jobs" : "Show raw jobs"}
      </button>

      {showJobs && jobs && (
        <div className={style.jobsTableWrapper}>
          <table className={style.jobsTable}>
            <thead>
              <tr>
                <th>ID</th>
                <th>Status</th>
                <th>Created</th>
                <th>Dispatched</th>
                <th>Completed</th>
                <th>RunPod delay</th>
                <th>RunPod exec</th>
              </tr>
            </thead>
            <tbody>
              {jobs.map((job) => (
                <tr key={job.id}>
                  <td>{job.id.slice(0, 8)}</td>
                  <td>{job.status}</td>
                  <td>{job.created_at ? new Date(job.created_at).toLocaleTimeString() : "—"}</td>
                  <td>{job.dispatched_at ? new Date(job.dispatched_at).toLocaleTimeString() : "—"}</td>
                  <td>{job.completed_at ? new Date(job.completed_at).toLocaleTimeString() : "—"}</td>
                  <td>{formatMs(job.runpod_delay_time_ms)}</td>
                  <td>{formatMs(job.runpod_execution_time_ms)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default MetricsDashboard;
