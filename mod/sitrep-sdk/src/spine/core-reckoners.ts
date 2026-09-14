import { magnitudeOr } from "../magnitude";
import type { ModelledField, ReckoningDecline, StaleGrade } from "../reading";
import type { TimelinePoint } from "../timeline";
import type { Vector3 } from "../unit-system";
import { value } from "../unit-system/value";
import type { Vec3Of } from "../value";
import {
  atmosphericAdmissibility,
  atmosphericAltitudeAt,
  atmosphericAltitudeBandAt,
  DESCENT_WINDOW,
  localGravity,
  withinAtmosphere,
} from "./atmospheric-reckoning";
import { deriveCelestialFacts } from "./celestial-facts";
import { commsDelaySecondsAt, fitCommsDelay } from "./comms-delay-reckoning";
import { firstHopPeer, locateCommsPeer } from "./comms-path-geometry";
import {
  advanceByVelocity,
  keplerAdmissibility,
  magnitude,
  propagateVesselOrbit,
} from "./kepler-reckoning";
import { CORE_RECKONER_OWNER, registerReckoner } from "./reckoners";

/**
 * Core's vanilla forward models, registered through the SAME seam an Uplink
 * registers one through.
 *
 * This is the whole point of the file. Reckoning has worked in this client since
 * `deriveVesselStateReckoning` landed, and it worked down a path a third-party
 * author cannot take: a derived channel's `deriveReckoning` label, which can
 * only say that arithmetic already happened inside a `derive` a wire Topic does
 * not have. So the extensibility surface held one registration, a stub that
 * always declined, and the working implementation was somewhere else.
 *
 * Everything below uses `registerReckoner` with declared inputs, reads the same
 * conic `vessel.state` reads (`kepler-reckoning.ts`), and could be written
 * verbatim by an Uplink against the published SDK. `reckoner-equivalence.test.ts`
 * is the proof rather than the claim: it registers one of these a second time
 * through `defineUplinkClient`, importing only the root barrel, and asserts the
 * two produce the same numbers at the same view times, withdrawal instants
 * included.
 */

/**
 * How far a first-order advance of a RELATIVE position stays honest, in seconds.
 *
 * Relative motion between an orbiting pair is curved, so a position carried by
 * its last observed velocity diverges as the square of the elapsed time; and the
 * other half of the horizon is a burn, which a craft out of contact is exactly
 * the craft we cannot know about. Both say the same thing: this model is worth
 * seconds, not minutes. Thirty is the round number inside that, chosen rather
 * than measured, and it is stated here as one constant so widening it is a
 * decision somebody takes rather than a number that drifts per widget.
 *
 * A conic has no equivalent, and correctly: its horizon is the producer's own
 * (`orbit.horizon`), the SOI transition and the air, all of which are published
 * facts rather than a judgement about how long an approximation lasts.
 */
const LINEAR_HORIZON_SECONDS = 30;

/**
 * How far this reading is being carried, or the reason it should not be.
 *
 * ## Declines on a LIVE reading, unlike the conic
 *
 * `readingFrom` asks every reckoner on a live reading too, and for a conic that
 * is right: orbital elements are a CAUSE, true of a value that arrived on time
 * as much as of one that stopped arriving. A first-order extrapolation is not a
 * cause. It integrates FROM the last observation, so on a live reading it has
 * nothing to add and would replace a measured relative position with an
 * arithmetic guess about the same instant. `ReckonerFor`'s own doc names this
 * case and the answer: a model that integrates from the loss of contact declines
 * on `undefined` and says why.
 */
function elapsedOrDecline(
  point: TimelinePoint<unknown>,
  grade: StaleGrade | undefined,
  viewUt: number,
): number | ReckoningDecline {
  if (grade === undefined) {
    return {
      reason: "model-inapplicable",
      note: "the observation is current, so there is no gap to carry it across",
    };
  }
  const dt = viewUt - point.validAt;
  if (!Number.isFinite(dt)) {
    return {
      reason: "model-inapplicable",
      note: "the view time is not a number",
    };
  }
  if (dt > LINEAR_HORIZON_SECONDS) {
    return {
      reason: "beyond-horizon",
      input: "relativeVelocity",
      note: `a relative position carried by its last velocity is honest for about ${LINEAR_HORIZON_SECONDS} seconds, and this is further`,
    };
  }
  return dt;
}

