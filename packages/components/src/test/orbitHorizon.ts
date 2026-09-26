import {
  PropagationHorizonKindLike,
  TrajectoryKindLike,
} from "@ksp-gonogo/sitrep-client";

/**
 * The reach a live `vessel.orbit` sample carries from the analytic two-body
 * solver: unbounded. The wire field is not nullable, and a fixture omitting it
 * simulates a producer that dropped it, which the client gate treats as
 * unpropagatable. Stated explicitly rather than defaulted in the fixture
 * helper, where a permissive default would hide.
 */
export const UNBOUNDED_HORIZON = {
  kind: PropagationHorizonKindLike.Unbounded,
} as const;

/**
 * The full horizon the stock producer sends (`AnalyticHorizon()` in
 * `VesselViewProvider.cs`), reach and shape. Reach alone leaves the shape
 * `Unspecified`, which a widget must read as unknown, not conic.
 */
export const ANALYTIC_UNBOUNDED_HORIZON = {
  kind: PropagationHorizonKindLike.Unbounded,
  trajectoryKind: TrajectoryKindLike.Analytic,
} as const;

/**
 * What an integrating provider sends: an osculating element set, good until
 * `untilUt` (a UT, not a duration) and no further. Pass one explicitly when a
 * test cares where the arc stops.
 */
export function integratedHorizon(untilUt = 500) {
  return {
    kind: PropagationHorizonKindLike.Until,
    untilUt,
    trajectoryKind: TrajectoryKindLike.Integrated,
  } as const;
}
