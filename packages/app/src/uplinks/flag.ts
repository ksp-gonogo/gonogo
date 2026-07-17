// The Phase A loader flag. OFF by default — the bundled static-import path is the
// production default and stays the working fallback until the loaded path is
// proven on all three engines (design §6 / R9: never drop the fallback early).
//
// Enabled by either `?uplinkLoader=1` in the URL or `localStorage
// gonogo.uplinkLoader = "1"`, so it can be driven from an e2e test (query param)
// or toggled for a manual session (localStorage) without a rebuild.

export const UPLINK_LOADER_FLAG = "uplinkLoader";
const STORAGE_KEY = "gonogo.uplinkLoader";

/** The first-party Uplinks routed through the runtime loader when the flag is on. */
export const LOADER_UPLINK_IDS = ["scansat"] as const;

export function uplinkLoaderEnabled(): boolean {
  try {
    if (
      new URLSearchParams(window.location.search).get(UPLINK_LOADER_FLAG) ===
      "1"
    ) {
      return true;
    }
  } catch {
    // no window.location (non-browser) — fall through
  }
  try {
    return window.localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}
