/**
 * Carrying `comms.delay` forward by re-measuring one leg of the route.
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
 * The first hop is the one with the craft on one end, and the craft is the
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
 * player is expected to turn down, and it is not on the wire. Dividing the
 * observed delay by the observed route recovers whatever the mod actually used,
 * with no field to add and nothing to keep in sync.
 *
 * It buys a second property worth more than the first: at the observation's own
 * instant the re-measured first hop is the measured one, so the model reproduces
 * the observation exactly. The reckoned value therefore leaves the observed
 * value continuously rather than stepping off it, which is what an operator
 * watching the number move is entitled to.
 *
 * ## What this does not model
 *
 * A route change. The chain is the one that was observed, and `comms.path` is
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
import type { Vec3Tuple } from "./kepler";
import { buildElements, magnitude, trySolve } from "./kepler-reckoning";
import { systemInstantAt } from "./reference-frame";

/**
 * The measured rate of a command centre's signal delay and the positions of the
 * vessel and its first-hop peer, resolved once per frame. Useful for letting
 * the operator see the one-way delay change as the vessel moves between
 * measurements. Returned by `fitCommsDelay` and read by `commsDelaySecondsAt`,
 * which the `comms.delay` reckoner calls.
 */
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
 * The two fields of a `comms.delay` payload the delay model reads: the one-way
 * delay between the command centre and the vessel, and where that figure came
 * from. Useful for deciding whether a measured delay can be carried forward.
 * Taken by `fitCommsDelay`, to which a `comms.delay` payload can be passed
 * as it is.
 */
export interface CommsDelayObservation {
  readonly oneWaySeconds?: Quantityish;
  readonly source: CommsDelaySource;
}

/**
 * Works out the signal delay rate and the fixed length of the route beyond the
 * vessel's first hop, or says which published input ruled that out. Useful for
 * carrying the one-way delay between the command centre and the vessel forward
 * between measurements. Used by the `comms.delay` reckoner.
 *
 * `hops` is the route as `comms.path` carried it and `observed` the signal delay
 * `comms.delay` reported for that route. The two ride one capture and are
 * change-gated independently, so the current value of each is what to pair: a
 * tick that carried neither is a tick on which neither moved.
 *
 * ## Only a measured delay can be carried forward
 *
 * Two of the three `CommsDelaySource` members are a zero that means something
 * other than "no distance": delay is switched off, or the save models no comms
 * network at all. Neither stops being true as the vessel moves, so both are
 * declined and no delay is derived for them.
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
      // The same rule the mod applies before it publishes a delay at all: one hop without geometry means the total is not a length anyone measured.
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
 * The one-way delay between the command centre and the vessel at the UT `at`,
 * in seconds, with the first hop re-measured at that instant. Useful for
 * showing the operator a delay that moves with the vessel. Used by the
 * `comms.delay` reckoner.
 *
 * Returns `NaN` where the geometry cannot be placed at `at`. It never declines:
 * whether the model applies at all is decided once, by `fitCommsDelay`.
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
  const craft: Vec3Tuple = [
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
