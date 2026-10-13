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
 * The altitudes, in metres, between which a vessel can image a body, with the
 * best altitude and the camera field of view in degrees. Useful for showing
 * the operator where over a body a survey camera works. Used by the ground track widget to
 * mark the imaging band.
 *
 * A value the body definition does not give is derived: the lowest altitude is
 * the top of the atmosphere plus 10 km (5% of the radius for an airless body),
 * the highest is 0.8 times the radius, the ideal is 0.2 times the radius, and
 * the field of view is 30 degrees.
 *
 * @category Solar system and fleet
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
 * How good an image a vessel takes of a body from `altitude`, from 0 to 1. It
 * is 0 at or below the lowest imaging altitude, rises to 1 at the ideal
 * altitude, holds 1 until halfway between the ideal and the highest altitude,
 * and falls back to 0 at the highest. Useful for showing the operator how well
 * placed a vessel is to survey.
 *
 * @category Solar system and fleet
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
 * `map-poi.ts` for why a module static is not safe once this can be bundled:
 * held in one, a bundled `getBody` reads its own permanently-empty copy.
 */
const BODY_REGISTRY_KEY = "__GONOGO_BODIES__" as const;

function bodies(): Map<string, BodyDefinition> {
  const slot = globalThis as typeof globalThis & {
    [BODY_REGISTRY_KEY]?: Map<string, BodyDefinition>;
  };
  slot[BODY_REGISTRY_KEY] ??= new Map();
  return slot[BODY_REGISTRY_KEY];
}

/**
 * Adds a celestial body to the registry, or replaces the one with the same id.
 * Useful for making a body from a planet pack known to every widget that
 * looks bodies up. A planet pack calls it after {@link registerStockBodies} to
 * replace stock bodies.
 *
 * @category Solar system and fleet
 */
export function registerBody(def: BodyDefinition): void {
  bodies().set(def.id, def);
}

/**
 * Returns the celestial body registered under `id` (the name the telemetry
 * stream reports, such as `"Kerbin"`), or `undefined`. Useful for looking up
 * a body's radius, atmosphere and colours from a reading that names it. Used by
 * the system diagram to draw each body.
 *
 * @category Solar system and fleet
 */
export function getBody(id: string): BodyDefinition | undefined {
  return bodies().get(id);
}

/**
 * Returns every registered celestial body. Useful for letting the operator
 * pick a body from a list. Used by the ground track widget's settings to offer its body
 * choices.
 *
 * @category Solar system and fleet
 */
export function getAllBodies(): BodyDefinition[] {
  return Array.from(bodies().values());
}

/**
 * Removes every registered celestial body, so a test starts with none.
 *
 * @category Solar system and fleet
 */
export function clearBodies(): void {
  bodies().clear();
}
