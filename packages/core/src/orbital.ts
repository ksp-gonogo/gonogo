/**
 * Orbital math utilities.
 *
 * These are pure transformation functions — they convert telemetry data
 * that KSP has already computed into forms useful for visualisation.
 * No physics simulation happens here.
 *
 * Angle convention: all public API accepts/returns degrees (matching
 * Telemachus output). Radians are only used internally.
 */

import type { BodyDefinition } from "./bodies";

// ---------------------------------------------------------------------------
// Gravity / circular-orbit reference curves
// ---------------------------------------------------------------------------

/**
 * Speed required for a circular orbit at the given altitude above sea level.
 * `sqrt(GM / (R + h))`. Returns `undefined` when the body has no `gm`
 * registered (e.g. a mod-added body) so callers can degrade rather than
 * silently produce NaN.
 *
 * @param body     Body definition (carries `radius` and optional `gm`).
 * @param altitude Altitude above sea level in metres. Must be > -radius.
 * @returns        Circular-orbit speed in m/s, or `undefined`.
 */
export function circularOrbitVelocity(
  body: BodyDefinition,
  altitude: number,
): number | undefined {
  if (body.gm === undefined) return undefined;
  const r = body.radius + altitude;
  if (!(r > 0)) return undefined;
  return Math.sqrt(body.gm / r);
}

/**
 * Gravitational acceleration at the given altitude above sea level.
 * `GM / (R + h)²`. Returns `undefined` when the body has no `gm`.
 */
export function surfaceGravity(
  body: BodyDefinition,
  altitude: number,
): number | undefined {
  if (body.gm === undefined) return undefined;
  const r = body.radius + altitude;
  if (!(r > 0)) return undefined;
  return body.gm / (r * r);
}

// ---------------------------------------------------------------------------
// Keplerian orbit geometry
// ---------------------------------------------------------------------------

/**
 * Compute the orbital radius at a given true anomaly.
 *
 * @param sma   Semi-major axis in metres.
 * @param ecc   Eccentricity (0 = circle, 0 < e < 1 = ellipse).
 * @param theta True anomaly in degrees.
 * @returns     Distance from focus (body centre) to vessel, in metres.
 */
export function trueAnomalyToRadius(
  sma: number,
  ecc: number,
  theta: number,
): number {
  const th = (theta * Math.PI) / 180;
  return (sma * (1 - ecc * ecc)) / (1 + ecc * Math.cos(th));
}

/**
 * Convert polar orbital coordinates to 2-D Cartesian (orbital plane).
 * Periapsis lies on the positive x-axis.
 *
 * @param radius Distance from focus in metres.
 * @param theta  True anomaly in degrees.
 */
export function orbitalToCartesian(
  radius: number,
  theta: number,
): { x: number; y: number } {
  const th = (theta * Math.PI) / 180;
  return { x: radius * Math.cos(th), y: radius * Math.sin(th) };
}

export interface OrbitParams {
  /** Semi-major axis in metres. */
  sma: number;
  /** Eccentricity. */
  ecc: number;
}

/**
 * Sample N evenly-spaced points around a complete orbit.
 * Returns coordinates in the orbital plane (periapsis on +x axis).
 *
 * @param orbit      Semi-major axis and eccentricity.
 * @param numSamples Number of sample points (default 360).
 */
export function generateOrbitPoints(
  orbit: OrbitParams,
  numSamples = 360,
): Array<{ x: number; y: number }> {
  const points: Array<{ x: number; y: number }> = [];
  for (let i = 0; i < numSamples; i++) {
    const theta = (i / numSamples) * 360;
    const r = trueAnomalyToRadius(orbit.sma, orbit.ecc, theta);
    points.push(orbitalToCartesian(r, theta));
  }
  return points;
}

// ---------------------------------------------------------------------------
// Map projection
// ---------------------------------------------------------------------------

/**
 * Map a latitude/longitude to pixel coordinates on an equirectangular texture.
 *
 * @param lat    Latitude in degrees  (-90 = south pole,  +90 = north pole).
 * @param lon    Longitude in degrees (-180 = west,       +180 = east).
 * @param width  Image/canvas width in pixels.
 * @param height Image/canvas height in pixels.
 */
export function latLonToMap(
  lat: number,
  lon: number,
  width: number,
  height: number,
): { x: number; y: number } {
  return {
    x: ((lon + 180) / 360) * width,
    y: ((90 - lat) / 180) * height,
  };
}

// ---------------------------------------------------------------------------
// Display formatting
// ---------------------------------------------------------------------------

/**
 * Format a duration in seconds to a compact string ("2h 14m 08s").
 * Returns "—" for non-finite or negative values.
 */
export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "—";
  const s = Math.floor(seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}h ${m}m ${String(sec).padStart(2, "0")}s`;
  if (m > 0) return `${m}m ${String(sec).padStart(2, "0")}s`;
  return `${sec}s`;
}

/**
 * Format a distance in metres to a compact human-readable string.
 * Examples: "42,350.0 km", "1.24 Gm", "320 m".
 * Returns "—" for non-finite values.
 */
export function formatDistance(metres: number): string {
  if (!Number.isFinite(metres)) return "—";
  const abs = Math.abs(metres);
  if (abs >= 1e12) return `${(metres / 1e12).toFixed(2)} Tm`;
  if (abs >= 1e9) return `${(metres / 1e9).toFixed(2)} Gm`;
  if (abs >= 1e6) return `${(metres / 1e6).toFixed(2)} Mm`;
  if (abs >= 1e3) return `${(metres / 1e3).toFixed(1)} km`;
  return `${Math.round(metres)} m`;
}