/**
 * A wire vector as three bare numbers, `NaN` for anything absent.
 *
 * Tolerant of a missing vector and of a missing component, because the wire is:
 * a `Vec3` field can arrive `null` outright, and `finite` below is what turns
 * either into a decline rather than into arithmetic on nothing.
 */
function components<U extends string>(
  v: Vector3<U> | null | undefined,
): [number, number, number] {
  return [
    magnitudeOr(v?.x, Number.NaN),
    magnitudeOr(v?.y, Number.NaN),
    magnitudeOr(v?.z, Number.NaN),
  ];
}

function finite(v: readonly [number, number, number]): boolean {
  return v.every((n) => Number.isFinite(n));
}

function metres(v: readonly [number, number, number]): Vec3Of<"m"> {
  return { x: value("m", v[0]), y: value("m", v[1]), z: value("m", v[2]) };
}

/** Root coverage plus one entry per moved field: see {@link ModelledField}. */
function movedFields(
  basis: ModelledField["basis"],
  ...paths: string[]
): readonly ModelledField[] {
  return [{ path: "", basis }, ...paths.map((path) => ({ path, basis }))];
}

/**
 * `vessel.target.relativePosition`, advanced by the relative velocity riding the
 * same payload.
 *
 * `deps: []` and that is the honest declaration rather than an omission: both
 * halves of this model are fields of the value's own Topic, which is exactly
 * what `[SitrepReckonable(LinearDeadReckoning, "relativeVelocity")]` says. The
 * store resolves and enforces CROSS-topic deps; a same-payload input is a fact
 * about the very point being read, so the model checks it and names it. A
 * consumer holding nothing but the stream carries it forward with one
 * multiply-add.
 */
function registerTargetReckoner(): void {
  registerReckoner("vessel.target", CORE_RECKONER_OWNER, {
    deps: [],
    reckon(point, _resolved, { grade, viewUt }) {
      const payload = point.payload;
      /*
       * The DECLARED input first, and the anchor second. Both can be absent at
       * once, and when they are the operator is better served by the contract's
       * own word for what is missing than by a sentence about this model's
       * internals: the mark is the promise that was not kept.
       */
      if (payload?.relativeVelocity == null) {
        return {
          declined: { reason: "input-absent", input: "relativeVelocity" },
        };
      }
      if (payload.relativePosition == null) {
        return {
          declined: {
            reason: "model-inapplicable",
            note: "no relative position was observed, so there is nothing to advance",
          },
        };
      }
      const dt = elapsedOrDecline(point, grade, viewUt);
      if (typeof dt !== "number") return { declined: dt };
      const p = components(payload.relativePosition);
      const v = components(payload.relativeVelocity);
      if (!finite(p) || !finite(v)) {
        return {
          declined: { reason: "input-absent", input: "relativeVelocity" },
        };
      }
      return {
        modelled: movedFields("linear-dead-reckoning", "relativePosition"),
        reckon: (at) => ({
          relativePosition: metres(advanceByVelocity(p, v, at - point.validAt)),
        }),
      };
    },
  });
}

/**
 * `vessel.dock.relativePosition` and the `distance` that is its magnitude.
 *
 * The same one-payload dead reckoning as the target, and the distance is
 * recomputed from the ADVANCED vector rather than advanced on its own: a
 * separation carried by a closing rate is only a straight-line approximation of
 * a distance, and the vector is right there.
 */
function registerDockReckoner(): void {
  registerReckoner("vessel.dock", CORE_RECKONER_OWNER, {
    deps: [],
    reckon(point, _resolved, { grade, viewUt }) {
      const payload = point.payload;
      if (payload == null) {
        return {
          declined: { reason: "input-absent", input: "relativePosition" },
        };
      }
      const dt = elapsedOrDecline(point, grade, viewUt);
      if (typeof dt !== "number") return { declined: dt };
      const p = components(payload.relativePosition);
      const v = components(payload.relativeVelocity);
      if (!finite(p) || !finite(v)) {
        return {
          declined: { reason: "input-absent", input: "relativeVelocity" },
        };
      }
      return {
        modelled: movedFields(
          "linear-dead-reckoning",
          "relativePosition",
          "distance",
        ),
        reckon: (at) => {
          const advanced = advanceByVelocity(p, v, at - point.validAt);
          return {
            relativePosition: metres(advanced),
            distance: value("m", magnitude(advanced)),
          };
        },
      };
    },
  });
}

