import { deriveTrueAnomalyDeg } from "./body-derivations";
import {
  elementsOf,
  horizonUt,
  MAX_PARENT_DEPTH,
  parentOf,
} from "./catalogue-elements";
import {
  CELESTIAL_FACTS,
  type CelestialBody,
  type CelestialFacts,
} from "./celestial-facts";
import { solve, type Vec3Tuple } from "./kepler";
import { CORE_UPLINK_CLIENT } from "./uplink-clients";

/**
 * How well a body's position is known:
 *
 * - `exact`: the body rides a fixed orbit, so its place at this instant is a
 *   fact, however old the catalogue is
 * - `modelled`: the catalogue's elements carried forward to this instant, inside
 *   the horizon their provider states
 * - `held`: the instant is past what the elements vouch for, or the catalogue
 *   stopped arriving; the body is placed where it was at `asOfUt`, not advanced
 * - `withdrawn`: there is no place to draw it, because its elements or its
 *   parent's are missing
 *
 * @category Solar system and fleet
 */
export type BodyPoseCurrency = "exact" | "modelled" | "held" | "withdrawn";

/**
 * Where one body is at the instant on screen, and how that is known. Positions
 * and velocities are relative to the root body, in metres and m/s, in the
 * catalogue's axes.
 *
 * @category Solar system and fleet
 */
export interface BodyPose {
  /** The body's index in the game. */
  index: number;
  /** How well the position is known. */
  currency: BodyPoseCurrency;
  /** The instant the body is placed at: the view instant, or `asOfUt` when held. Null when withdrawn. */
  atUt: number | null;
  /** When held, the last instant the position is known for; otherwise null. */
  asOfUt: number | null;
  /** The last UT the body's own elements hold for, or null when its provider states no limit. */
  untilUt: number | null;
  /** Root-centred position, metres. Null when withdrawn. */
  position: Vec3Tuple | null;
  /** Root-centred velocity, m/s. Null when withdrawn. */
  velocity: Vec3Tuple | null;
  /** Degrees from 0 to 360 along the body's orbit about its parent at `atUt`. Null for the root star and when withdrawn. */
  trueAnomaly: number | null;
}

/**
 * Every body's {@link BodyPose} at the instant on screen.
 *
 * @category Solar system and fleet
 */
export interface SystemPoses {
  /** The instant on screen, as a UT. */
  ut: number;
  /** Each body's pose by its index. */
  poseByIndex: Record<number, BodyPose>;
}

const ZERO: Vec3Tuple = [0, 0, 0];

function withdrawnPose(body: CelestialBody): BodyPose {
  return {
    index: body.index,
    currency: "withdrawn",
    atUt: null,
    asOfUt: null,
    untilUt: horizonUt(body),
    position: null,
    velocity: null,
    trueAnomaly: null,
  };
}

/**
 * Places every body at `ut`, from the catalogue's elements.
 *
 * A body is never advanced past what vouches for it. Its instant is the view
 * instant, cut back to the end of its own horizon, to its parent's instant (a
 * moon hangs off wherever its planet is placed), and, for a body whose position
 * is not a fixed fact, to the instant the catalogue was last current:
 * `catalogueAsOfUt`, which is null while the catalogue is arriving.
 *
 * @category Solar system and fleet
 */
