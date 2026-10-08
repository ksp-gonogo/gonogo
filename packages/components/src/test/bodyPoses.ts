import type { BodyPose, SystemPoses } from "@ksp-gonogo/sitrep-client";
import type { CelestialBody } from "../SystemView/useCelestialBodies";

/** Where a fixture body sits along its orbit, which a body no longer carries: it is a pose's, not the catalogue's. */
const ANOMALY_OF = new WeakMap<CelestialBody, number | null>();

/** Records where `body` sits along its orbit, for `posesOf`. Returns the body. */
export function placedAt(
  body: CelestialBody,
  trueAnomaly: number | null,
): CelestialBody {
  ANOMALY_OF.set(body, trueAnomaly);
  return body;
}

/** The poses `useSystemInstant` would answer for these fixture bodies, each exact and placed where `placedAt` said. */
export function posesOf(bodies: readonly CelestialBody[]): SystemPoses {
  const poseByIndex: Record<number, BodyPose> = {};
  for (const b of bodies) {
    poseByIndex[b.index] = {
      index: b.index,
      currency: "exact",
      atUt: 0,
      asOfUt: null,
      untilUt: null,
      position: [0, 0, 0],
      velocity: [0, 0, 0],
      trueAnomaly: ANOMALY_OF.get(b) ?? null,
    };
  }
  return { ut: 0, poseByIndex };
}
