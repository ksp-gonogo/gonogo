/**
 * The staleness/absence surface (M2 design §4, "carries M1 finding B") — the
 * status a topic (raw or derived) is in, from the operator's point of view.
 * Rides alongside the value, never inside it (the `useKosScriptStatus`
 * pattern) — see `use-stream-status.ts`.
 *
 * - `"live"` — Fresh: a confirmed, current value.
 * - `"held-stale"` — the value may have changed but we currently cannot
 *   know: either client-inferred from missed heartbeat keyframes
 *   (`HeartbeatTracker`, NEVER from `validAt` age — see that file's doc), or
 *   server-stamped (`meta.staleness === HeldStale`) on catch-up.
 * - `"last-before-blackout"` — server-stamped only: this is the newest
 *   sample that got out before a blackout the Courier already knew about
 *   when it served this point.
 * - `"absent"` — a tombstone (`payload: null`): the subject confidently says
 *   "there is no value" (M1 finding B). Distinct from `"held-stale"` — the
 *   two things an operator most needs to tell apart (M2 design §4.2).
 * - `"resyncing"` — no point at-or-before the current `viewUt` yet in this
 *   epoch: cold start, or resynchronizing after a rewind until the first
 *   post-reset keyframe lands. Mirrors `useTimelineStream`'s `undefined`.
 *
 * The declaration order above is presentation order, not severity order —
 * see `worstStatus` for the ranking used to combine a derived channel's
 * inputs.
 */
export type StreamStatusValue =
  | "live"
  | "held-stale"
  | "last-before-blackout"
  | "absent"
  | "resyncing";

/**
 * Severity ranking, best to worst. `resyncing` outranks `absent` because it
 * means "we don't even know yet", which is less information than a
 * confirmed tombstone; `absent` outranks the two staleness grades because a
 * confirmed absence is a stronger claim than "may have changed, can't tell".
 */
const STATUS_SEVERITY: Record<StreamStatusValue, number> = {
  live: 0,
  "held-stale": 1,
  "last-before-blackout": 2,
  absent: 3,
  resyncing: 4,
};

/**
 * The worst (highest-severity) status among a set of inputs — M2 design
 * §4.4: "derived channels propagate the worst input staleness into their
 * own status" (e.g. `vessel.state`, see `vessel-state.ts`'s
 * `deriveVesselStateStatus`). An empty list is vacuously `"live"` — no
 * `DerivedChannelDefinition` should actually declare zero inputs and rely on
 * this default in practice.
 */
export function worstStatus(statuses: StreamStatusValue[]): StreamStatusValue {
  let worst: StreamStatusValue = "live";
  for (const status of statuses) {
    if (STATUS_SEVERITY[status] > STATUS_SEVERITY[worst]) worst = status;
  }
  return worst;
}
