/**
 * Carrying `comms.delay` forward by re-measuring ONE leg of the route.
 *
 * ## Why only the first hop
 *
 * A one-way delay is the whole route's length over the speed light travels at,
 * and `comms.path` publishes that route hop by hop. Between the instant the
 * light left and the instant an operator is looking at, almost none of that
 * route has changed: every hop except the first joins two ground stations, or a
 * station and a relay, or two relays, and none of those pairs moves
 * appreciably against the other on a telemetry timescale. The length the mod
 * measured for them is still their length, so their contribution carries
 * forward as the sum it already was.
 *
 * The FIRST hop is the one with the craft on one end, and the craft is the
 * thing that has moved. So the model subtracts the first hop as measured, and
 * adds back the separation between the craft's propagated position and its
 * peer's position at the view time:
 *
 * ```
 * reckoned = (route − firstHop + |craft(at) − peer(at)|) × secondsPerMetre
 * ```
 *
 * ## Where the seconds-per-metre comes from, and why not `c`
 *
 * The obvious spelling of the last term is `/ c`, and it would be wrong on any
 * save that has moved the dial. The mod divides by `c × lightSpeedScale`
 * (`Sitrep.Host.Comms.SignalDelay.EffectiveC`), the scale is a career setting a
 * player is expected to turn down, and it is NOT on the wire. Dividing the
 * observed delay by the observed route recovers whatever the mod actually used,
 * with no field to add and nothing to keep in sync.
 *
 * It buys a second property worth more than the first: at the observation's own
 * instant the re-measured first hop IS the measured one, so the model reproduces
 * the observation exactly. The reckoned value therefore leaves the observed
 * value continuously rather than stepping off it, which is what an operator
 * watching the number move is entitled to.
 *
 * ## What this does NOT model
 *
 * A route change. The chain is the one that was OBSERVED, and `comms.path` is
 * declared never-reckonable for exactly this reason: a relay drops below the
 * horizon and the whole topology re-solves, discretely, with nothing to
 * interpolate. This model stretches one leg of a fixed chain; it will keep
 * stretching it across a handover it cannot see, the same way a conic keeps
 * coasting across a burn it cannot see.
 */

import type { CommsHop } from "../__generated__/contract";
import { CommsDelaySource } from "../__generated__/contract";
import type { Quantityish } from "../magnitude";
import { magnitudeOr } from "../magnitude";
import type { ReckoningDecline } from "../reading";
import type { CelestialFacts } from "./celestial-facts";
import {
  type CommsPeerLocation,
  type CommsPeerOrbit,
  commsPeerPositionAt,
} from "./comms-path-geometry";
import type { Vector3 } from "./kepler";
import { buildElements, magnitude, trySolve } from "./kepler-reckoning";
import { systemInstantAt } from "./reference-frame";

/** Everything the substitution needs, resolved once for a frame. */
export interface CommsDelayFit {
  /**
   * The observed delay over the observed route, seconds per metre: the
   * reciprocal of whatever speed the mod divided by, scale included.
   */
  readonly secondsPerMetre: number;
  /**
   * Every hop after the first, as measured, metres. Carried forward unchanged;
   * see this module's own note on why that is the honest half of the route.
   */
  readonly beyondFirstHopMetres: number;
  /** The craft's elements and the body they are measured about. */
  readonly craft: CommsPeerOrbit;
  /** Where the far end of the first hop is, well enough to be propagated. */
  readonly peer: CommsPeerLocation;
  /** The catalogue, for the peer's body and the craft's. */
  readonly facts: CelestialFacts;
}

/**
 * The slice of a `comms.delay` payload the model reads: what was measured, and
 * whether it is a measurement at all.
 *
 * Structural rather than the generated `CommsDelay`, on the same terms as
 * {@link CommsPeerOrbit}: a payload passes without a cast, and a caller holding
 * the two fields need not manufacture a `PayloadMeta` to ask a question about
 * them.
 */
export interface CommsDelayObservation {
  readonly oneWaySeconds?: Quantityish;
  readonly source: CommsDelaySource;
}

