/** Turns a job's status + queue_position into a human message, instead of a blind spinner. */
export function queueStatusText(status, queuePosition) {
  if (status === "PENDING") {
    if (queuePosition > 0) {
      return `Service is busy — ${queuePosition} job${queuePosition > 1 ? "s" : ""} ahead of you...`;
    }
    return "Starting shortly...";
  }
  if (status === "IN_PROGRESS") {
    return "Generating your image...";
  }
  return null;
}
