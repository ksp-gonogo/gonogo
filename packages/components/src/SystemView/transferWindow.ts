import {
  angleDelta,
  hohmannPhaseAngle,
  type TransferStatus,
  transferStatus,
} from "@ksp-gonogo/core";
import type { CelestialBody } from "./useCelestialBodies";

/**
 * Hohmann transfer-window math, shared with the Transfer Window widget through `@ksp-gonogo/core`.
 *
 * Not a reckoner: the ideal phase angle is the angle at which a transfer that has not been flown would meet its target, solved from two semi-major axes. It is a property of the pair of orbits rather than a value of a Topic carried forward, and it sits on no channel.
 */
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

/**
 * Phase angles arrive in [0, 360); rendering them as the closest
 * signed value (-180, 180] makes the leading/trailing relationship obvious
 * at a glance.
 */
export function normalizePhaseAngle(deg: number): number {
  let d = deg % 360;
  if (d > 180) d -= 360;
  if (d < -180) d += 360;
  return d;
}

/** The Hohmann ideal and the live offset from it for the panel's body, when the frame is the vessel's own parent and every input is finite. */
export function panelHohmannFor({
  panelBody,
  vesselBody,
  parentName,
  vSma,
  panelPhaseAngle,
}: {
  panelBody: CelestialBody | null;
  vesselBody: string | null;
  parentName: string | null;
  vSma: number | undefined;
  panelPhaseAngle: number | null;
}): { ideal: number; delta: number | null } | null {
  if (panelBody === null || typeof vesselBody !== "string") return null;
  if (parentName !== vesselBody || panelBody.referenceBody !== vesselBody) {
    return null;
  }
  if (typeof vSma !== "number" || !Number.isFinite(vSma)) return null;
  const rB = panelBody.semiMajorAxis;
  if (typeof rB !== "number" || !Number.isFinite(rB)) return null;
  const ideal = hohmannPhaseAngle(vSma, rB);
  if (!Number.isFinite(ideal)) return null;
  return {
    ideal,
    delta: panelPhaseAngle === null ? null : angleDelta(panelPhaseAngle, ideal),
  };
}
