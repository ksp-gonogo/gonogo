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
export const LOADER_UPLINK_IDS = ["scansat", "kos", "kerbcast"] as const;

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

/**
 * Test-only override for the boot-time enabled-id set, read once alongside
 * the loader flag. `?uplinkLoaderIds=a,b` (comma-separated, an empty string
 * is valid and means "load nothing at boot") replaces `LOADER_UPLINK_IDS`
 * for that page load only — the shipped constant itself is never mutated.
 * `undefined` (param absent, the default) means "use the shipped default".
 *
 * Exists so the Hub wizard's dogfood e2e
 * (docs/superpowers/specs/2026-07-18-uplink-hub-wizard-design.md §6 Phase W1
 * point 5) can boot with an Uplink deliberately left unloaded, then prove
 * the wizard detects it as an installed-but-unloaded gap and loads it live
 * through the Hub load flow, with no page reload.
 */
export function loaderBootIdsOverride(): string[] | undefined {
  try {
    const raw = new URLSearchParams(window.location.search).get(
      "uplinkLoaderIds",
    );
    if (raw === null) return undefined;
    return raw.length === 0 ? [] : raw.split(",");
  } catch {
    return undefined;
  }
}
