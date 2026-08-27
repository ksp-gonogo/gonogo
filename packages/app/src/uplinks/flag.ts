// There is no flag gating the runtime loader, and no shipped list of ids for it
// to load either. What loads comes from the live `system.uplinks` roster, or
// from the explicit `?uplinkLoaderIds=` override below; with neither, nothing
// is attempted.

/**
 * Explicit override for the boot-time enabled-id set. `?uplinkLoaderIds=a,b`
 * (comma-separated, an empty string is valid and means "load nothing at boot")
 * wins over the live roster for that page load only.
 *
 * `undefined` (param absent, the default) means "let the roster decide", and
 * with no roster talking that resolves to loading nothing: since the hardcoded
 * first-party default was deleted, this is the only way to name ids by hand.
 * Two callers need it: the Hub wizard's dogfood e2e boots with an Uplink
 * deliberately left unloaded, then proves the wizard detects the
 * installed-but-unloaded gap and loads it live with no page reload; and dev or
 * e2e work with no mod talking uses it to boot the client half at all.
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
