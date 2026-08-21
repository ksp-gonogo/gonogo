import {
  PropagationHorizonKindLike,
  TrajectoryKindLike,
} from "@ksp-gonogo/sitrep-client";

/**
 * The horizon a live `vessel.orbit` sample carries today.
 *
 * `VesselOrbit.Horizon` is not nullable on the wire: a producer states how far
 * its elements may be propagated, and the only elected provider is the analytic
 * two-body solver, which has no limit and says so. A fixture that omits the
 * field is simulating a producer that dropped it, which the client gate treats
 * as unpropagatable, so any test wanting an arc to render has to state one.
 *
 * Spelled out here rather than defaulted inside the fixture helper on purpose:
 * defaulting it would put the permissive answer back, one layer down, in the
 * only place nobody would look for it.
 */
export const UNBOUNDED_HORIZON = {
  kind: PropagationHorizonKindLike.Unbounded,
} as const;

/**
 * The FULL horizon the stock producer sends: `AnalyticHorizon()` in
 * `VesselViewProvider.cs` states both halves, reach and shape.
 *
 * Separate from {@link UNBOUNDED_HORIZON} because the two say different things
 * and a widget may consult either. Reach alone leaves the shape `Unspecified`,
 * which is what a producer that forgot the field sends, and a widget deciding
 * whether a conic is the right renderer must read that as "unknown" rather than
 * "conic". Tests that want a conic drawn need this one; tests exercising the
 * forgot-the-shape case want the other.
 */
export const ANALYTIC_UNBOUNDED_HORIZON = {
  kind: PropagationHorizonKindLike.Unbounded,
  trajectoryKind: TrajectoryKindLike.Analytic,
} as const;

/**
 * What a provider that INTEGRATES sends: an osculating element set, exact at
 * the sample instant, good until `untilUt` and no further.
 *
 * `untilUt` is a UT rather than a duration, per `PropagationHorizon.UntilUt`.
 * The default is a quarter of a ~2000 s low-orbit period ahead of UT 0, which
 * is the shape `IntegratedHorizon.UntilUt` produces; pass an explicit one when
 * a test cares where the arc stops.
 */
export function integratedHorizon(untilUt = 500) {
  return {
    kind: PropagationHorizonKindLike.Until,
    untilUt,
    trajectoryKind: TrajectoryKindLike.Integrated,
  } as const;
}