/**
 * `vessel.flight.altitudeAsl` and `.orbitalSpeed`, off the conic ABOVE the air
 * and off the observed descent rates below it.
 *
 * The declared inputs are `@vessel.orbit` (the elements and their epoch) and
 * `@system.bodies` (the reference body's radius, which is the only place sea
 * level is published), so the store has both before this runs. Above the
 * atmosphere the arithmetic is `propagateVesselOrbit` and one subtraction, which
 * is what `deriveVesselState` does on its OnRails branch for the same two
 * fields.
 *
 * ## Two models, one selector
 *
 * `keplerAdmissibility` withdraws at the atmosphere interface, which left the
 * altitude unreckonable during exactly the descent that motivated reckoning it.
 * `withinAtmosphere` is the selector between the two, and it is asked FIRST:
 * were the conic asked first, a craft under physics inside the air would be
 * refused on quality before the interface was ever consulted, and the operator
 * would hear "the craft is under physics" during a re-entry. Each branch then
 * declines in its own vocabulary, and neither is a fall-through from the other.
 *
 * The selector is handed the radius the conic SOLVES for at the view time, and
 * that is what makes it judge the same instant the conic's own floor does. Given
 * only the observed altitude it answered about the last packet while the floor
 * answered about the read, so a craft observed two kilometres above the
 * interface and falling at 400 m/s went to the conic, the conic withdrew because
 * six seconds later it was solving inside the air, and the descent was never
 * asked. That band is `|verticalSpeed| x gap` wide in observed altitude, so it
 * was crossed on every reentry.
 *
 * ## The two branches move different field sets
 *
 * The conic advances both marked fields. The descent advances the ALTITUDE only
 * and copies `orbitalSpeed` verbatim off the observation, because it has no
 * observed rate for a speed and will not invent one. One reading carries one
 * projection over every marked field of a topic, so the field has to be
 * present; `Reckoning.modelled` is what says it was not MOVED, and it names the
 * altitude alone on this branch. A consumer overlaying `reckoned.value` on
 * `value` (which is what `LandingStatus` does) therefore sees the last observed
 * orbital speed rather than a modelled one, which is the truth.
 *
 * The window is declared on the reckoner and so is handed to the conic too,
 * which ignores it: a conic is a cause and needs one point. That costs a range
 * query on a topic already in the buffer, and the alternative would be two
 * registrations for one topic, which the registry resolves by clobbering.
 */
