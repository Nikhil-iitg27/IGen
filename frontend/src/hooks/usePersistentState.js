import { useEffect, useState } from "react";

/**
 * Like useState, but the value survives a reload of the same tab via
 * sessionStorage. Deliberately sessionStorage, not localStorage -- two
 * tabs each editing their own draft shouldn't clobber each other's
 * stored value (see the same reasoning in useGenerationJob.js).
 */
export default function usePersistentState(key, initialValue) {
  const [value, setValue] = useState(() => {
    try {
      const stored = sessionStorage.getItem(key);
      return stored !== null ? JSON.parse(stored) : initialValue;
    } catch {
      return initialValue;
    }
  });

  useEffect(() => {
    try {
      sessionStorage.setItem(key, JSON.stringify(value));
    } catch {
      // sessionStorage unavailable/full -- just means this session's
      // draft won't survive a reload, not worth surfacing to the user.
    }
  }, [key, value]);

  return [value, setValue];
}
