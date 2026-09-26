import {
  angleDelta,
  hohmannPhaseAngle,
  type TransferStatus,
  transferStatus,
} from "@ksp-gonogo/core";
import type { CelestialBody } from "./useCelestialBodies";

// Hohmann transfer-window math, shared with the Transfer Window widget through `@ksp-gonogo/core`.
export { angleDelta, hohmannPhaseAngle, type TransferStatus, transferStatus };

/** Each child's window status from a vessel orbiting their shared parent at `vesselSma`; children far from a window are left out. */
export function transferStatusesFor(
  children: readonly CelestialBody[],
  phaseAngles: ReadonlyMap<number, number>,
  vesselSma: number | undefined,
): Map<number, "go" | "soon"> {
  const out = new Map<number, "go" | "soon">();
  if (typeof vesselSma !== "number" || !Number.isFinite(vesselSma)) return out;
  for (const child of children) {
    const rB = child.semiMajorAxis;
    if (typeof rB !== "number" || !Number.isFinite(rB)) continue;
    const live = phaseAngles.get(child.index);
    if (typeof live !== "number") continue;
    const ideal = hohmannPhaseAngle(vesselSma, rB);
    if (!Number.isFinite(ideal)) continue;
    const status: TransferStatus = transferStatus(angleDelta(live, ideal));
    if (status !== "off") out.set(child.index, status);
  }
  return out;
}
