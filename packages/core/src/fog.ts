/**
 * Fog-of-war painter — projects an imaging footprint onto an equirectangular
 * mask based on ship position, attitude, and altitude.
 *
 * All math is in the body's physical frame (i.e. Telemachus lat/lon). Body
 * `longitudeOffset` / `latitudeOffset` only come in when translating between
 * physical lat/lon and the texture's pixel index — they don't affect the
 * geometry of visibility.
 *
 * Cheap for realistic inputs: O(visible-cap pixels), with per-row cos/sin
 * caching. At 100 km over Kerbin the inner loop touches ~30 k pixels.
 */

import type { BodyDefinition } from "./bodies";
import { clamp } from "./utils/math";

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface MaskTarget {
  /** Alpha bytes, row-major. Mutated in place. */
  data: Uint8Array;
  width: number;
  height: number;
}

export interface FogPaintParams {
  /** Ship latitude, degrees, -90..90 (Telemachus raw frame). */
  shipLat: number;
  /** Ship longitude, degrees, -180..180 (Telemachus raw frame). */
  shipLon: number;
  /** Ship altitude above sea level, metres. */
  altitude: number;
  /** Camera direction (unit-length not required — we normalise). Body-fixed physical frame. */
  nose: Vec3;
  /** Body mean radius (metres). */
  radius: number;
  /** Camera cone half-angle (degrees). */
  fovDeg: number;
  /** Body longitudeOffset (degrees added to raw lon to get texture lon). */
  longitudeOffset: number;
  /** Body latitudeOffset (degrees added to raw lat to get texture lat). */
  latitudeOffset: number;
  /** Alpha (0..255) to write for qualified pixels. Existing values are kept if higher. */
  qualityAlpha: number;
}

export interface DirtyRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Unit vector pointing from the ship directly at the body centre — the
 * "nadir" direction in the body-fixed physical frame. Useful as a default
 * camera direction before real attitude is wired in.
 */
export function nadirNose(shipLat: number, shipLon: number): Vec3 {
  const latR = (shipLat * Math.PI) / 180;
  const lonR = (shipLon * Math.PI) / 180;
  const cosLat = Math.cos(latR);
  return {
    x: -cosLat * Math.cos(lonR),
    y: -cosLat * Math.sin(lonR),
    z: -Math.sin(latR),
  };
}

/**
 * Build a camera nose vector in the body-fixed physical frame from
 * navball-style surface attitude:
 *   - heading: compass bearing in degrees, 0 = north, 90 = east
 *   - pitch:   angle above local horizon in degrees, 0 = horizon,
 *              +90 = zenith (radial out), −90 = nadir (radial in)
 *
 * Derived from the local-tangent (ENU) basis at the ship's position:
 *   nose = cos(p)·cos(h)·N + cos(p)·sin(h)·E + sin(p)·U
 * where U is the outward radial unit, N is the tangent toward +lat, and E
 * is the tangent toward +lon. Matches `nadirNose` when (pitch, heading) =
 * (−90, 0).
 */
export function noseFromAttitude(
  shipLat: number,
  shipLon: number,
  pitchDeg: number,
  headingDeg: number,
): Vec3 {
  const latR = (shipLat * Math.PI) / 180;
  const lonR = (shipLon * Math.PI) / 180;
  const pitchR = (pitchDeg * Math.PI) / 180;
  const headingR = (headingDeg * Math.PI) / 180;

  const cosLat = Math.cos(latR);
  const sinLat = Math.sin(latR);
  const cosLon = Math.cos(lonR);
  const sinLon = Math.sin(lonR);

  const uX = cosLat * cosLon;
  const uY = cosLat * sinLon;
  const uZ = sinLat;

  const nX = -sinLat * cosLon;
  const nY = -sinLat * sinLon;
  const nZ = cosLat;

  const eX = -sinLon;
  const eY = cosLon;
  const eZ = 0;

  const cp = Math.cos(pitchR);
  const sp = Math.sin(pitchR);
  const ch = Math.cos(headingR);
  const sh = Math.sin(headingR);

  return {
    x: cp * ch * nX + cp * sh * eX + sp * uX,
    y: cp * ch * nY + cp * sh * eY + sp * uY,
    z: cp * ch * nZ + cp * sh * eZ + sp * uZ,
  };
}

/**
 * Paint the imaging footprint onto a mask. Qualified pixels rise to
 * `qualityAlpha` (never down — revisits at worse altitude can't erase
 * earlier coverage). Returns the bounding rect of touched pixels, or null.
 */
