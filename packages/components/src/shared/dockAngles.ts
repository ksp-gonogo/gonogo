/**
 * Docking-alignment HUD-proxy helpers: the line-of-sight offset angles +
 * closing-rate derivations Targeting's docking HUD renders, promoted
 * out of that widget into a shared module so other widgets (and any future
 * docking view) reuse one implementation.
 *
 * `vessel.dock` carries only `RelativePosition`/`RelativeVelocity`/`Distance`
 * + a scalar `ForwardDot`: NOT the true port-frame misalignment axes
 * (yaw/pitch/roll) the legacy `dock.ax`/`ay`/`az` keys reported. The decision
 * is to DROP those true axes and use the LINE-OF-SIGHT offset off the
 * `relativePosition` Vec3 as a HUD proxy instead (a genuinely new derivation,
 * not a reproduction of a legacy formula).
 *
 * `targetKindLabel` lives here too: it's the same "derive off native
 * `vessel.target`" family (the SDK `TargetKind` -> the display string
 * widgets render), and both Targeting and TargetPicker need the
 * identical mapping so a current-target's kind reads the same everywhere.
 */
import type { Reading, Value, Vec3Of } from "@ksp-gonogo/sitrep-sdk";
import { combineReadings, TargetKind, value } from "@ksp-gonogo/sitrep-sdk";

/**
 * `{x,y,z}`: the wire shape of every `vessel.target`/`vessel.dock` Vec3
 * field (`mod/Sitrep.Contract/Vec3.cs`), as PLAIN numbers.
 *
 * The vector maths in this module is a dot product, a hypotenuse and an
 * arctangent, none of which the unit system has anything to say about: the
 * design's one Value-aware vector operation is `vectorMagnitude`, and
 * everything else takes components. `bare` below is the one door in.
 */
export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/**
 * A unit-carrying vector's components, for the maths below.
 *
 * The wire's `relativePosition` is a `Vec3Of<"m">` and its leaves are
 * quantities. Reaching them through an `as Vec3` cast asserts they are numbers
 * and puts a `Value` into `toFixed` the moment they are not. This unwraps them
 * honestly, in one place.
 */
export function bare<U extends string>(v: Vec3Of<U>): Vec3 {
  return { x: v.x.magnitude, y: v.y.magnitude, z: v.z.magnitude };
}

export function vecMagnitude(v: Vec3): number {
  return Math.hypot(v.x, v.y, v.z);
}

/**
 * Signed range-rate along the line of sight, `d|relativePosition|/dt =
 * dot(relativePosition, relativeVelocity) / |relativePosition|`. Matches the
 * legacy `tar.o.relativeVelocity` sign convention (positive = opening,
 * negative = closing). `undefined` when the position is exactly zero (can't
 * form a unit vector): never divides by zero.
 */
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

/**
 * Range to a target as a READING, off the separation vector it is derived from.
 *
 * A range worked out client-side is a distance nobody observed: nothing on the
 * bare number says how current the vector behind it is, and a range held over
 * from the last contact draws exactly like a live one. `combineReadings` gives
 * it back the currency, and the arithmetic stays {@link vecMagnitude}'s.
 *
 * Both Targeting and TargetPicker draw this same range off the same field, so
 * it lives here for the reason the rest of this module does: one derivation, so
 * the two surfaces cannot disagree about how far away the target is.
 */
export function rangeReading(
  relativePosition: Reading<Vec3Of<"m">>,
): Reading<Value<"m">> {
  return combineReadings([relativePosition], (separation) =>
    value("m", vecMagnitude(bare(separation))),
  );
}

/**
 * Signed range-rate as a READING, off the two vectors together.
 *
 * Carries NO value where {@link radialSpeed} has no answer, which is the
 * coincident case: with no separation there is no line of sight to project the
 * velocity onto, so the rate is unknown rather than zero. An observed reading
 * carrying no value is the shape `combineReadings` documents, and `Unit` draws
 * it as the null token.
 */
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
 * Line-of-sight docking-alignment angles (degrees off boresight, matching the
 * legacy `dock.ax`/`dock.ay` sign convention the reticle math expects) from
 * `vessel.dock.relativePosition`. Assumes the docking-port-local frame's `z`
 * is the approach/boresight axis and `x`/`y` are the lateral offsets (the same
 * convention `KspVesselActuator` uses). No `az` (roll) equivalent exists on
 * the wire: `vessel.dock` carries no roll data at all.
 */
export function deriveDockAngles(position: Vec3): { ax: number; ay: number } {
  const ax = (Math.atan2(position.x, Math.abs(position.z)) * 180) / Math.PI;
  const ay = (Math.atan2(position.y, Math.abs(position.z)) * 180) / Math.PI;
  return { ax, ay };
}

/**
 * `TargetKind` ordinal -> the display label the badge/mode logic reads. Docking
 * modes gate on "not a body", so the Body case is the only one whose exact
 * string (`"CelestialBody"`) any caller depends on.
 */
export function targetKindLabel(
  kind: TargetKind | undefined,
): string | undefined {
  switch (kind) {
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
      return undefined;
  }
}
