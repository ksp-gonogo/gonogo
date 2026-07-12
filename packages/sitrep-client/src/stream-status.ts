/**
 * The staleness/absence surface — the status a topic (raw or derived) is
 * in, from the operator's point of view.
 * Rides alongside the value, never inside it (the `useKosScriptStatus`
 * pattern) — see `use-stream-status.ts`.
 *
 * - `"live"` — Fresh: a confirmed, current value.
 * - `"held-stale"` — the value may have changed but we currently cannot
 *   know: either client-inferred from missed heartbeat keyframes
 *   (`HeartbeatTracker`, NEVER from `validAt` age — see that file's doc), or
 *   server-stamped (`meta.staleness === HeldStale`) on catch-up.
 * - `"disconnected"` — the whole TRANSPORT (WS) is down (the
 *   "transport-down short-circuit"): rather than letting
 *   every topic independently drift into `"held-stale"` on its own
 *   heartbeat margin, a `TimelineStore.setTransportConnected(false)` call
 *   marks every topic with confirmed data `"disconnected"` immediately.
 *   Distinct from `"held-stale"` (a per-topic inference about ONE channel's
 *   silence) — this is a link-wide fact, not a per-topic one. See
 *   `TimelineStore.sampleRawStatus` for the full precedence against
 *   server-stamped staleness and `"absent"`.
 * - `"last-before-blackout"` — server-stamped only: this is the newest
 *   sample that got out before a blackout the Courier already knew about
 *   when it served this point.
 * - `"absent"` — a tombstone (`payload: null`): the subject confidently says
 *   "there is no value". Distinct from `"held-stale"` — the two things an
 *   operator most needs to tell apart. Also distinct from `"disconnected"`:
 *   absence is a confirmed fact about the SUBJECT, link-down is a fact about
 *   the TRANSPORT — orthogonal axes. A tombstoned topic reads `"absent"`
 *   even while the transport is down; link-down never masks a confirmed
 *   subject-absence.
 * - `"resyncing"` — no point at-or-before the current `viewUt` yet in this
 *   epoch: cold start, or resynchronizing after a rewind until the first
 *   post-reset keyframe lands. Mirrors `useTimelineStream`'s `undefined`.
 *   Also what a topic that has NEVER received a point reads as even while
 *   the transport is down — `"disconnected"` only short-circuits a topic we
 *   HAVE heard from before (mirrors `HeartbeatTracker.isOverdue`'s own
 *   "no recorded arrival is not overdue, that's resyncing" precedent).
 *
 * The declaration order above is presentation order, not severity order —
 * see `worstStatus` for the ranking used to combine a derived channel's
 * inputs.
 */
export type StreamStatusValue =
  | "live"
  | "held-stale"
  | "disconnected"
  | "last-before-blackout"
  | "absent"
  | "resyncing";

/**
 * Severity ranking, best to worst. `resyncing` outranks `absent` because it
 * means "we don't even know yet", which is less information than a
 * confirmed tombstone; `absent` outranks the two staleness grades because a
 * confirmed absence is a stronger claim than "may have changed, can't tell".
 * `disconnected` sits just above `held-stale`: both are client-inferred
 * uncertainty about currency, but `disconnected` is a link-wide fact (the
 * whole pipe is down) rather than one topic's own missed heartbeat, so it
 * outranks a single `held-stale` topic — but it's still a weaker claim than
 * a server-stamped `last-before-blackout` (which at least knows WHEN the
 * blackout started) or a confirmed `absent`.
 */
const STATUS_SEVERITY: Record<StreamStatusValue, number> = {
  live: 0,
  "held-stale": 1,
  disconnected: 2,
  "last-before-blackout": 3,
  absent: 4,
  resyncing: 5,
};

/**
 * The worst (highest-severity) status among a set of inputs: derived
 * channels propagate the worst input staleness into their own status
 * (e.g. `vessel.state`, see `vessel-state.ts`'s
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
