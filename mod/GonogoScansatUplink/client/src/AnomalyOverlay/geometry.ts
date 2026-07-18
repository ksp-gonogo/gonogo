import type { SCANAnomalyEntry } from "../schema";

/**
 * Great-circle distance/bearing ranking for the `AnomalyOverlay`'s
 * bearing/distance panel. Ported from `@ksp-gonogo/components`'s
 * `MapView/scanOverlay.ts` (P4c-b — the anomaly display moved out of core
 * MapView into this augment, Uplink invariant #5 "augment, don't embed").
 * Kept pure and package-local: `scanOverlay.ts`'s anomaly helpers weren't
 * part of `@ksp-gonogo/components`'s public export surface, so this is a
 * straight move (delete there, recreate here), not a shared dependency.
 */

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
