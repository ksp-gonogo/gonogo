// The loader-outcome store: every runtime-load attempt records a legible result
// here, and each Uplink's page under Settings › Uplinks renders it. The design's
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
  /** `local` for a build named with `--uplink` under the dev server. */
  source?: "local";
  /**
   * Set when this client is a development build nobody vouched for: its plugin
   * declares a dev path on this computer and no hash, so the bytes were checked
   * against nothing. Every surface that shows this Uplink says so in words.
   */
  unvouchedDevClient?: true;
  /**
   * Why it is in this state. For `quarantined` this is the operator-legible
   * refusal reason (compat gate / hash mismatch / fetch error / no crypto / ...).
   */
  reason?: string;
  /**
   * A one-line fact a player can read in place of `reason`, which stays the
   * detail an Uplink author acts on. Set only for quarantines whose reason is
   * written for an author.
   */
  summary?: string;
  /**
   * Set only when the quarantine was a hash disagreement, and the whole reason
   * this field exists rather than a reader matching `reason` for the word
   * "hash": a compat refusal and a tampered bundle are not the same kind of
   * event, and the surface that has to shout about the second must be able to
   * ask rather than guess. Carries both hashes and which pair disagreed.
   */
  integrity?: UplinkIntegrityFailure;
  /**
   * Set when the quarantine was the Uplink's own health report reading
   * unavailable, which the mod revises: a later roster that says otherwise
   * makes the refusal stale.
   */
  refusedOnHealth?: true;
  /**
   * Set when the quarantine was the registry index being unreadable, which says
   * nothing about the Uplink itself: the next roster read tries it again.
   */
  registryUnavailable?: true;
}

/**
 * The quarantines that are integrity failures. Every other quarantine means an
 * Uplink did not load; these mean the bytes were not what was vouched for.
 */
/** One Uplink client a screen has loaded, by id and the version it loaded. */
export interface RunningUplink {
  id: string;
  version: string;
}

/**
 * The Uplinks loaded on this screen, sorted by id, or `null` until a load pass
 * has settled against a roster.
 */
export function runningUplinks(): RunningUplink[] | null {
  if (!settled) return null;
  return snapshot
    .filter((o) => o.status === "loaded" && o.version !== undefined)
    .map((o) => ({ id: o.id, version: o.version as string }))
    .sort((a, b) => a.id.localeCompare(b.id));
}

export function integrityFailures(
  outcomes: readonly UplinkLoadOutcome[],
): UplinkLoadOutcome[] {
  return outcomes.filter(
    (o) => o.status === "quarantined" && o.integrity !== undefined,
  );
}

type Listener = () => void;

const outcomes = new Map<string, UplinkLoadOutcome>();
let clientless = new Set<string>();
let settled = false;
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
 * Replace the roster ids the last registry read found to ship no client, which no later roster can make loadable.
 * An id among them drops a quarantine recorded while the registry was unreadable, since that read says nothing
 * about an Uplink with no client.
 */
export function setClientlessUplinks(ids: Iterable<string>): void {
  clientless = new Set(ids);
  let cleared = false;
  for (const [id, outcome] of outcomes) {
    if (outcome.registryUnavailable && clientless.has(id)) {
      outcomes.delete(id);
      cleared = true;
    }
  }
  if (cleared) recompute();
}

/** Whether the last registry read found this roster id to ship no client. */
export function isClientlessUplink(id: string): boolean {
  return clientless.has(id);
}

/**
 * Record that a load pass has finished against a roster, or an explicit list of
 * Uplinks to load, so every Uplink that can load has an outcome. Before that a
 * widget no registered widget answers to may simply belong to an Uplink whose
 * client has not been attempted yet.
 */
export function setUplinksSettled(): void {
  if (settled) return;
  settled = true;
  recompute();
}

/** Whether a load pass has finished against a roster; see {@link setUplinksSettled}. */
export function haveUplinksSettled(): boolean {
  return settled;
}

/** Test-only: clear all recorded outcomes. */
export function __resetUplinkOutcomes(): void {
  outcomes.clear();
  clientless = new Set();
  settled = false;
  recompute();
}
