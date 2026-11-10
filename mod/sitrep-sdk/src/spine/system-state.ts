import { CORE_UPLINK_CLIENT } from "./uplink-clients";

/**
 * The `system.state` published processor: facts about the solar system that do not
 * depend on any one vessel. Useful for knowing how many bodies exist.
 *
 * Today it carries a single field, `bodyCount`. `trackingStation.bodies` on the wire is the
 * raw array of bodies, whereas a widget that fans out one subscription per body
 * index needs a plain `number`. A body count does not depend on anything flying,
 * so it stays available whenever `trackingStation.bodies` is.
 */
export interface SystemState {
  /** Number of bodies in `trackingStation.bodies`. */
  bodyCount: number;
}

/**
 * Works out `system.state` from the `trackingStation.bodies` payload. Useful for
 * knowing how many bodies the game has. Used by {@link SYSTEM_STATE}. The result
 * is `undefined` while `trackingStation.bodies` has not arrived (still
 * resyncing), `null` when it is a confirmed tombstone, and otherwise the array
 * length. Never throws.
 */
export function deriveSystemState(
  bodies: { bodies: readonly unknown[] } | null | undefined,
): SystemState | null | undefined {
  if (bodies === undefined) return undefined;
  if (bodies === null) return null;
  return { bodyCount: bodies.bodies.length };
}

/**
 * The processor published as `system.state`. Useful for making the body count
 * readable by widgets. `fields` exposes `system.state.bodyCount`. Its status is
 * its single `trackingStation.bodies` input's.
 */
export const SYSTEM_STATE = CORE_UPLINK_CLIENT.registerProcessor({
  id: "system-state",
  topic: "system.state",
  fields: true,
  deps: ["trackingStation.bodies"],
  compute: ([bodies]) => deriveSystemState(bodies),
});