export function paintFogFootprint(
  mask: MaskTarget,
  params: FogPaintParams,
): DirtyRect | null {
  if (params.qualityAlpha <= 0) return null;
  const R = params.radius;
  const h = params.altitude;
  if (h <= 0) return null;
  const rOverRplusH = R / (R + h);
  if (rOverRplusH >= 1) return null;

  const cosFov = Math.cos((params.fovDeg * Math.PI) / 180);

  const noseLen = Math.hypot(params.nose.x, params.nose.y, params.nose.z);
  if (noseLen === 0) return null;
  const noseX = params.nose.x / noseLen;
  const noseY = params.nose.y / noseLen;
  const noseZ = params.nose.z / noseLen;

  // Ship unit vector + position in physical frame
  const shipLatR = (params.shipLat * Math.PI) / 180;
  const shipLonR = (params.shipLon * Math.PI) / 180;
  const cosShipLat = Math.cos(shipLatR);
  const usX = cosShipLat * Math.cos(shipLonR);
  const usY = cosShipLat * Math.sin(shipLonR);
  const usZ = Math.sin(shipLatR);
  const shipX = (R + h) * usX;
  const shipY = (R + h) * usY;
  const shipZ = (R + h) * usZ;

  // Horizon-cap angular radius — bounds the set of surface points we could
  // possibly see. The FOV test further narrows within this.
  const horizonDeg = (Math.acos(rOverRplusH) * 180) / Math.PI;

  const W = mask.width;
  const H = mask.height;

  // Ship's texture coordinate (pixel centre of the sub-ship point)
  const texLat = clamp(params.shipLat + params.latitudeOffset, -90, 90);
  const texLon = wrapLon(params.shipLon + params.longitudeOffset);
  const sx = ((texLon + 180) / 360) * W;
  const sy = ((90 - texLat) / 180) * H;

  const dxPx = Math.ceil((horizonDeg / 360) * W);
  const dyPx = Math.ceil((horizonDeg / 180) * H);

  const yMin = Math.max(0, Math.floor(sy - dyPx));
  const yMax = Math.min(H - 1, Math.ceil(sy + dyPx));

  // If the horizon reaches more than half the map in longitude we have to
  // iterate everything (the bbox wraps all the way around).
  const wrapLonAll = dxPx >= W / 2;

  // Precompute per-column cos/sin(physicalLon). 2 × W trig, ~0.3 ms at
  // 2048 — cheaper than doing it per (x, y) pair.
  const lonCos = new Float64Array(W);
  const lonSin = new Float64Array(W);
  for (let x = 0; x < W; x++) {
    const texLonPix = ((x + 0.5) / W) * 360 - 180;
    const physLonRad =
      (wrapLon(texLonPix - params.longitudeOffset) * Math.PI) / 180;
    lonCos[x] = Math.cos(physLonRad);
    lonSin[x] = Math.sin(physLonRad);
  }

  let minX = W;
  let minY = H;
  let maxX = -1;
  let maxY = -1;

  const xStartRaw = wrapLonAll ? 0 : Math.floor(sx - dxPx);
  const xEndRaw = wrapLonAll ? W - 1 : Math.ceil(sx + dxPx);

  for (let y = yMin; y <= yMax; y++) {
    const texLatPix = 90 - ((y + 0.5) / H) * 180;
    const physLat = clamp(texLatPix - params.latitudeOffset, -90, 90);
    const physLatR = (physLat * Math.PI) / 180;
    const cosLatP = Math.cos(physLatR);
    const sinLatP = Math.sin(physLatR);

    for (let xi = xStartRaw; xi <= xEndRaw; xi++) {
      // Column index may wrap when the bbox crosses the anti-meridian
      const x = ((xi % W) + W) % W;
      const upX = cosLatP * lonCos[x];
      const upY = cosLatP * lonSin[x];
      const upZ = sinLatP;

      const dotUsUp = usX * upX + usY * upY + usZ * upZ;
      // Horizon test — simplified:
      //   dot(shipPos - p, u_p) > 0
      //   <=> (R+h) * dotUsUp - R > 0
      //   <=> dotUsUp > R / (R + h)
      if (dotUsUp <= rOverRplusH) continue;

      // Cone test — dot(normalise(p - shipPos), nose) > cos(fov)
      const vX = R * upX - shipX;
      const vY = R * upY - shipY;
      const vZ = R * upZ - shipZ;
      const vLen = Math.hypot(vX, vY, vZ);
      if (vLen === 0) continue;
      const dotVNose = (vX * noseX + vY * noseY + vZ * noseZ) / vLen;
      if (dotVNose <= cosFov) continue;

      const idx = y * W + x;
      if (mask.data[idx] < params.qualityAlpha) {
        mask.data[idx] = params.qualityAlpha;
      }
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }

  if (maxX < 0) return null;
  return { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
}

/**
 * Convenience — apply imaging quality & body config from a BodyDefinition to
 * a paint call. Returns null if the altitude is outside the usable window
 * (quality = 0).
 */
export function paintFogFromBody(
  mask: MaskTarget,
  body: BodyDefinition,
  ship: { lat: number; lon: number; altitude: number; nose: Vec3 },
  quality: number,
): DirtyRect | null {
  if (quality <= 0) return null;
  return paintFogFootprint(mask, {
    shipLat: ship.lat,
    shipLon: ship.lon,
    altitude: ship.altitude,
    nose: ship.nose,
    radius: body.radius,
    fovDeg: body.cameraFovDeg ?? 30,
    longitudeOffset: body.longitudeOffset ?? 0,
    latitudeOffset: body.latitudeOffset ?? 0,
    qualityAlpha: Math.max(0, Math.min(255, Math.round(quality * 255))),
  });
}

export interface FogDiscParams {
  /** Disc centre latitude (degrees, physical/Telemachus frame). */
  lat: number;
  /** Disc centre longitude (degrees, physical frame). */
  lon: number;
  /** Radius in metres along the surface. Converted internally to an angular cap. */
  radiusMetres: number;
  /** Body radius (metres). */
  bodyRadius: number;
  longitudeOffset: number;
  latitudeOffset: number;
  /** Alpha to write (0..255). Uses max-lighten so existing higher values stick. */
  alpha: number;
}

/**
 * Paint a filled spherical-cap disc into the mask. Used to seed known-good
 * visibility (e.g. the space centre) so fresh fog masks aren't completely
 * blank at the player's starting position.
 */
export function paintFogDisc(
  mask: MaskTarget,
  params: FogDiscParams,
): DirtyRect | null {
  if (params.alpha <= 0 || params.radiusMetres <= 0) return null;
  const R = params.bodyRadius;
  const angularRadius = params.radiusMetres / R; // radians along the surface
  if (angularRadius <= 0) return null;
  const cosRadius = Math.cos(angularRadius);
  const radiusDeg = (angularRadius * 180) / Math.PI;

  const W = mask.width;
  const H = mask.height;

  const centreLatR = (params.lat * Math.PI) / 180;
  const centreLonR = (params.lon * Math.PI) / 180;
  const cosCLat = Math.cos(centreLatR);
  const ucX = cosCLat * Math.cos(centreLonR);
  const ucY = cosCLat * Math.sin(centreLonR);
  const ucZ = Math.sin(centreLatR);

  const texLat = clamp(params.lat + params.latitudeOffset, -90, 90);
  const texLon = wrapLon(params.lon + params.longitudeOffset);
  const sx = ((texLon + 180) / 360) * W;
  const sy = ((90 - texLat) / 180) * H;
  const dxPx = Math.ceil((radiusDeg / 360) * W);
  const dyPx = Math.ceil((radiusDeg / 180) * H);
  const yMin = Math.max(0, Math.floor(sy - dyPx));
  const yMax = Math.min(H - 1, Math.ceil(sy + dyPx));
  const wrapLonAll = dxPx >= W / 2;
  const xStartRaw = wrapLonAll ? 0 : Math.floor(sx - dxPx);
  const xEndRaw = wrapLonAll ? W - 1 : Math.ceil(sx + dxPx);

  // Precompute per-column cos/sin(physicalLon)
  const lonCos = new Float64Array(W);
  const lonSin = new Float64Array(W);
  for (let x = 0; x < W; x++) {
    const texLonPix = ((x + 0.5) / W) * 360 - 180;
    const physLonRad =
      (wrapLon(texLonPix - params.longitudeOffset) * Math.PI) / 180;
    lonCos[x] = Math.cos(physLonRad);
    lonSin[x] = Math.sin(physLonRad);
  }

  let minX = W;
  let minY = H;
  let maxX = -1;
  let maxY = -1;

  for (let y = yMin; y <= yMax; y++) {
    const texLatPix = 90 - ((y + 0.5) / H) * 180;
    const physLat = clamp(texLatPix - params.latitudeOffset, -90, 90);
    const physLatR = (physLat * Math.PI) / 180;
    const cosLatP = Math.cos(physLatR);
    const sinLatP = Math.sin(physLatR);

    for (let xi = xStartRaw; xi <= xEndRaw; xi++) {
      const x = ((xi % W) + W) % W;
      const upX = cosLatP * lonCos[x];
      const upY = cosLatP * lonSin[x];
      const upZ = sinLatP;
      const dot = ucX * upX + ucY * upY + ucZ * upZ;
      if (dot < cosRadius) continue;
      const idx = y * W + x;
      if (mask.data[idx] < params.alpha) mask.data[idx] = params.alpha;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }

  if (maxX < 0) return null;
  return { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
}

function wrapLon(lon: number): number {
  return ((((lon + 180) % 360) + 360) % 360) - 180;
}
