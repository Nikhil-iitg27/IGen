import { useCallback, useEffect, useRef, useState } from "react";
import { saveImage } from "../utils/imageGallery";
import { appClient } from "../utils/apiClient";

const JOB_STORAGE_KEY = "igen_job_id";
const SUBMIT_TS_STORAGE_KEY = "igen_job_submitted_at";
const POLL_INTERVAL_MS = 2000;

/**
 * Shared submit/poll/resume logic for a single in-flight generation job.
 * Used by both the plain Generate flow and the Inpaint flow -- one job at
 * a time, app-wide, same model the original Prompt.jsx had.
 *
 * The in-flight job id/timestamp live in sessionStorage, not
 * localStorage: sessionStorage is isolated per tab (unlike localStorage,
 * which is shared across every tab of the origin), so two tabs each
 * tracking their own job no longer clobber each other's stored id, while
 * a reload of the same tab still resumes correctly (sessionStorage
 * survives a reload, only clearing when the tab actually closes).
 *
 * `source` (e.g. "generate"/"inpaint") is just metadata tagged onto the
 * image when it's saved to the persistent gallery -- lets a future
 * gallery view distinguish where a result came from.
 *
 * `autoSave` (default true): whether a COMPLETED job's image is saved to
 * the gallery automatically. The Inpaint flow passes false -- its result
 * is only the fixed-size edited window, not the full photo, so
 * InpaintEditor.jsx saves explicitly once the user picks which version
 * (cropped-only or composited back into the original) to keep.
 */
export default function useGenerationJob(source, { autoSave = true } = {}) {
  const [status, setStatus] = useState(null);
  const [image, setImage] = useState(null);
  const [error, setError] = useState(null);
  const [queuePosition, setQueuePosition] = useState(null);
  const [latencyMs, setLatencyMs] = useState(null);

  const pollTimer = useRef(null);
  const submittedAtRef = useRef(null);

  const stopPolling = useCallback(() => {
    if (pollTimer.current) {
      clearInterval(pollTimer.current);
      pollTimer.current = null;
    }
  }, []);

  const finish = useCallback(
    (finalStatus, data) => {
      stopPolling();
      sessionStorage.removeItem(JOB_STORAGE_KEY);
      sessionStorage.removeItem(SUBMIT_TS_STORAGE_KEY);
      setStatus(finalStatus);
      if (submittedAtRef.current) {
        setLatencyMs(Date.now() - submittedAtRef.current);
      }
      if (finalStatus === "COMPLETED" && data.image) {
        const dataUrl = `data:image/png;base64,${data.image}`;
        setImage(dataUrl);
        if (autoSave) saveImage(dataUrl, { source });
      }
      if (finalStatus === "FAILED" || finalStatus === "TIMEOUT") {
        setError(data.error || "Generation failed.");
      }
    },
    [stopPolling, source, autoSave]
  );

  const pollJobStatus = useCallback(
    (jobId) => {
      stopPolling();
      pollTimer.current = setInterval(async () => {
        try {
          const response = await appClient.get(`/api/igen/status/${jobId}/`);
          const data = response.data;
          setQueuePosition(data.queue_position ?? null);
          if (data.status === "COMPLETED" || data.status === "FAILED" || data.status === "TIMEOUT") {
            finish(data.status, data);
          } else {
            setStatus(data.status);
          }
        } catch (err) {
          console.error("Error polling job status:", err);
        }
      }, POLL_INTERVAL_MS);
    },
    [finish, stopPolling]
  );

  // Resume a leftover job on mount/reload instead of orphaning it.
  useEffect(() => {
    const storedJobId = sessionStorage.getItem(JOB_STORAGE_KEY);
    if (storedJobId) {
      const storedSubmittedAt = sessionStorage.getItem(SUBMIT_TS_STORAGE_KEY);
      submittedAtRef.current = storedSubmittedAt ? Number(storedSubmittedAt) : null;
      setStatus("PENDING");
      pollJobStatus(storedJobId);
    }
    return stopPolling;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const submit = useCallback(
    async (payload) => {
      setError(null);
      setImage(null);
      setLatencyMs(null);
      setQueuePosition(null);
      setStatus("PENDING");
      submittedAtRef.current = Date.now();
      try {
        const response = await appClient.post("/api/igen/generate/", payload, {
          headers: { "Content-Type": "application/json" },
        });
        const jobId = response.data.job_id;
        setQueuePosition(response.data.queue_position ?? null);
        if (jobId) {
          sessionStorage.setItem(JOB_STORAGE_KEY, jobId);
          sessionStorage.setItem(SUBMIT_TS_STORAGE_KEY, String(submittedAtRef.current));
          pollJobStatus(jobId);
        } else {
          setStatus(null);
        }
      } catch (err) {
        console.error("Error submitting job:", err);
        setStatus(null);
        // Surface specific server messages (e.g. a key's cooldown, or the
        // verify-key-style rate limit) instead of a generic failure --
        // both come back as {error: "..."} from the backend.
        setError(err.response?.data?.error || "Failed to submit generation request.");
      }
    },
    [pollJobStatus]
  );

  const isBusy = status !== null && status !== "COMPLETED" && status !== "FAILED" && status !== "TIMEOUT";

  // Clears the current result (e.g. after re-importing it as a new
  // source image) without touching any in-flight job -- there isn't one
  // once a result exists, so this is just local state cleanup.
  const reset = useCallback(() => {
    setStatus(null);
    setImage(null);
    setError(null);
    setLatencyMs(null);
    setQueuePosition(null);
  }, []);

  return { submit, status, image, error, queuePosition, latencyMs, isBusy, reset };
}
