/**
 * Body registry: static configuration for celestial bodies.
 *
 * Bodies are registered once at startup (not reactive). The registry follows the
 * same extensibility pattern as components and data sources: call `registerBody()`
 * at module load time to add bodies, and an external package extends the system
 * through the same API.
 *
 * IDs must match the body name the telemetry stream reports (e.g. "Kerbin",
 * "Mun") so a component can look one up directly from a reading.
 *
 * Lives here rather than in `@ksp-gonogo/core` because a planet pack is an
 * Uplink's business: `registerStockBodies` is called by seven Uplink test files
 * and `registerBody` is how a pack adds or overrides an entry, and neither was
 * reachable from a published package. `getBody` was, as a host shim, and that
 * shim retires with this move.
 */

import type { BodyDefinition } from "./types";

/**
 * Imaging altitude window for a body, with sensible defaults derived from
 * radius and atmosphere when explicit values are missing.
 *
 * Atmospheric bodies get a floor of (maxAtmosphere + 10 km), you can't image
 * through the soup. Airless bodies use 5 % of the radius as the floor.
 * The ceiling is 0.8 × radius; the ideal is 0.2 × radius.
 */
export function getImagingWindow(body: BodyDefinition): {
  min: number;
  ideal: number;
  max: number;
  fovDeg: number;
} {
  const atmoFloor = body.hasAtmosphere ? body.maxAtmosphere + 10_000 : 0;
  const defaultMin = Math.max(atmoFloor, body.radius * 0.05);
  const defaultIdeal = Math.max(defaultMin * 1.2, body.radius * 0.2);
  const defaultMax = Math.max(defaultIdeal * 2, body.radius * 0.8);
  return {
    min: body.imagingMinAlt ?? defaultMin,
    ideal: body.imagingIdealAlt ?? defaultIdeal,
    max: body.imagingMaxAlt ?? defaultMax,
    fovDeg: body.cameraFovDeg ?? 30,
  };
}

/**
 * Trapezoidal quality curve over altitude: 0 below `min`, ramps up to 1 at
 * `ideal`, holds 1 until halfway between `ideal` and `max`, ramps back to 0
 * at `max`.
 */
export function imagingQuality(altitude: number, body: BodyDefinition): number {
  const { min, ideal, max } = getImagingWindow(body);
  if (altitude <= min || altitude >= max) return 0;
  if (altitude < ideal) return (altitude - min) / (ideal - min);
  const holdEnd = (ideal + max) / 2;
  if (altitude <= holdEnd) return 1;
  return (max - altitude) / (max - holdEnd);
}

/**
 * The single global slot the bodies live in, keyed by a string rather than a
 * symbol so two different builds of this package still find the same Map. See
 * `map-poi.ts` for why a module static is not safe once this can be bundled, and
 * note the old host shim's doc made exactly this point about this registry: a
 * bundled `getBody` would have read its own permanently-empty copy.
 */
const BODY_REGISTRY_KEY = "__GONOGO_BODIES__" as const;

function bodies(): Map<string, BodyDefinition> {
  const slot = globalThis as typeof globalThis & {
    [BODY_REGISTRY_KEY]?: Map<string, BodyDefinition>;
  };
  slot[BODY_REGISTRY_KEY] ??= new Map();
  return slot[BODY_REGISTRY_KEY];
}

/** Add or override a body. Last write wins, which is how a planet pack overrides. */
export function registerBody(def: BodyDefinition): void {
  bodies().set(def.id, def);
}

export function getBody(id: string): BodyDefinition | undefined {
  return bodies().get(id);
}

export function getAllBodies(): BodyDefinition[] {
  return Array.from(bodies().values());
}

/** For use in tests only: resets the body registry to empty. */
export function clearBodies(): void {
  bodies().clear();
}
