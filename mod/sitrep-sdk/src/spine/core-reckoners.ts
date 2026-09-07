import type {
  DockAlignment,
  VesselFlight,
  VesselOrbitTruth,
  VesselTarget,
} from "../__generated__/contract";
import { magnitudeOr } from "../magnitude";
import type {
  ModelledField,
  ReckonerDefinition,
  ReckoningDecline,
  StaleGrade,
} from "../reading";
import type { TimelinePoint } from "../timeline";
import type { Vector3 } from "../unit-system";
import { value } from "../unit-system/value";
import type { Vec3Of } from "../value";
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
const reckonTarget: ReckonerDefinition<
  VesselTarget,
  Pick<VesselTarget, "relativePosition">,
  readonly []
> = {
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
};

/**
 * `vessel.dock.relativePosition` and the `distance` that is its magnitude.
 *
 * The same one-payload dead reckoning as the target, and the distance is
 * recomputed from the ADVANCED vector rather than advanced on its own: a
 * separation carried by a closing rate is only a straight-line approximation of
 * a distance, and the vector is right there.
 */
const reckonDock: ReckonerDefinition<
  DockAlignment,
  Pick<DockAlignment, "relativePosition" | "distance">,
  readonly []
> = {
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
};

/**
 * `vessel.flight.altitudeAsl` and `.orbitalSpeed`, off the conic.
 *
 * The declared inputs are `@vessel.orbit` (the elements and their epoch) and
 * `@system.bodies` (the reference body's radius, which is the only place sea
 * level is published), so the store has both before this runs. The arithmetic is
 * `propagateVesselOrbit` and one subtraction, which is what `deriveVesselState`
 * does on its OnRails branch for the same two fields.
 */
const reckonFlight: ReckonerDefinition<
  VesselFlight,
  Pick<VesselFlight, "altitudeAsl" | "orbitalSpeed">,
  readonly ["vessel.orbit", "system.bodies"]
> = {
  deps: ["vessel.orbit", "system.bodies"],
  reckon(_point, [orbitPoint, bodiesPoint], { viewUt }) {
    const bodies = bodiesPoint?.payload ?? undefined;
    const admissible = keplerAdmissibility(orbitPoint, bodies, viewUt);
    if ("declined" in admissible || orbitPoint?.payload == null) {
      return "declined" in admissible
        ? admissible
        : { declined: { reason: "input-absent", input: "@vessel.orbit" } };
    }
    const orbit = orbitPoint.payload;
    const radius = bodies?.bodies.find(
      (b) => b.index === orbit.referenceBodyIndex,
    )?.radius;
    const seaLevel = magnitudeOr(radius, Number.NaN);
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
};

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
const reckonOrbitTruth: ReckonerDefinition<
  VesselOrbitTruth,
  Pick<VesselOrbitTruth, "position" | "velocity">,
  readonly ["vessel.orbit", "system.bodies"]
> = {
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
};

/**
 * Register core's vanilla for every marked Topic. Idempotent: the registry is
 * keyed by `(topic, owner)` and re-registration under one owner is
 * last-write-wins, so calling it twice is a no-op and a test that has cleared
 * the registry can put them back.
 *
 * Called at module load, the way a bundled Uplink's client registers its own,
 * and again from `TelemetryProvider` when it builds a store, so a suite that
 * cleared the registry between tests still gets the vanilla back.
 */
export function registerCoreReckoners(): void {
  registerReckoner("vessel.target", CORE_RECKONER_OWNER, reckonTarget);
  registerReckoner("vessel.dock", CORE_RECKONER_OWNER, reckonDock);
  registerReckoner("vessel.flight", CORE_RECKONER_OWNER, reckonFlight);
  registerReckoner("vessel.orbit.truth", CORE_RECKONER_OWNER, reckonOrbitTruth);
}

registerCoreReckoners();
