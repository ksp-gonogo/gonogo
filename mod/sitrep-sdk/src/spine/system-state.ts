import type { DerivedChannelDefinition, DerivedGet } from "./timeline-store";
import type { SystemBodiesPayload } from "./wire-payloads";

/**
 * The `system.state` derived channel: facts about the solar system that do not
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
 * Derives `system.state` from `trackingStation.bodies`. Useful for knowing how many bodies
 * the game has. Used by {@link systemStateChannel}. The result is `undefined`
 * while `trackingStation.bodies` has not arrived (still resyncing), `null` when it is a
 * confirmed tombstone, and otherwise the array length. Never throws.
 */
export function deriveSystemState(
  get: DerivedGet,
): SystemState | null | undefined {
  const bodiesPoint = get<SystemBodiesPayload>("trackingStation.bodies");
  if (!bodiesPoint) return undefined;
  if (bodiesPoint.payload === null) return null;
  return { bodyCount: bodiesPoint.payload.bodies.length };
}

/**
 * The derived channel definition for `system.state`, ready to register with
 * `store.registerDerivedChannel(systemStateChannel)`. Useful for making the body
 * count readable by widgets. Registered by the telemetry context provider.
 * `fields: true` exposes `system.state.bodyCount`. Its status is its single
 * `trackingStation.bodies` input's.
 */
export const systemStateChannel: DerivedChannelDefinition<SystemState> = {
  topic: "system.state",
  inputs: ["trackingStation.bodies"],
  derive: deriveSystemState,
  fields: true,
};