export function systemPosesAt(
  facts: CelestialFacts,
  ut: number,
  catalogueAsOfUt: number | null,
): SystemPoses {
  const poseByIndex: Record<number, BodyPose> = {};
  if (!Number.isFinite(ut)) {
    for (const body of facts.bodies)
      poseByIndex[body.index] = withdrawnPose(body);
    return { ut, poseByIndex };
  }

  const placeBody = (body: CelestialBody, depth: number): BodyPose => {
    const placed = poseByIndex[body.index];
    if (placed !== undefined) return placed;

    const parent = parentOf(facts, body);
    let parentPose: BodyPose | null = null;
    if (parent !== null) {
      parentPose =
        depth >= MAX_PARENT_DEPTH
          ? withdrawnPose(parent)
          : placeBody(parent, depth + 1);
    }
    const pose = poseOfBody(body, parent, parentPose);
    poseByIndex[body.index] = pose;
    return pose;
  };

  const poseOfBody = (
    body: CelestialBody,
    parent: CelestialBody | null,
    parentPose: BodyPose | null,
  ): BodyPose => {
    let atUt = ut;
    if (parentPose !== null) {
      if (
        parentPose.position === null ||
        parentPose.velocity === null ||
        parentPose.atUt === null
      ) {
        return withdrawnPose(body);
      }
      atUt = parentPose.atUt;
    }
    const until = horizonUt(body);
    if (until !== null && until < atUt) atUt = until;
    if (
      !body.deterministic &&
      catalogueAsOfUt !== null &&
      catalogueAsOfUt < atUt
    ) {
      atUt = catalogueAsOfUt;
    }
    const held = atUt < ut;
    const currency: BodyPoseCurrency = held
      ? "held"
      : body.deterministic
        ? "exact"
        : "modelled";
    const shared = {
      index: body.index,
      currency,
      atUt,
      asOfUt: held ? atUt : null,
      untilUt: until,
    };

    if (parent === null || parentPose === null) {
      return {
        ...shared,
        position: ZERO,
        velocity: ZERO,
        trueAnomaly: null,
      };
    }
    const elements = elementsOf(body, parent);
    if (elements === null || !(elements.ecc >= 0 && elements.ecc < 1)) {
      return withdrawnPose(body);
    }
    const state = solve(elements, atUt);
    const parentPosition = parentPose.position;
    const parentVelocity = parentPose.velocity;
    if (parentPosition === null || parentVelocity === null) {
      return withdrawnPose(body);
    }
    return {
      ...shared,
      position: [
        parentPosition[0] + state.position[0],
        parentPosition[1] + state.position[1],
        parentPosition[2] + state.position[2],
      ],
      velocity: [
        parentVelocity[0] + state.velocity[0],
        parentVelocity[1] + state.velocity[1],
        parentVelocity[2] + state.velocity[2],
      ],
      trueAnomaly: deriveTrueAnomalyDeg({
        semiMajorAxis: body.semiMajorAxis,
        eccentricity: body.eccentricity,
        meanAnomalyAtEpoch: body.meanAnomalyAtEpoch,
        epoch: body.epoch,
        parentGravParameter: parent.gravParameter,
        ut: atUt,
      }),
    };
  };

  for (const body of facts.bodies) placeBody(body, 0);
  return { ut, poseByIndex };
}

/**
 * Returns the pose of the body with this index, or `null` when the instant has
 * none for it.
 *
 * @category Solar system and fleet
 */
export function poseAtIndex(
  poses: SystemPoses | undefined,
  index: number | null | undefined,
): BodyPose | null {
  if (!poses || index == null) return null;
  return poses.poseByIndex[index] ?? null;
}

const NO_POSES: SystemPoses = { ut: Number.NaN, poseByIndex: {} };

/**
 * Where every body is at the instant on screen, computed once per frame and
 * shared by every reader. Read it with {@link useSystemInstant} or
 * `useProcessor(SYSTEM_POSES)`. Do not register a processor with the same id.
 *
 * The catalogue's orbits are facts, so a body on a fixed orbit is `exact` at
 * any instant. Where the elements are only the conic tangent to an integrated
 * path, a pose says so and says how far it holds.
 *
 * @category Solar system and fleet
 */
export const SYSTEM_POSES = CORE_UPLINK_CLIENT.registerProcessor({
  id: "system-poses",
  deps: [CELESTIAL_FACTS] as const,
  compute: ([reading], frame): SystemPoses => {
    const facts =
      reading.state === "observed" || reading.state === "held"
        ? reading.value
        : undefined;
    if (facts === undefined) return NO_POSES;
    const catalogueAsOfUt =
      reading.state === "held" && reading.asOfUt !== undefined
        ? reading.asOfUt.valueOf()
        : null;
    return systemPosesAt(facts, frame.viewUt, catalogueAsOfUt);
  },
});