function registerFlightReckoner(): void {
  registerReckoner("vessel.flight", CORE_RECKONER_OWNER, {
    deps: ["vessel.orbit", "system.bodies"],
    window: DESCENT_WINDOW,
    reckon(point, [orbitPoint, bodiesPoint], { grade, viewUt, history }) {
      const bodies = bodiesPoint?.payload ?? undefined;
      /*
       * The conic asks this too, and identically. It is asked here as well
       * because the SELECTOR below needs the reference body index, so the frame
       * cannot be classified before the elements are known to have arrived.
       */
      if (orbitPoint?.payload == null) {
        return { declined: { reason: "input-absent", input: "@vessel.orbit" } };
      }
      const orbit = orbitPoint.payload;
      const seaLevel = magnitudeOr(
        bodies?.bodies.find((b) => b.index === orbit.referenceBodyIndex)
          ?.radius,
        Number.NaN,
      );
      const observed = point.payload;
      /*
       * Solved ONCE, here, and handed to both halves of the handover and to the
       * conic branch's own emptiness check below. The selector needs it before
       * it can classify the frame, and a second solve for the same instant would
       * be a second chance for the two halves to disagree about where the craft
       * is.
       */
      const solvedAtView = propagateVesselOrbit(orbit, viewUt);
      const conicRadiusAtView =
        solvedAtView == null ? undefined : magnitude(solvedAtView.position);
      if (
        observed != null &&
        withinAtmosphere(
          bodies,
          orbit.referenceBodyIndex,
          observed.altitudeAsl,
          conicRadiusAtView,
        )
      ) {
        const fit = atmosphericAdmissibility(
          point,
          history,
          bodies,
          orbit.referenceBodyIndex,
          /*
           * Both halves can be absent and neither is fatal here: the descent
           * works in altitude ASL, so it needs no sea level, and `localGravity`
           * answers `undefined` rather than NaN so the envelope is skipped
           * rather than compared against nothing.
           */
          localGravity(
            orbit.mu,
            seaLevel + magnitudeOr(observed.altitudeAsl, Number.NaN),
          ),
          grade,
          viewUt,
          conicRadiusAtView,
        );
        if ("declined" in fit) return fit;
        return {
          modelled: movedFields("rate-integration", "altitudeAsl"),
          /*
           * Keyed at `"altitudeAsl"` and at no other path, because that is the
           * one field this branch MOVES. The orbital speed below is a verbatim
           * copy of the observation, and an interval around a copied
           * measurement would be a claim about how well the wire knows its own
           * number.
           *
           * `undefined` rather than an empty map wherever the fit has no
           * standard error: see `atmosphericAltitudeBandAt`.
           */
          bandAt: (at) => {
            const band = atmosphericAltitudeBandAt(fit, at);
            return band ? { altitudeAsl: band } : undefined;
          },
          reckon: (at) => ({
            altitudeAsl: value("m", atmosphericAltitudeAt(fit, at)),
            // Verbatim, absence included. A copy of the last observation is what
            // `Reckoning.modelled` promises for a path it does not name, and a
            // number substituted here would be a placeholder wearing a
            // measurement's clothes.
            orbitalSpeed: observed.orbitalSpeed,
          }),
        };
      }
      const admissible = keplerAdmissibility(orbitPoint, bodies, viewUt);
      if ("declined" in admissible) return admissible;
      if (!Number.isFinite(seaLevel)) {
        return {
          declined: {
            reason: "input-absent",
            input: "@system.bodies",
            note: "the reference body publishes no radius, so there is no sea level to measure from",
          },
        };
      }
      if (solvedAtView == null) {
        return {
          declined: {
            reason: "model-inapplicable",
            input: "@vessel.orbit",
            note: "hyperbolic elements: the elliptical solver has no answer for them",
          },
        };
      }
      return {
        modelled: movedFields(
          "kepler-propagation",
          "altitudeAsl",
          "orbitalSpeed",
        ),
        reckon: (at) => {
          const state = propagateVesselOrbit(orbit, at);
          const r = state == null ? Number.NaN : magnitude(state.position);
          const speed = state == null ? Number.NaN : magnitude(state.velocity);
          return {
            altitudeAsl: value("m", r - seaLevel),
            orbitalSpeed: value("m/s", speed),
          };
        },
      };
    },
  });
}

/**
 * A peer whose orbit nothing here can reach.
 *
 * `locateCommsPeer` joins a RELAY endpoint to `fleet.<guid>.orbit`, and a
 * reckoner cannot subscribe to that: a per-vessel dynamic topic is not a name a
 * `deps` array declared once at module load can carry, and a declared input is
 * the only thing the store resolves. The relay branch is refused ABOVE this,
 * naming that topic, so the callback is never consulted; it is here because
 * `locateCommsPeer` takes one and a lambda returning nothing says the true
 * thing about what this caller holds.
 */
const NO_FLEET_ORBITS = () => undefined;

