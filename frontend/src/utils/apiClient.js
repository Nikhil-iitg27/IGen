import axios from "axios";

const backendUrl = import.meta.env.VITE_BACKEND_URL;

export const APP_KEY_STORAGE = "igen_app_key";
export const METRICS_KEY_STORAGE = "igen_metrics_key";

function clientFor(storageKey) {
  const instance = axios.create({ baseURL: backendUrl });
  instance.interceptors.request.use((config) => {
    const key = localStorage.getItem(storageKey);
    if (key) config.headers["X-Access-Key"] = key;
    return config;
  });
  return instance;
}

// Two independent clients -- app-scoped requests (generate/status) never
// send the metrics key and vice versa, matching the two independent,
// separately-revocable AccessKey scopes on the backend.
export const appClient = clientFor(APP_KEY_STORAGE);
export const metricsClient = clientFor(METRICS_KEY_STORAGE);

/** Checks a key against a scope without requiring one already -- this IS the pre-auth check. */
export async function verifyKey(key, scope) {
  const response = await axios.post(`${backendUrl}/api/igen/verify-key/`, { key, scope });
  return response.data.valid === true;
}
