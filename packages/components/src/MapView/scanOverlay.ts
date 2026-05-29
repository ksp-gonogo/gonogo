import type {
  BodyDefinition,
  SCANAnomalyEntry,
  SCANScanningVessel,
} from "@gonogo/core";
import { latLonToMap } from "@gonogo/core";
import { WORLD_H, WORLD_W } from "./camera";

/**
 * World-space rendering helpers for the SCANsat MapView extensions:
 * scanning-vessel ground-track footprints (B) and the great-circle
 * anomaly distance/bearing list (C). Kept out of index.tsx so the
 * geometry is unit-testable without mounting the widget.
 */

function wrapLon180(lon: number): number {
  const wrapped = ((((lon + 180) % 360) + 360) % 360) - 180;
  return wrapped === 180 ? -180 : wrapped;
}

/**
 * Paint every scanning vessel's footprint rectangle onto the world-space
 * overlay canvas. Caller has already applied the camera transform, so we
 * draw in WORLD_W×WORLD_H coordinates.
 *
 * Extents come straight off the wire — `groundTrackWidthDeg` is the
 * per-side LATITUDE half-width (SCANsat's `getFOV` via reflection),
 * `groundTrackLonHalfDeg` is the per-side LONGITUDE half-width (the
 * fork's 1/cos widening, capped at 120°). Tint mirrors `trackColor`
 * (Color32, 0–255 components). Only vessels on `body` are drawn. The
 * body's `longitudeOffset` / `latitudeOffset` are applied so the rect
 * lines up with the rendered base map; the antimeridian wrap is split
 * into two fillRects (mirrors `tileToPixelRect`).
 */
export function drawScanningFootprints(
  ctx: CanvasRenderingContext2D,
  body: BodyDefinition,
  vessels: readonly SCANScanningVessel[],
  camZoom: number,
): void {
  const lonOff = body.longitudeOffset ?? 0;
  const latOff = body.latitudeOffset ?? 0;
  const strokeW = Math.max(0.75, 1 / camZoom);

  for (const v of vessels) {
    if (v.body !== body.name) continue;
    const halfLat = v.groundTrackWidthDeg;
    const halfLon = v.groundTrackLonHalfDeg;
    if (halfLat == null || halfLat <= 0) continue;
    if (halfLon == null || halfLon <= 0) continue;

    const tc = v.trackColor;
    const fill = tc
      ? `rgba(${tc.r}, ${tc.g}, ${tc.b}, ${(((tc.a ?? 255) / 255) * 0.45).toFixed(3)})`
      : "rgba(255, 255, 255, 0.3)";
    const stroke = tc
      ? `rgba(${tc.r}, ${tc.g}, ${tc.b}, 0.9)`
      : "rgba(255, 255, 255, 0.7)";

    // Latitude band (no wrap — clamp to the poles).
    const latTop = Math.min(90, v.subLatitude + halfLat + latOff);
    const latBot = Math.max(-90, v.subLatitude - halfLat + latOff);
    const { y: yTop } = latLonToMap(latTop, 0, WORLD_W, WORLD_H);
    const { y: yBot } = latLonToMap(latBot, 0, WORLD_W, WORLD_H);
    const rectY = Math.min(yTop, yBot);
    const rectH = Math.abs(yBot - yTop);

    // Longitude band, offset-adjusted + wrapped to [-180, 180).
    const cLon = wrapLon180(v.subLongitude + lonOff);
    const lonLo = cLon - halfLon;
    const lonHi = cLon + halfLon;
    const { x: xLoRaw } = latLonToMap(0, wrapLon180(lonLo), WORLD_W, WORLD_H);
    const { x: xHiRaw } = latLonToMap(0, wrapLon180(lonHi), WORLD_W, WORLD_H);

    ctx.fillStyle = fill;
    ctx.strokeStyle = stroke;
    ctx.lineWidth = strokeW;

    if (halfLon * 2 >= 360) {
      // Spans the whole map — single full-width rect.
      ctx.fillRect(0, rectY, WORLD_W, rectH);
      ctx.strokeRect(0, rectY, WORLD_W, rectH);
    } else if (xHiRaw > xLoRaw) {
      const rw = xHiRaw - xLoRaw;
      ctx.fillRect(xLoRaw, rectY, rw, rectH);
      ctx.strokeRect(xLoRaw, rectY, rw, rectH);
    } else {
      // Wraps the antimeridian — two slices.
      const rwRight = WORLD_W - xLoRaw;
      ctx.fillRect(xLoRaw, rectY, rwRight, rectH);
      ctx.strokeRect(xLoRaw, rectY, rwRight, rectH);
      ctx.fillRect(0, rectY, xHiRaw, rectH);
      ctx.strokeRect(0, rectY, xHiRaw, rectH);
    }
  }
}

