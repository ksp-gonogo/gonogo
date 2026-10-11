import { useMemo } from "react";
import { datedFrom } from "../combine-readings";
import { deriveReading, observedAt, type Reading } from "../reading";
import { type Value, value } from "../unit-system/value";
import {
  type BodyPose,
  poseAtIndex,
  type SystemPoses,
  systemPosesAt,
} from "./body-pose";
import {
  CELESTIAL_FACTS,
  type CelestialBody,
  type CelestialFacts,
} from "./celestial-facts";
import { useViewUt } from "./context";
import { canPropagate, solve, type Vec3Tuple } from "./kepler";
import { buildElements } from "./kepler-reckoning";
import { phaseAngleBetween } from "./phase-angle";
import { useProcessor } from "./use-processor";
import { useSystemInstant } from "./use-system-instant";
import { useTelemetry } from "./use-telemetry";

type OrbitInput = Parameters<typeof buildElements>[0] & {
  referenceBodyIndex?: number | null;
};

/** The two instants are one sample's: closer than this is the same moment. */
const EPSILON_S = 1e-6;

/** Stable identity so a memoising consumer does not churn while there is no phase angle. */
const NO_ANGLES: ReadonlyMap<number, number> = new Map();

/** The catalogue as the processor holds it; a held catalogue is still the catalogue. */
function useCatalogue(): CelestialFacts | undefined {
  // gonogo:reads system.bodies
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
  reading: Parameters<typeof observedAt<unknown>>[0] & {
    reckoning: { status: string };
  },
  ut: number | null | undefined,
): boolean {
  if (reading.reckoning.status !== "declined") return true;
  const sampled = observedAt(reading);
  return (
    sampled !== undefined && ut != null && ut <= sampled.valueOf() + EPSILON_S
  );
}

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

/** The number, or null when it is absent or not finite. */
function finiteOrNull(n: number | undefined): number | null {
  return n !== undefined && Number.isFinite(n) ? n : null;
}

/** An angle in (-180, 180]. */
function wrap180(deg: number): number {
  let d = deg % 360;
  if (d > 180) d -= 360;
  if (d < -180) d += 360;
  return d;
}

/**
 * How far a body leads the active vessel about the body's parent, as a
 * reading: in degrees in (-180, 180], positive when the body is ahead of the
 * vessel, the sense a Hohmann phase angle is given in.
 *
 * It is the angle between the two position vectors in the plane of the
 * vessel's own motion, both taken from the model: the body's from its pose,
 * the vessel's from `vessel.orbit`. It is observed at the received edge and,
 * where the vessel's conic reckons past it, both objects are placed at the
 * instant the reckoning is for.
 *
 * The figure takes the weakest currency of what it rests on. A body held at
 * its horizon, or on a catalogue that stopped arriving, makes it held as of
 * that instant; a body on a fixed orbit does not, however old the catalogue
 * is. A reckoning is kept where every pose at its instant is live, and dropped
 * where one is not: a body past its horizon has no place to reckon to.
 *
 * `undefined` when `body` is `null`, there is no catalogue or vessel orbit yet,
 * the orbit is not an ellipse, or the body has no place.
 *
 * @category Solar system and fleet
 */
export function usePhaseAngle(
  body: CelestialBody | null,
): Reading<Value<"°">> | undefined {
  // gonogo:reads vessel.orbit
  const orbitReading = useTelemetry("vessel.orbit");
  const poses = useSystemInstant();
  const facts = useCatalogue();
  const ut = finiteOrNull(useViewUt()?.valueOf()) ?? undefined;
  const catalogue = useProcessor(CELESTIAL_FACTS);
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
        return value("°", wrap180(angle.degrees));
      },
      (orbit, atUt) => {
        const at = atUt.valueOf();
        const posesAt = systemPosesAt(facts, at, catalogueAsOfUt);
        const angle = phaseAngleAt(orbit, body, facts, posesAt, at);
        if (angle === undefined || angle.poses.some((p) => !isLive(p))) {
          return undefined;
        }
        return value("°", wrap180(angle.degrees));
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

/**
 * Where each of `bodies` is ahead of the vessel, in degrees in [0, 360), keyed
 * by body index, for a mark that is drawn only while it is true now.
 *
 * Same figure as {@link usePhaseAngle}, taken at the instant on screen from
 * the vessel's elements as its reckoner has carried them. A body whose pose is
 * held or withdrawn is left out, because a live mark drawn from where it used
 * to be would show a window that has gone.
 *
 * The map is empty when there is no vessel orbit, the orbit is not an ellipse,
 * the provider will not answer for the instant, or the vessel's reckoner
 * declined to carry its elements forward to it.
 *
 * @category Solar system and fleet
 */
export function useLivePhaseAngles(
  bodies: readonly CelestialBody[],
): ReadonlyMap<number, number> {
  // gonogo:reads vessel.orbit
  const orbitReading = useTelemetry("vessel.orbit");
  const poses = useSystemInstant();
  const facts = useCatalogue();
  const ut = finiteOrNull(useViewUt()?.valueOf());
  const orbitObserved =
    orbitReading.state === "observed" || orbitReading.state === "held"
      ? orbitReading.value
      : undefined;
  // The observation overlaid by what the conic moved (the phase); `reckoning.value` alone is not an orbit.
  const orbit =
    orbitObserved === undefined
      ? undefined
      : orbitReading.reckoning.status === "available"
        ? { ...orbitObserved, ...orbitReading.reckoning.value }
        : orbitObserved;
  const carriedTo = carriesForwardTo(orbitReading, ut);

  return useMemo(() => {
    if (!orbit || facts === undefined || poses === undefined) return NO_ANGLES;
    if (ut === null || !carriedTo) return NO_ANGLES;
    // The same horizon question the vessel's own solve asks, so scrubbing past an integrator's horizon cannot leave a live mark without a vessel dot. Shape is not consulted: a position at one instant needs none.
    if (!canPropagate(orbit.horizon, ut, ut).propagatable) return NO_ANGLES;

    const out = new Map<number, number>();
    for (const b of bodies) {
      const angle = phaseAngleAt(orbit, b, facts, poses, ut);
      if (angle === undefined || angle.poses.some((p) => !isLive(p))) continue;
      out.set(b.index, wrap360(angle.degrees));
    }
    return out.size > 0 ? out : NO_ANGLES;
  }, [bodies, facts, poses, orbit, ut, carriedTo]);
}
