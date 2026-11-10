import type { StreamStatusValue } from "../api/types";

/**
 * `StreamStatusValue` is now taken from `@ksp-gonogo/sitrep-sdk` rather than declared
 * here twice.
 *
 * The SDK already mirrored it (`api/types.ts`) because it cannot depend on this
 * package without forming a build cycle, and a conformance test in core kept the two
 * copies honest. An Uplink writing a derived channel has to name the type, so the
 * SDK's copy is the one an author can reach and this package defers to it. One
 * declaration, no conformance needed.
 */

export type { StreamStatusValue } from "../api/types";

/**
 * Severity ranking, best to worst. `resyncing` outranks `absent` because it
 * means "we don't even know yet", which is less information than a
 * confirmed tombstone; `absent` outranks the two staleness grades because a
 * confirmed absence is a stronger claim than "may have changed, can't tell".
 * `disconnected` sits just above `held`: both are client-inferred
 * uncertainty about currency, but `disconnected` is a link-wide fact (the
 * whole pipe is down) rather than one topic's own missed heartbeat, so it
 * outranks a single `held` topic: but it's still a weaker claim than
 * a server-stamped `last-before-blackout` (which at least knows when the
 * blackout started) or a confirmed `absent`.
 *
 * `recorded` sits between `live` and `held`, and it is the only grade
 * where severity is not really about how bad the reading is. The value is
 * exact: it came off the subject's own recorder, stamped with the instant it
 * was taken, so it is a stronger claim than `held`'s "may have changed,
 * cannot tell" and stronger than anything below it. What it is not is current,
 * which is why it must never rank equal to `live`: a derived channel joining a
 * recorded input with a live one has to propagate the recorded grade, or a
 * widget reads a replayed outage as the state of the craft now.
 */
const STATUS_SEVERITY: Record<StreamStatusValue, number> = {
  live: 0,
  recorded: 1,
  held: 2,
  loading: 3,
  "no-game": 4,
  disconnected: 5,
  "last-before-blackout": 6,
  absent: 7,
  resyncing: 8,
};

/**
 * The worst (highest-severity) status among a set of inputs. Useful for showing
 * the operator the least current of the inputs a value was built from, since
 * derived channels take the worst input staleness as their own status. Used by the
 * widget stream status hook and the timeline store. An empty list is `"live"`,
 * though no derived channel should declare zero inputs and rely on that.
 */
export function worstStatus(statuses: StreamStatusValue[]): StreamStatusValue {
  let worst: StreamStatusValue = "live";
  for (const status of statuses) {
    if (STATUS_SEVERITY[status] > STATUS_SEVERITY[worst]) worst = status;
  }
  return worst;
}
