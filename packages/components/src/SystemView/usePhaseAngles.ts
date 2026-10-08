import { useTelemetry } from "@ksp-gonogo/core";
import {
  type BodyPose,
  buildElements,
  CELESTIAL_FACTS,
  type CelestialBody,
  type CelestialFacts,
  canPropagate,
  observedAt,
  phaseAngleBetween,
  poseAtIndex,
  type SystemPoses,
  solve,
  systemPosesAt,
  useProcessor,
  useViewUt,
  type Vec3Tuple,
} from "@ksp-gonogo/sitrep-client";
import {
  datedFrom,
  deriveReading,
  type Reading,
  type Value,
  value,
} from "@ksp-gonogo/sitrep-sdk";
import { useMemo } from "react";
import { magnitudeOf } from "../shared/magnitude";
import { normalizePhaseAngle } from "./transferWindow";

/**
 * Phase angle (deg, in [0, 360)) from each body to the active vessel, keyed by body index.
 *
 * It is the angle between the two position vectors as seen from the body's parent, measured in the plane of the vessel's own motion and positive when the body is ahead of the vessel, matching `hohmannPhaseAngle`. Both positions come from the model: the body's from its pose, the vessel's from `vessel.orbit`. A body whose pose is held or withdrawn is left out, because a live highlight drawn from where it used to be would show a window that has gone.
 *
 * Returns a stable empty map when there is no vessel orbit, the orbit is hyperbolic, the received edge is unknown, the provider will not answer for it, or the vessel's reckoner declined to carry its elements forward to the instant on screen.
 *
 * Not a reckoner: the figure relates two orbits at the view time, and no single Topic holds it. The vessel half already rides `vessel.orbit`'s own reckoning (the elements are overlaid with what the registered model moved), and the result sits on no channel for `registerReckoner` to take.
 */
export function usePhaseAngles(
  bodies: readonly CelestialBody[],
  poses: SystemPoses | undefined,
): Map<number, number> {
  const orbitReading = useTelemetry("vessel.orbit");
  const facts = useCatalogue();
  // The observation overlaid by what the conic moved (the phase); `reckoning.value` alone is not an orbit.
  const orbitObserved =
    orbitReading.state === "observed" || orbitReading.state === "held"
      ? orbitReading.value
      : undefined;
  const orbit =
    orbitObserved === undefined
      ? undefined
      : orbitReading.reckoning.status === "available"
        ? { ...orbitObserved, ...orbitReading.reckoning.value }
        : orbitObserved;
  // Unwrapped at the read; `magnitudeOf` already answers null for an absent or non-finite reading.
  const ut = magnitudeOf(useViewUt());
  const carriedTo = carriesForwardTo(orbitReading, ut);

  return useMemo(() => {
    if (!orbit || facts === undefined || poses === undefined) return EMPTY;
    // The provider gate below needs a real instant to put a window to.
    if (ut === null || !carriedTo) return EMPTY;
    // The same horizon question SystemView's own solve asks, so scrubbing past an integrator's horizon cannot leave a live highlight without a vessel dot. Shape is not consulted: a position at one instant needs none.
    if (!canPropagate(orbit.horizon, ut, ut).propagatable) return EMPTY;

    const out = new Map<number, number>();
    for (const b of bodies) {
      const angle = phaseAngleAt(orbit, b, facts, poses, ut);
      if (angle === undefined || angle.poses.some((p) => !isLive(p))) continue;
      out.set(b.index, wrap360(angle.degrees));
    }
    return out.size > 0 ? out : EMPTY;
  }, [bodies, facts, poses, orbit, ut, carriedTo]);
}

/**
 * One body's phase angle as a Reading: observed at the received edge `ut`, and,
 * where the vessel's conic reckons past it, both objects placed at the instant
 * the reckoning is for. Degrees in (-180, 180].
 *
 * The figure takes the weakest currency of what it rests on. A body held at its
 * horizon, or on a catalogue that stopped arriving, makes it held as of that
 * instant; a body on a fixed orbit does not, however old the catalogue is. The
 * reckoning is kept where every pose at its instant is live, and dropped where
 * one is not: a body past its horizon has no place to reckon to.
 */
