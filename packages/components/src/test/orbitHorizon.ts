import { PropagationHorizonKindLike } from "@ksp-gonogo/sitrep-client";

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
