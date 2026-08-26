// The loader-outcome store: every runtime-load attempt records a legible result
// here, and the Settings › Data Sources › Uplinks surface renders it. The design's
// core invariant is that a mismatched or unverified client is NEVER silently
// loaded and NEVER a silent no-op (design §2.4): every refusal carries a reason,
// and this store is where that reason becomes visible.

export type UplinkLoadStatus = "loading" | "loaded" | "quarantined";

export interface UplinkLoadOutcome {
  /** The Uplink id (matches the mod's `[SitrepUplink("id")]`). */
  id: string;
  name: string;
  /** The resolved version, if the descriptor got that far. */
  version?: string;
  status: UplinkLoadStatus;
  /**
   * Why it is in this state. For `quarantined` this is the operator-legible
   * refusal reason (compat gate / hash mismatch / fetch error / no crypto / …).
   */
  reason?: string;
}

type Listener = () => void;

const outcomes = new Map<string, UplinkLoadOutcome>();
const listeners = new Set<Listener>();
let snapshot: UplinkLoadOutcome[] = [];

function recompute(): void {
  snapshot = [...outcomes.values()];
  for (const l of listeners) l();
}

/** Record (or replace) one Uplink's load outcome and notify subscribers. */
export function setUplinkOutcome(outcome: UplinkLoadOutcome): void {
  outcomes.set(outcome.id, outcome);
  recompute();
}

/** Current outcomes, newest-write-wins per id. Stable reference between changes. */
export function getUplinkOutcomes(): UplinkLoadOutcome[] {
  return snapshot;
}

/** Subscribe to outcome changes (useSyncExternalStore-shaped). Returns unsubscribe. */
export function subscribeUplinkOutcomes(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * Record every given id as `loaded` with reason `"bundled"`, for an Uplink
 * loaded via a plain static `import()` rather than the runtime loader, so the
 * loaded-outcome set (read by the Settings › Uplinks list and the Hub
 * wizard's gap computation) isn't left empty for it.
 *
 * Nothing in the app calls this. The loader-covered first-party Uplinks
 * (`flag.ts`'s `LOADER_UPLINK_IDS`) go through the runtime loader, which
 * records its own outcomes via `setUplinkOutcome`, and the statically bundled
 * ones outside the loader's scope have no Settings-visible outcome. It stays
 * as a general-purpose helper for a statically-bundled Uplink that wants one,
 * covered by its own unit tests below.
 */
export function recordBundledOutcomes(ids: readonly string[]): void {
  for (const id of ids) {
    setUplinkOutcome({ id, name: id, status: "loaded", reason: "bundled" });
  }
}

/** Test-only: clear all recorded outcomes. */
export function __resetUplinkOutcomes(): void {
  outcomes.clear();
  recompute();
}
