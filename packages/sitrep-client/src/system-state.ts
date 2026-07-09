import type { DerivedChannelDefinition, DerivedGet } from "./timeline-store";
import type { SystemBodiesPayload } from "./vessel-state";

/**
 * The `system.state` derived channel — a SYSTEM-scoped sibling of
 * `vessel.state`, for display maps that resolve a `system.*` raw channel to a
 * widget-facing shape but have nothing to do with any one vessel.
 *
 * Today it carries a single field, `bodyCount` — the count behind the old
 * Telemachus `b.number` scalar. `system.bodies` on the wire is the raw ARRAY
 * of bodies (`SystemViewProvider.BuildSystemBodies`), whereas
 * SystemView/useCelestialBodies.ts reads a plain `number` (how many bodies
 * exist, so it can fan out per-index subscribes). Deriving the count here —
 * rather than forcing it onto `vessel.state`, which only exists while a vessel
 * is loaded and would leave `b.number` stuck when there's no active vessel —
 * keeps it available whenever `system.bodies` is, matching the legacy scalar's
 * vessel-independent lifetime.
 */
export interface SystemState {
  /** Number of bodies in `system.bodies` — old Telemachus `b.number`. */
  bodyCount: number;
}

/**
 * `system.state` derivation. `undefined` while `system.bodies` hasn't arrived
 * ("still resyncing"); `null` when it's a confirmed tombstone; otherwise the
 * array length. Never throws.
 */
export function deriveSystemState(
  get: DerivedGet,
): SystemState | null | undefined {
  const bodiesPoint = get<SystemBodiesPayload>("system.bodies");
  if (!bodiesPoint) return undefined;
  if (bodiesPoint.payload === null) return null;
  return { bodyCount: bodiesPoint.payload.bodies.length };
}

/**
 * Ready-to-register definition — `store.registerDerivedChannel(systemStateChannel)`.
 * `fields: true` exposes `system.state.bodyCount`. `deriveStatus` is omitted:
 * the default (worst status across declared inputs — here just
 * `system.bodies`) is exactly right for a single-input passthrough count.
 */
export const systemStateChannel: DerivedChannelDefinition<SystemState> = {
  topic: "system.state",
  inputs: ["system.bodies"],
  derive: deriveSystemState,
  fields: true,
};
