import { magnitudeOr } from "../magnitude";
import type { ModelledField, ReckoningDecline, StaleGrade } from "../reading";
import type { TimelinePoint } from "../timeline";
import type { Vector3 } from "../unit-system";
import { value } from "../unit-system/value";
import type { Vec3Of } from "../value";
import {
  atmosphericAdmissibility,
  atmosphericAltitudeAt,
  DESCENT_WINDOW,
  localGravity,
  withinAtmosphere,
} from "./atmospheric-reckoning";
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
      if (
        observed != null &&
        withinAtmosphere(bodies, orbit.referenceBodyIndex, observed.altitudeAsl)
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
        );
        if ("declined" in fit) return fit;
        return {
          modelled: movedFields("rate-integration", "altitudeAsl"),
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
      const solved = propagateVesselOrbit(orbit, viewUt);
      if (solved == null) {
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
}

registerCoreReckoners();
