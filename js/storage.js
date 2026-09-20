/* ============================================================
   CSVette — storage.js
   localStorage for preferences only, under the "csvette." namespace.
   Datasets are NEVER stored here (privacy + quota).
   All access is guarded: private-browsing modes can throw.
   ============================================================ */

const NAMESPACE = "csvette.";

export function getPref(key, fallback = null) {
  try {
    const raw = localStorage.getItem(NAMESPACE + key);
    return raw === null ? fallback : raw;
  } catch {
    return fallback; // storage unavailable
  }
}

export function setPref(key, value) {
  try {
    localStorage.setItem(NAMESPACE + key, String(value));
    return true;
  } catch {
    return false; // storage unavailable / quota exceeded
  }
}

export function removePref(key) {
  try {
    localStorage.removeItem(NAMESPACE + key);
  } catch {
    /* storage unavailable */
  }
}
