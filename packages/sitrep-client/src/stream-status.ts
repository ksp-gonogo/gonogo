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
import type { StreamStatusValue } from "@ksp-gonogo/sitrep-sdk";

export type { StreamStatusValue } from "@ksp-gonogo/sitrep-sdk";

/**
 * Severity ranking, best to worst. `resyncing` outranks `absent` because it
 * means "we don't even know yet", which is less information than a
 * confirmed tombstone; `absent` outranks the two staleness grades because a
 * confirmed absence is a stronger claim than "may have changed, can't tell".
 * `disconnected` sits just above `held-stale`: both are client-inferred
 * uncertainty about currency, but `disconnected` is a link-wide fact (the
 * whole pipe is down) rather than one topic's own missed heartbeat, so it
 * outranks a single `held-stale` topic: but it's still a weaker claim than
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
 * `deriveVesselStateStatus`). An empty list is vacuously `"live"`, no
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
