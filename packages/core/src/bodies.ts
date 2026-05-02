/**
 * Body registry — static configuration for celestial bodies.
 *
 * Bodies are registered once at startup (not reactive). The registry
 * follows the same extensibility pattern as components and data sources:
 * call registerBody() at module load time to add bodies; external packages
 * can extend the system using the same API.
 *
 * IDs must match the strings Telemachus returns for v.body / o.referenceBody
 * (e.g. "Kerbin", "Mun") for direct look-up in components.
 */

export interface BodyMapConfig {
  type: "equirectangular";
  /** Pixel width of the source texture image. */
  width: number;
  /** Pixel height of the source texture image. */
  height: number;
}

/**
 * Approximate exponential atmosphere model. Real KSP atmospheres are
 * tabulated and not purely exponential, but a single scale-height
 * approximation is enough to draw a recognisable pressure-vs-altitude
 * curve and to distinguish "thin" from "thick" atmospheres at a glance.
 */
export interface AtmosphereModel {
  /** Surface pressure in pascals. */
  surfacePressure: number;
  /** Scale height (e-folding altitude) in metres. */
  scaleHeight: number;
}

export interface BodyDefinition {
  /** Unique identifier — must match Telemachus v.body / o.referenceBody strings. */
  id: string;
  /** Human-readable display name. */
  name: string;
  /** Mean radius in metres. */
  radius: number;
  /**
   * Standard gravitational parameter (GM) in m³/s². Required for orbital
   * mechanics utilities like `circularOrbitVelocity` and `surfaceGravity`.
   * Optional because mod-added bodies may not supply it; consumers must
   * tolerate `undefined` and degrade gracefully.
   */
  gm?: number;
  /** Path or URL to a surface texture image (equirectangular projection). */
  texture?: string;
  /** Fallback display colour (CSS colour string) used when no texture is available. */
  color?: string;
  /**
   * Longitude correction in degrees added to Telemachus v.long before mapping
   * to canvas/texture coordinates. Compensates for differences between the
   * texture's prime meridian and KSP's coordinate system.
   * Positive values shift the plotted position eastward (right on the map).
   * Defaults to 0; tune empirically per body.
   */
  longitudeOffset?: number;
  /**
   * Latitude correction in degrees added to Telemachus v.lat before mapping.
   * Defaults to 0.
   */
  latitudeOffset?: number;
  /** ID of the parent body (e.g. "Kerbin" for "Mun"). Absent for the star. */
  parent?: string;
  /** Texture map metadata, required for accurate lat/lon → pixel mapping. */
  map?: BodyMapConfig;
  /** If the body has an atmosphere */
  hasAtmosphere: boolean;
  /** The height above sea level where the atmosphere is stopped */
  maxAtmosphere: number;
  /**
   * Optional atmosphere model. Only meaningful when `hasAtmosphere` is
   * true. Used by widgets that want to show an atmospheric pressure profile.
   * Mod-added atmospheric bodies may omit it; consumers must tolerate
   * `undefined`.
   */
  atmosphere?: AtmosphereModel;
  /**
   * Sidereal rotation period in seconds. Used by the trajectory predictor to
   * convert inertial positions into body-fixed lat/lon over time. Tidally
   * locked moons still have rotation — use their orbital period around the
   * parent body. Omit for bodies where rotation is irrelevant (e.g. solo
   * applications never targeting the body).
   */
  rotationPeriod?: number;
  /**
   * Minimum altitude (metres above sea level) at which satellite imaging
   * produces usable data. Below this, quality is zero. For atmospheric bodies
   * default to just above the atmosphere; for airless bodies default to a
   * small fraction of the radius.
   */
  imagingMinAlt?: number;
  /**
   * Ideal imaging altitude (metres ASL). Quality reaches 1 here.
   */
  imagingIdealAlt?: number;
  /**
   * Maximum imaging altitude (metres ASL). Above this, quality is zero.
   */
  imagingMaxAlt?: number;
  /**
   * Camera half-angle (degrees) — the cone half-angle used when projecting
   * the imaging footprint. Wider = larger footprint per pass but less detail.
   */
  cameraFovDeg?: number;
  /**
   * Optional circular region revealed from the start — a known landing site
   * or space centre. Used so fresh fog masks aren't completely blank around
   * the player's natural starting position.
   */
  initialReveal?: {
    lat: number;
    lon: number;
    /** Disc radius in metres (surface-measured, not angular). */
    radiusMetres: number;
  };
}

/**
 * Imaging altitude window for a body, with sensible defaults derived from
 * radius and atmosphere when explicit values are missing.
 *
 * Atmospheric bodies get a floor of (maxAtmosphere + 10 km) — you can't image
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

const bodies = new Map<string, BodyDefinition>();

export function registerBody(def: BodyDefinition): void {
  bodies.set(def.id, def);
}

export function getBody(id: string): BodyDefinition | undefined {
  return bodies.get(id);
}

export function getAllBodies(): BodyDefinition[] {
  return Array.from(bodies.values());
}

/** For use in tests only — resets the body registry to empty. */
export function clearBodies(): void {
  bodies.clear();
}
