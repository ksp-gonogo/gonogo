import { type CelestialFacts, systemPosesAt } from "@ksp-gonogo/sitrep-client";
import type { PatchPoint } from "./predictedTrajectory";

/**
 * Where `bodyName` sits relative to `frameBodyName` at `ut`, in the catalogue's
 * axes and metres, from the model's poses. A patch around a body is drawn about
 * the place the body is when the patch begins, so the instant is the patch's own
 * and not the one on screen. Null when either body has no place at that instant.
 */
export function bodyOffsetAt(
  facts: CelestialFacts,
  frameBodyName: string,
  bodyName: string,
  ut: number,
  catalogueAsOfUt: number | null,
): PatchPoint | null {
  const frameIndex = facts.indexByName[frameBodyName];
  const bodyIndex = facts.indexByName[bodyName];
  if (frameIndex === undefined || bodyIndex === undefined) return null;
  const poses = systemPosesAt(facts, ut, catalogueAsOfUt).poseByIndex;
  const frame = poses[frameIndex]?.position;
  const body = poses[bodyIndex]?.position;
  if (!frame || !body) return null;
  return {
    x: body[0] - frame[0],
    y: body[1] - frame[1],
    z: body[2] - frame[2],
  };
}
