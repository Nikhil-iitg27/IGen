import React, { useEffect, useState } from "react";
import { verifyKey } from "../utils/apiClient";
import style from "./assets/AccessGate.module.css";

/**
 * Gates its children behind a passkey of the given scope. Reusable for
 * both the whole-app gate and the Metrics tab's separate gate -- same
 * check/store/retry logic either way, just a different scope+storageKey.
 */
function AccessGate({ scope, storageKey, title, children }) {
  const [status, setStatus] = useState("checking"); // checking | locked | unlocked
  const [input, setInput] = useState("");
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    const stored = localStorage.getItem(storageKey);
    if (!stored) {
      setStatus("locked");
      return;
    }
    // Re-verify on load, not just "a value exists" -- a revoked key would
    // otherwise still pass this UI gate (real enforcement is server-side
    // regardless, but the UI should reflect revocation honestly too).
    verifyKey(stored, scope)
      .then((valid) => {
        if (valid) {
          setStatus("unlocked");
        } else {
          localStorage.removeItem(storageKey);
          setStatus("locked");
        }
      })
      .catch((err) => {
        console.error("Error verifying stored access key:", err);
        setStatus("locked");
      });
  }, [scope, storageKey]);

  async function handleSubmit(e) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const valid = await verifyKey(input.trim(), scope);
      if (valid) {
        localStorage.setItem(storageKey, input.trim());
        setStatus("unlocked");
      } else {
        setError("Invalid or revoked key.");
      }
    } catch (err) {
      console.error("Error verifying access key:", err);
      setError("Could not reach the server to verify the key.");
    }
    setSubmitting(false);
  }

  if (status === "checking") return null;
  if (status === "unlocked") return children;

  return (
    <div className={style.gateWrapper}>
      <form className={style.gateForm} onSubmit={handleSubmit}>
        <h2 className={style.gateTitle}>{title}</h2>
        <input
          type="password"
          className={style.gateInput}
          placeholder="Enter access key..."
          value={input}
          onChange={(e) => setInput(e.target.value)}
          autoFocus
        />
        <button className={style.gateButton} type="submit" disabled={submitting || !input}>
          {submitting ? "Checking..." : "Unlock"}
        </button>
        {error && <p className={style.gateError}>{error}</p>}
      </form>
    </div>
  );
}

export default AccessGate;