/**
 * `comms.delay.oneWaySeconds`, by re-measuring the FIRST hop of the observed
 * route and carrying the rest of it forward unchanged.
 *
 * The arithmetic and the reasoning behind it are in `comms-delay-reckoning.ts`;
 * what this adds is the join from three published channels to the two positions
 * that arithmetic needs. `comms.path` names the far end of hop zero,
 * `commandCentre.roster` says where that end is when it is a ground station
 * (body-fixed, so it also needs the body's rotation phase off `system.bodies`),
 * and `vessel.orbit` propagates the craft.
 *
 * ## The newest route pairs with the newest delay, and the gate is why
 *
 * The model scales by the observed delay over the observed route, which is the
 * only way to recover the speed the mod divided by (`lightSpeedScale` is a
 * career setting and is not on the wire). A ratio of two quantities observed at
 * different instants would not be that speed, and the two points CAN carry
 * different instants: both are published from one capture, but the engine
 * compares each payload by value and suppresses an identical rebuild, so either
 * can be gated out of a tick the other survives.
 *
 * Each of those gaps is a positive statement that nothing changed. A tick with
 * no path point is a tick whose route is the one already held; a tick with no
 * delay point is a tick whose total length did not move, which is the only
 * thing the delay is a function of. So the newest of each is the current value
 * of each, and their ratio is the speed in force, whichever tick each last
 * arrived on. Demanding one instant would refuse the model on exactly the ticks
 * the gate is working.
 *
 * ## A RELAY first hop is refused, and it is not a gap in this model
 *
 * A relay's elements ride `fleet.<guid>.orbit`, keyed by a guid that is not
 * known until the route arrives. A reckoner's inputs are declared once, at
 * registration, so there is no dep that names it, and the contract's
 * `[SitrepReckonable]` input grammar cannot name it either: an input is
 * `@<topicId>`, resolved against the declared topic set, and a per-vessel
 * dynamic topic is not in it. So the model the CONTRACT can declare is the
 * direct one, and this refuses the relayed route by naming the topic that would
 * have placed the peer. Serving it needs a decision above this file: the peer's
 * elements riding `comms.path` itself, or an input grammar with a per-subject
 * form.
 */
function registerCommsDelayReckoner(): void {
  registerReckoner("comms.delay", CORE_RECKONER_OWNER, {
    deps: [
      "comms.path",
      "vessel.orbit",
      "system.bodies",
      "commandCentre.roster",
    ],
    reckon(
      point,
      [pathPoint, orbitPoint, bodiesPoint, rosterPoint],
      { viewUt },
    ) {
      const observed = point.payload;
      if (observed == null) {
        return {
          declined: {
            reason: "model-inapplicable",
            note: "no delay was observed, so there is nothing to carry forward",
          },
        };
      }
      const path = pathPoint?.payload;
      if (path == null) {
        return { declined: { reason: "input-absent", input: "@comms.path" } };
      }
      const admissible = keplerAdmissibility(
        orbitPoint,
        bodiesPoint?.payload ?? undefined,
        viewUt,
      );
      if ("declined" in admissible) return admissible;
      if (orbitPoint?.payload == null) {
        return { declined: { reason: "input-absent", input: "@vessel.orbit" } };
      }
      const peer = firstHopPeer(path.hops);
      if (peer === null) {
        return {
          declined: {
            reason: "model-inapplicable",
            input: "@comms.path",
            note: "no path home, so there is no route to re-measure a leg of",
          },
        };
      }
      if (!peer.isHome) {
        return {
          declined: {
            reason: "input-absent",
            input: `@fleet.${peer.id}.orbit`,
            note: "the route home starts at a relay, and where that relay is now is not published anywhere this model can read",
          },
        };
      }
      const located = locateCommsPeer(
        peer,
        rosterPoint?.payload ?? undefined,
        NO_FLEET_ORBITS,
      );
      if (located === null) {
        return {
          declined: {
            reason: "input-absent",
            input: "@commandCentre.roster",
            note: `the roster carries no position for ${peer.id}`,
          },
        };
      }
      const fit = fitCommsDelay({
        hops: path.hops,
        observed,
        craft: orbitPoint.payload,
        peer: located,
        facts: deriveCelestialFacts(bodiesPoint?.payload?.bodies, viewUt),
      });
      if ("declined" in fit) return fit;
      return {
        modelled: movedFields("kepler-propagation", "oneWaySeconds"),
        reckon: (at) => ({
          oneWaySeconds: value("s", commsDelaySecondsAt(fit, at)),
        }),
      };
    },
  });
}

