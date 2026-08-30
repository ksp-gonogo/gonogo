/**
 * Orbital math utilities.
 *
 * These are pure transformation functions, they convert telemetry data
 * that KSP has already computed into forms useful for visualisation.
 * No physics simulation happens here.
 *
 * Angle convention: all public API accepts/returns degrees (matching
 * the wire's own angle convention). Radians are only used internally.
 */

import type { BodyDefinition } from "./bodies";
import { degToRad } from "./utils/math";

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

/**
 * Escape velocity from the given altitude above sea level.
 * `sqrt(2·GM / (R + h))` = circularOrbitVelocity × √2.
 * A trajectory whose speed equals this at the current radius is a
 * parabolic escape: anything above is hyperbolic.
 */
export function escapeVelocity(
  body: BodyDefinition,
  altitude: number,
): number | undefined {
  if (body.gm === undefined) return undefined;
  const r = body.radius + altitude;
  if (!(r > 0)) return undefined;
  return Math.sqrt((2 * body.gm) / r);
}

/**
 * Period of a circular orbit at the given semi-major axis. Kepler's third
 * law: `T = 2π·sqrt(a³ / GM)`. Returns seconds, or `undefined` when GM
 * is missing.
 */
export function orbitalPeriod(
  body: BodyDefinition,
  sma: number,
): number | undefined {
  if (body.gm === undefined) return undefined;
  if (!(sma > 0)) return undefined;
  return 2 * Math.PI * Math.sqrt((sma * sma * sma) / body.gm);
}

/**
 * A body's pressure-versus-altitude profile as the stream reports it: the
 * game's own `GetPressure` sampled at altitudes the producer chose, in
 * ascending order. Both arrays are the same length.
 *
 * <p>Pressure is in pascals here, which is the unit the rest of this module's
 * atmosphere API speaks; the wire carries kPa and the caller converts through
 * the unit registry on the way in.</p>
 */
export interface PressureProfile {
  /** Metres above sea level, ascending from 0. */
  altitudes: readonly number[];
  /** Pressure in pascals at each of those altitudes. */
  pressures: readonly number[];
}

/**
 * Atmospheric pressure at the given altitude, read off a reported profile.
 *
 * <p>Interpolates linearly in the LOG of the pressure, not in the pressure.
 * That is not a smoothing preference: an atmosphere is exponential to first
 * order, so a log-linear join reproduces the ideal case exactly at any
 * spacing, and it is also the space the profile is read in, since the curve
 * is drawn on a log axis. Measured against the ten real pressure curves the
 * RSS install ships, joining the host's samples this way is within 1.51% of
 * `CelestialBody.GetPressure` everywhere and within 1.12% on nine of the ten;
 * joining the SAME samples linearly is out by up to 299%, on Mars.</p>
 *
 * <p>Returns `undefined` above the last sample rather than 0. The profile
 * stops where the air stops carrying anything worth stating, which is below
 * the body's formal ceiling, so "past the end of the table" is not the same
 * claim as "vacuum" and must not be dressed as one.</p>
 */
export function pressureFromProfile(
  profile: PressureProfile,
  altitude: number,
): number | undefined {
  const { altitudes, pressures } = profile;
  const n = Math.min(altitudes.length, pressures.length);
  if (n === 0) return undefined;
  if (altitude <= altitudes[0]) return pressures[0];
  if (altitude > altitudes[n - 1]) return undefined;

  let i = 0;
  while (i < n - 2 && altitudes[i + 1] < altitude) i++;
  const span = altitudes[i + 1] - altitudes[i];
  if (!(span > 0)) return pressures[i];
  const f = (altitude - altitudes[i]) / span;
  const a = pressures[i];
  const b = pressures[i + 1];
  // A zero endpoint has no log; nothing but a straight line can cross it.
  if (!(a > 0) || !(b > 0)) return a * (1 - f) + b * f;
  return Math.exp(Math.log(a) * (1 - f) + Math.log(b) * f);
}

/**
 * Atmospheric pressure at the given altitude, using the body's exponential
 * scale-height model: `P(h) = P₀·exp(-h/H)`. Beyond `maxAtmosphere` the
 * function returns 0 (KSP atmospheres are hard-cut at that altitude).
 * Returns `undefined` for airless bodies and bodies without an
 * `atmosphere` model registered.
 *
 * <p>This is the SECOND-BEST answer and stays named as one. It is what the
 * bundled static table can offer, and the table holds STOCK bodies with a
 * scale height nobody measured from the running game, because `CelestialBody`
 * has no scale-height field to measure. KSP does not evaluate this function:
 * a body with `atmosphereUsePressureCurve` set follows a tabulated curve, and
 * against the real RSS Earth curve the exponential is out by a factor of
 * sixteen at altitude. Prefer {@link pressureFromProfile} whenever the stream
 * reported a profile, and fall back here only when it did not.</p>
 */
export function pressureAtAltitude(
  body: BodyDefinition,
  altitude: number,
): number | undefined {
  if (!body.hasAtmosphere) return undefined;
  if (!body.atmosphere) return undefined;
  if (altitude < 0) return body.atmosphere.surfacePressure;
  if (altitude >= body.maxAtmosphere) return 0;
  return (
    body.atmosphere.surfacePressure *
    Math.exp(-altitude / body.atmosphere.scaleHeight)
  );
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
  const th = degToRad(theta);
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
  const th = degToRad(theta);
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

// No duration/distance string formatters live here, deliberately. A quantity is
// shown with `<Unit value={…} />`, and a wrapper whose only job is to turn a
// Value back into a string is the shape that let eleven widgets each grow their
// own ladder.
//
// A duration computed here (an orbital period, a time to apoapsis) is wrapped
// with `value("s", …)` at the point it is derived, and travels as a quantity
// from there.

/**
 * Absolute zero expressed in degrees Celsius: the Kelvin→Celsius offset.
 * Part and ambient temperatures arrive in Kelvin and are displayed in Celsius;
 * this keeps the conversion from being a bare `- 273.15` magic literal
 * sprinkled across the component library.
 *
 * Note the SIGN: this is absolute zero on the Celsius scale, so it is ADDED to
 * a Kelvin reading. Prefer {@link kelvinToCelsius} over the constant, which is
 * only correct beside the right operator.
 */
export const ABSOLUTE_ZERO_C = -273.15;

/** Convert a temperature in Kelvin to degrees Celsius. */
export function kelvinToCelsius(kelvin: number): number {
  return kelvin + ABSOLUTE_ZERO_C;
}
