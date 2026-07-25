// D4 step 2 (2026-07-25): the Phase A `?uplinkLoader=1` / `localStorage
// gonogo.uplinkLoader` gate is RETIRED — the runtime loader is now the
// unconditional default path for the first-party 3 (main.tsx no longer
// branches on it; step 1 proved the loaded path green on all three engines).
// `uplinkLoaderEnabled()`/`UPLINK_LOADER_FLAG` were deleted with it — grep
// found no other consumer. `?uplinkLoaderIds=` below is UNCHANGED: it's a
// separate dev-only override of *which* ids the boot call attempts, still
// used by the Hub-wizard dogfood e2e (tests/playwright/uplink-hub-wizard.spec.ts)
// to boot with an id deliberately left unloaded.

/** The first-party Uplinks routed through the runtime loader at boot. */
export const LOADER_UPLINK_IDS = ["scansat", "kos", "kerbcast"] as const;

/**
 * Test-only override for the boot-time enabled-id set. `?uplinkLoaderIds=a,b`
 * (comma-separated, an empty string is valid and means "load nothing at
 * boot") replaces `LOADER_UPLINK_IDS` for that page load only — the shipped
 * constant itself is never mutated.
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