/**
 * Resolve the fixed half of the substitution, or say which published input
 * ruled it out.
 *
 * `hops` is the route as `comms.path` carried it and `observed` the light-time
 * `comms.delay` reported for that route. The two ride one capture and are
 * change-gated independently, so the CURRENT value of each is what to pair: a
 * tick that carried neither is a tick on which neither moved.
 *
 * ## Only a measured delay can be carried forward
 *
 * Three of the four `CommsDelaySource` members are a zero that means something
 * other than "no distance": the feature is off, the flight is a rehearsal, or
 * the save models no comms network at all. Each is a statement about the
 * OPERATOR'S CONFIGURATION rather than about geometry, and none of them stops
 * being true as the craft moves. Deriving a growing light-time from one would
 * put a delay on a board the player has deliberately switched off, which is a
 * worse answer than no reckoning at all.
 */
export function fitCommsDelay(input: {
  readonly hops: readonly CommsHop[] | undefined;
  readonly observed: CommsDelayObservation;
  readonly craft: CommsPeerOrbit;
  readonly peer: CommsPeerLocation;
  readonly facts: CelestialFacts;
}): CommsDelayFit | { readonly declined: ReckoningDecline } {
  if (input.observed.source !== CommsDelaySource.SignalDelay) {
    return {
      declined: {
        reason: "model-inapplicable",
        input: "source",
        note: "this delay is a configured zero rather than a measured light-time, and moving the craft does not change it",
      },
    };
  }
  const hops = input.hops;
  if (hops === undefined || hops.length === 0) {
    return {
      declined: {
        reason: "model-inapplicable",
        input: "@comms.path",
        note: "no path home, so there is no route to re-measure a leg of",
      },
    };
  }

  let route = 0;
  for (const hop of hops) {
    const metres = magnitudeOr(hop?.distanceMeters, Number.NaN);
    if (!Number.isFinite(metres)) {
      // The same rule the mod applies before it publishes a delay at all: one
      // hop without geometry means the total is not a length anyone measured.
      return {
        declined: {
          reason: "input-absent",
          input: "@comms.path",
          note: "a hop carries no distance, so the route has no measured length",
        },
      };
    }
    route += metres;
  }

  const firstHop = magnitudeOr(hops[0]?.distanceMeters, Number.NaN);
  const observedSeconds = magnitudeOr(input.observed.oneWaySeconds, Number.NaN);
  if (!(route > 0) || !(observedSeconds > 0)) {
    return {
      declined: {
        reason: "model-inapplicable",
        note: "the observed delay and route give no rate to re-measure a leg against",
      },
    };
  }

  return {
    secondsPerMetre: observedSeconds / route,
    beyondFirstHopMetres: route - firstHop,
    craft: input.craft,
    peer: input.peer,
    facts: input.facts,
  };
}

/**
 * The one-way delay at `at`, seconds, or `NaN` where the geometry refuses.
 *
 * `NaN` rather than a decline because this is the thunk, called once per read
 * after the model has been offered: a projection field that cannot be produced
 * for one instant is the same absence the conic reports when its solve fails at
 * a later view time. The withdrawal decision was taken in {@link fitCommsDelay}.
 */
export function commsDelaySecondsAt(fit: CommsDelayFit, at: number): number {
  const separation = firstHopMetresAt(fit, at);
  if (!Number.isFinite(separation)) return Number.NaN;
  return (fit.beyondFirstHopMetres + separation) * fit.secondsPerMetre;
}

/**
 * The craft-to-peer separation at `at`, metres, both ends placed ROOT-centred
 * off one system instant so a peer on one body and a craft about another
 * subtract directly.
 */
function firstHopMetresAt(fit: CommsDelayFit, at: number): number {
  const system = systemInstantAt(fit.facts, at);
  const peer = commsPeerPositionAt(fit.peer, fit.facts, system, at);
  if (peer === null) return Number.NaN;
  const centre = system.positionByIndex.get(fit.craft.referenceBodyIndex);
  if (centre === undefined) return Number.NaN;
  const state = trySolve(buildElements(fit.craft), at);
  if (state === null) return Number.NaN;
  const craft: Vector3 = [
    centre[0] + state.position[0],
    centre[1] + state.position[1],
    centre[2] + state.position[2],
  ];
  return magnitude([
    craft[0] - peer[0],
    craft[1] - peer[1],
    craft[2] - peer[2],
  ]);
}
