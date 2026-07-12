/**
 * Docking-alignment HUD-proxy helpers — the line-of-sight offset angles +
 * closing-rate derivations DistanceToTarget's docking HUD renders, promoted
 * out of that widget into a shared module so other widgets (and any future
 * docking view) reuse one implementation.
 *
 * `vessel.dock` carries only `RelativePosition`/`RelativeVelocity`/`Distance`
 * + a scalar `ForwardDot` — NOT the true port-frame misalignment axes
 * (yaw/pitch/roll) Telemachus's `dock.ax`/`ay`/`az` reported. The decision
 * is to DROP those true axes and use the LINE-OF-SIGHT offset off the
 * `relativePosition` Vec3 as a HUD proxy instead (a genuinely new derivation,
 * not a reproduction of a legacy formula).
 */

/**
 * `{x,y,z}` — the wire shape of every `vessel.target`/`vessel.dock` Vec3
 * field (`mod/Sitrep.Contract/Vec3.cs`).
 */
export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export function vecMagnitude(v: Vec3): number {
  return Math.hypot(v.x, v.y, v.z);
}

/**
 * Signed range-rate along the line of sight — `d|relativePosition|/dt =
 * dot(relativePosition, relativeVelocity) / |relativePosition|`. Matches the
 * legacy `tar.o.relativeVelocity` sign convention (positive = opening,
 * negative = closing). `undefined` when the position is exactly zero (can't
 * form a unit vector) — never divides by zero.
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
 * Line-of-sight docking-alignment angles (degrees off boresight, matching the
 * legacy `dock.ax`/`dock.ay` sign convention the reticle math expects) from
 * `vessel.dock.relativePosition`. Assumes the docking-port-local frame's `z`
 * is the approach/boresight axis and `x`/`y` are the lateral offsets (the same
 * convention `KspVesselActuator` uses). No `az` (roll) equivalent exists on
 * the wire — `vessel.dock` carries no roll data at all.
 */
export function deriveDockAngles(position: Vec3): { ax: number; ay: number } {
  const ax = (Math.atan2(position.x, Math.abs(position.z)) * 180) / Math.PI;
  const ay = (Math.atan2(position.y, Math.abs(position.z)) * 180) / Math.PI;
  return { ax, ay };
}