export interface AnomalyDistance {
  anomaly: SCANAnomalyEntry;
  /** Great-circle distance in metres along the body surface. */
  distanceMetres: number;
  /** Initial bearing from the vessel toward the anomaly, degrees [0,360). */
  bearingDeg: number;
}

/** Great-circle (haversine) distance in metres between two lat/lon points. */
export function greatCircleMetres(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
  radiusMetres: number,
): number {
  const toRad = Math.PI / 180;
  const φ1 = lat1 * toRad;
  const φ2 = lat2 * toRad;
  const dφ = (lat2 - lat1) * toRad;
  const dλ = (lon2 - lon1) * toRad;
  const a =
    Math.sin(dφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(dλ / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return radiusMetres * c;
}

/** Initial great-circle bearing in degrees [0,360) from point 1 → point 2. */
export function initialBearingDeg(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const toRad = Math.PI / 180;
  const φ1 = lat1 * toRad;
  const φ2 = lat2 * toRad;
  const dλ = (lon2 - lon1) * toRad;
  const y = Math.sin(dλ) * Math.cos(φ2);
  const x =
    Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(dλ);
  const θ = Math.atan2(y, x) / toRad;
  return (θ + 360) % 360;
}

/** 16-point compass abbreviation for a bearing in degrees. */
export function compassPoint(bearingDeg: number): string {
  const points = [
    "N",
    "NNE",
    "NE",
    "ENE",
    "E",
    "ESE",
    "SE",
    "SSE",
    "S",
    "SSW",
    "SW",
    "WSW",
    "W",
    "WNW",
    "NW",
    "NNW",
  ];
  const idx = Math.round(bearingDeg / 22.5) % 16;
  return points[idx];
}

/**
 * Known anomalies sorted ascending by great-circle distance from the
 * vessel sub-point. Only `known` anomalies are included (the operator
 * can't navigate to what they haven't discovered). Returns distance +
 * bearing for each. When `vesselLat`/`vesselLon` are undefined the list
 * is name-only (distance/bearing set to NaN, sort falls back to name).
 */
export function rankAnomaliesByDistance(
  anomalies: readonly SCANAnomalyEntry[],
  vesselLat: number | undefined,
  vesselLon: number | undefined,
  radiusMetres: number,
): AnomalyDistance[] {
  const known = anomalies.filter((a) => a.known);
  const haveVessel = vesselLat !== undefined && vesselLon !== undefined;
  const ranked = known.map((anomaly) => {
    if (!haveVessel) {
      return { anomaly, distanceMetres: Number.NaN, bearingDeg: Number.NaN };
    }
    const distanceMetres = greatCircleMetres(
      vesselLat,
      vesselLon,
      anomaly.latitude,
      anomaly.longitude,
      radiusMetres,
    );
    const bearingDeg = initialBearingDeg(
      vesselLat,
      vesselLon,
      anomaly.latitude,
      anomaly.longitude,
    );
    return { anomaly, distanceMetres, bearingDeg };
  });
  ranked.sort((a, b) => {
    if (Number.isNaN(a.distanceMetres) || Number.isNaN(b.distanceMetres)) {
      return a.anomaly.name.localeCompare(b.anomaly.name);
    }
    return a.distanceMetres - b.distanceMetres;
  });
  return ranked;
}