export function usePhaseAngleReading(
  body: CelestialBody | null,
  poses: SystemPoses | undefined,
  ut: number | undefined,
): Reading<Value<"°">> | undefined {
  const orbitReading = useTelemetry("vessel.orbit");
  const catalogue = useProcessor(CELESTIAL_FACTS);
  const facts =
    catalogue?.state === "observed" || catalogue?.state === "held"
      ? catalogue.value
      : undefined;
  const catalogueAsOfUt =
    catalogue?.state === "held" && catalogue.asOfUt !== undefined
      ? catalogue.asOfUt.valueOf()
      : null;
  return useMemo(() => {
    if (body === null || ut === undefined) return undefined;
    if (facts === undefined || poses === undefined) return undefined;
    const carried = carriesForwardTo(orbitReading, ut);

    let observedPoses: BodyPose[] = [];
    const reading = deriveReading(
      orbitReading,
      (orbit) => {
        if (!carried) return undefined;
        const angle = phaseAngleAt(orbit, body, facts, poses, ut);
        if (angle === undefined) return undefined;
        observedPoses = angle.poses;
        return value("°", normalizePhaseAngle(angle.degrees));
      },
      (orbit, atUt) => {
        const at = atUt.valueOf();
        const posesAt = systemPosesAt(facts, at, catalogueAsOfUt);
        const angle = phaseAngleAt(orbit, body, facts, posesAt, at);
        if (angle === undefined || angle.poses.some((p) => !isLive(p))) {
          return undefined;
        }
        return value("°", normalizePhaseAngle(angle.degrees));
      },
    );
    if (reading.value === undefined) return undefined;
    const held = observedPoses.filter(
      (p): p is BodyPose & { asOfUt: number } =>
        p.currency === "held" && p.asOfUt !== null,
    );
    if (held.length === 0) return reading;
    const aged = datedFrom(
      [
        {
          state: reading.state,
          instant: reading.asOfUt ?? reading.atUt,
          grade: reading.grade,
        },
        ...held.map((p) => ({
          state: "held" as const,
          instant: value("ut", p.asOfUt),
          grade: "held" as const,
        })),
      ],
      reading.value,
    );
    return { ...aged, reckoning: reading.reckoning };
  }, [body, facts, poses, orbitReading, ut, catalogueAsOfUt]);
}

type OrbitInput = Parameters<typeof buildElements>[0] & {
  referenceBodyIndex?: number | null;
};

type OrbitReading = Parameters<typeof observedAt<unknown>>[0] & {
  reckoning: { status: string };
};

/** The catalogue as the processor holds it; a held catalogue is still the catalogue. */
function useCatalogue(): CelestialFacts | undefined {
  const reading = useProcessor(CELESTIAL_FACTS);
  return reading?.state === "observed" || reading?.state === "held"
    ? reading.value
    : undefined;
}

/**
 * Whether the vessel's elements may be taken to the instant `ut`. A reckoner
 * that declined (under physics, past a transition, in an atmosphere) has said
 * they no longer describe where the craft is, so the instant of the
 * observation is the only one they answer for.
 */
function carriesForwardTo(
  reading: OrbitReading,
  ut: number | null | undefined,
): boolean {
  if (reading.reckoning.status !== "declined") return true;
  const sampled = observedAt(reading);
  return (
    sampled !== undefined && ut != null && ut <= sampled.valueOf() + EPSILON_S
  );
}

/** The two instants are one sample's: closer than this is the same moment. */
const EPSILON_S = 1e-6;

/**
 * The angle from the vessel to `body` at `ut`, with the poses it rests on, or
 * undefined where one is missing or the vessel's orbit is not an ellipse.
 */
function phaseAngleAt(
  orbit: OrbitInput,
  body: CelestialBody,
  facts: CelestialFacts,
  poses: SystemPoses,
  ut: number,
): { degrees: number; poses: BodyPose[] } | undefined {
  const elements = buildElements(orbit);
  if (!(elements.ecc >= 0 && elements.ecc < 1)) return undefined;
  const observerIndex =
    body.referenceBody === null
      ? undefined
      : facts.indexByName[body.referenceBody];
  const target = poseAtIndex(poses, body.index);
  const observer = poseAtIndex(poses, observerIndex);
  const craftParent = poseAtIndex(poses, orbit.referenceBodyIndex);
  if (target === null || observer === null || craftParent === null) {
    return undefined;
  }
  const vessel = solve(elements, ut);
  const placed = [target, observer, craftParent].map((pose) =>
    pose.position !== null && pose.velocity !== null
      ? { position: pose.position, velocity: pose.velocity }
      : null,
  );
  const [targetState, observerState, parentState] = placed;
  if (!targetState || !observerState || !parentState) return undefined;
  const degrees = phaseAngleBetween(
    {
      position: minus(
        plus(vessel.position, parentState.position),
        observerState.position,
      ),
      velocity: minus(
        plus(vessel.velocity, parentState.velocity),
        observerState.velocity,
      ),
    },
    minus(targetState.position, observerState.position),
  );
  if (degrees === null) return undefined;
  return { degrees, poses: [target, observer, craftParent] };
}

/** A pose that places its body where it is, rather than where it was or nowhere. */
function isLive(pose: BodyPose): boolean {
  return pose.currency === "exact" || pose.currency === "modelled";
}

function plus(a: Vec3Tuple, b: Vec3Tuple): Vec3Tuple {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

function minus(a: Vec3Tuple, b: Vec3Tuple): Vec3Tuple {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function wrap360(deg: number): number {
  const wrapped = deg % 360;
  return wrapped < 0 ? wrapped + 360 : wrapped;
}

// Stable identity so a memoising consumer does not churn while there is no phase angle.
const EMPTY: Map<number, number> = new Map();
