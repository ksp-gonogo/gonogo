/**
 * Docking and target derivations shared by every widget that draws them, so
 * no two surfaces disagree. `vessel.dock` carries no port-frame misalignment
 * axes, so alignment is the line-of-sight offset of `relativePosition`.
 */
import type { Reading, Value, Vec3Of } from "@ksp-gonogo/sitrep-sdk";
import { combineReadings, TargetKind, value } from "@ksp-gonogo/sitrep-sdk";

/** A wire Vec3 as plain numbers, for maths the unit system has nothing to say about. */
export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/** Unwraps a unit-carrying vector's components; an `as Vec3` cast would pass Values as numbers. */
export function bare<U extends string>(v: Vec3Of<U>): Vec3 {
  return { x: v.x.magnitude, y: v.y.magnitude, z: v.z.magnitude };
}

export function vecMagnitude(v: Vec3): number {
  return Math.hypot(v.x, v.y, v.z);
}

/** Signed range-rate along the line of sight, positive opening; `undefined` at zero separation. */
export function radialSpeed(
  position: Vec3,
  velocity: Vec3,
): number | undefined {
  const distance = vecMagnitude(position);
  if (distance === 0) return undefined;
  const dot =
    position.x * velocity.x + position.y * velocity.y + position.z * velocity.z;
  return dot / distance;
}

/** Range to a target as a Reading, carrying the separation vector's currency. */
export function rangeReading(
  relativePosition: Reading<Vec3Of<"m">>,
): Reading<Value<"m">> {
  return combineReadings([relativePosition], (separation) =>
    value("m", vecMagnitude(bare(separation))),
  );
}

/** {@link radialSpeed} as a Reading; coincident vectors carry no value, since the rate is unknown, not zero. */
export function closingRateReading(
  relativePosition: Reading<Vec3Of<"m">>,
  relativeVelocity: Reading<Vec3Of<"m/s">>,
): Reading<Value<"m/s">> {
  return combineReadings(
    [relativePosition, relativeVelocity],
    (separation, motion) => {
      const rate = radialSpeed(bare(separation), bare(motion));
      return rate === undefined ? undefined : value("m/s", rate);
    },
  );
}

/**
 * Line-of-sight alignment in degrees off boresight, taking the port frame's
 * `z` as the approach axis. There is no roll: the wire carries none.
 */
export function deriveDockAngles(position: Vec3): { ax: number; ay: number } {
  const ax = (Math.atan2(position.x, Math.abs(position.z)) * 180) / Math.PI;
  const ay = (Math.atan2(position.y, Math.abs(position.z)) * 180) / Math.PI;
  return { ax, ay };
}

/** The display label for a target kind; callers depend on the exact `"CelestialBody"` string. */
export function targetKindLabel(
  kind: TargetKind | undefined,
): string | undefined {
  switch (kind) {
    case undefined:
      return undefined;
    case TargetKind.Vessel:
      return "Vessel";
    case TargetKind.Body:
      return "CelestialBody";
    case TargetKind.Part:
      return "Docking Port";
    case TargetKind.Position:
      return "Position";
    case TargetKind.Other:
      return "Other";
    default:
      return unnamedTargetKind(kind);
  }
}

/**
 * A member added without a label is a type error here; an unknown ordinal from
 * a newer mod still arrives at runtime, with no name to give.
 */
function unnamedTargetKind(_kind: never): undefined {
  return undefined;
}
