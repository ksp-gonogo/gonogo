// The loader-outcome store: every runtime-load attempt records a legible result
// here, and the Settings › Data Sources › Uplinks surface renders it. The design's
// core invariant is that a mismatched or unverified client is NEVER silently
// loaded and NEVER a silent no-op (design §2.4): every refusal carries a reason,
// and this store is where that reason becomes visible.

import type { UplinkIdentity } from "./identity";
import type { UplinkIntegrityFailure } from "./integrity";

export type UplinkLoadStatus = "loading" | "loaded" | "quarantined";

export interface UplinkLoadOutcome {
  /** The Uplink id (matches the mod's `[SitrepUplink("id")]`). */
  id: string;
  name: string;
  /**
   * The declared name/author/repo and who declared each. Absent only where the
   * loader recorded an outcome before it had a descriptor to read one from.
   */
  identity?: UplinkIdentity;
  /** The resolved version, if the descriptor got that far. */
  version?: string;
  status: UplinkLoadStatus;
  /**
   * Why it is in this state. For `quarantined` this is the operator-legible
   * refusal reason (compat gate / hash mismatch / fetch error / no crypto / ...).
   */
  reason?: string;
  /**
   * Set only when the quarantine was a HASH DISAGREEMENT, and the whole reason
   * this field exists rather than a reader matching `reason` for the word
   * "hash": a compat refusal and a tampered bundle are not the same kind of
   * event, and the surface that has to shout about the second must be able to
   * ask rather than guess. Carries both hashes and which pair disagreed.
   */
  integrity?: UplinkIntegrityFailure;
}

/**
 * The quarantines that are integrity failures. Every other quarantine means an
 * Uplink did not load; these mean the bytes were not what was vouched for.
 */
export function integrityFailures(
  outcomes: readonly UplinkLoadOutcome[],
): UplinkLoadOutcome[] {
  return outcomes.filter(
    (o) => o.status === "quarantined" && o.integrity !== undefined,
  );
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

/** Test-only: clear all recorded outcomes. */
export function __resetUplinkOutcomes(): void {
  outcomes.clear();
  recompute();
}