/**
 * `vessel.orbit.truth.position` and `.velocity`: the state vector the same conic
 * produces.
 *
 * `frameRotating` is a DECLARED input the model uses to decline, which is the
 * shape the contract mark spells out: when the truth vectors sit in a frame
 * co-rotating with the body's spin they are not comparable to a fixed-frame
 * propagator's output at all, so the honest answer names the input that ruled
 * the model out rather than quietly returning nothing.
 *
 * `system.bodies` is a DEP without being a contract input: the mark needs only
 * `@vessel.orbit#mu`, and the roster is wanted for the atmosphere floor. Being a
 * dep makes an absent roster a decline here, which is stricter than
 * `deriveVesselStateReckoning`'s posture on the same fact and deliberately so:
 * this channel is dev-only by convention, so a frame withheld while the
 * once-a-second body channel lands costs nothing, and the alternative is a conic
 * drawn through air with no way to know it.
 */
function registerOrbitTruthReckoner(): void {
  registerReckoner("vessel.orbit.truth", CORE_RECKONER_OWNER, {
    deps: ["vessel.orbit", "system.bodies"],
    reckon(point, [orbitPoint, bodiesPoint], { viewUt }) {
      if (point.payload?.frameRotating === true) {
        return {
          declined: {
            reason: "model-inapplicable",
            input: "frameRotating",
            note: "these vectors are in a frame co-rotating with the body, not the fixed frame a conic solves in",
          },
        };
      }
      const admissible = keplerAdmissibility(
        orbitPoint,
        bodiesPoint?.payload ?? undefined,
        viewUt,
      );
      if ("declined" in admissible || orbitPoint?.payload == null) {
        return "declined" in admissible
          ? admissible
          : { declined: { reason: "input-absent", input: "@vessel.orbit" } };
      }
      const orbit = orbitPoint.payload;
      if (propagateVesselOrbit(orbit, viewUt) == null) {
        return {
          declined: {
            reason: "model-inapplicable",
            input: "@vessel.orbit",
            note: "hyperbolic elements: the elliptical solver has no answer for them",
          },
        };
      }
      return {
        modelled: movedFields("kepler-propagation", "position", "velocity"),
        reckon: (at) => {
          const state = propagateVesselOrbit(orbit, at);
          const p =
            state?.position ?? ([Number.NaN, Number.NaN, Number.NaN] as const);
          const v =
            state?.velocity ?? ([Number.NaN, Number.NaN, Number.NaN] as const);
          return {
            position: metres(p as readonly [number, number, number]),
            velocity: {
              x: value("m/s", v[0]),
              y: value("m/s", v[1]),
              z: value("m/s", v[2]),
            },
          };
        },
      };
    },
  });
}

/**
 * Register core's vanilla for every marked Topic. Idempotent: the registry is
 * keyed by `(topic, owner)` and re-registration under one owner is
 * last-write-wins, so calling it twice is a no-op and a test that has cleared
 * the registry can put them back.
 *
 * Called at module load, the way a bundled Uplink's client registers its own,
 * and again from `TelemetryProvider` when it builds a store, so a suite that
 * cleared the registry between tests still gets the vanilla back.
 *
 * ## Why it is still a batch, and why each model is now a function
 *
 * The batch stays: being callable a second time is the whole reason it exists,
 * and it is what puts the vanilla back after `clearReckoners`. What went was the
 * shape it used to hold, a module `const` annotated
 * `ReckonerDefinition<VesselFlight, Pick<...>, readonly [...]>` and registered
 * here by name. That annotation defeated every inference `registerReckoner`
 * offers: the payload the topic already names, the deps the array already
 * names, the projection the model already returns. Wrapping each registration
 * in a function of its own moves the definition into the call, where all three
 * infer, without collapsing four models into one 250-line body. The visible
 * result is at the top of this file: it no longer imports a single payload type
 * from the contract, because the topic string carries them.
 */
export function registerCoreReckoners(): void {
  registerTargetReckoner();
  registerDockReckoner();
  registerFlightReckoner();
  registerOrbitTruthReckoner();
  registerCommsDelayReckoner();
}

registerCoreReckoners();
