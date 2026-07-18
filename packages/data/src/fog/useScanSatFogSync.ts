import {
  type BodyDefinition,
  getDataSource,
  SCAN_TYPE,
  type SCANCoverageBitmap,
  type SCANType,
  useDataValue,
} from "@ksp-gonogo/core";
import { useEffect } from "react";
import { useFogMaskCache } from "./FogMaskContext";
import { applyScanCoverageToMask } from "./scanCoverageSync";

/**
 * Scan types we keep per-body fog masks for. Each type ends up with its
 * own `BodyMask` keyed by `(bodyId, scanType)`. The MapView composes
 * these at paint time with precedence rules (AltimetryHiRes overrides
 * AltimetryLoRes within the altimetry channel; Biome and Resource
 * channels are independent).
 *
 * Visual (LoRes/HiRes) and Anomaly are deliberately excluded:
 *   - Visual* are deprecated in modern KSP / SCANsat — no stock parts emit
 *     them.
 *   - Anomaly markers are surfaced via `scansat.anomalies.body` directly
 *     (point-based, not area-based fog).
 */
export const FOG_SCAN_TYPES: readonly SCANType[] = [
  SCAN_TYPE.AltimetryLoRes,
  SCAN_TYPE.AltimetryHiRes,
  SCAN_TYPE.Biome,
  SCAN_TYPE.ResourceLoRes,
  SCAN_TYPE.ResourceHiRes,
];

/**
 * Subscribe to one `scansat.mask.body.scanType` per relevant scan
 * type and merge each push into its own per-type fog mask. SCANsat's
 * coverage is per-program (cross-vessel, persists with the save), so
 * each per-type mask reflects the union of every scanner of that type
 * that has ever flown over the body.
 *
 * Pre-rework: this hook subscribed to a single scan type (defaulting to
 * AltimetryHiRes) and wrote into one combined per-body mask. That meant
 * a craft with only RADAR (AltimetryLoRes) scanners never thinned the
 * fog — only AltHiRes coverage was tracked. Per-type masks fix that and
 * preserve channel granularity for the precedence merge in the display
 * canvas.
 */
export function useScanSatFogSync(
  body: BodyDefinition | undefined,
  dataSourceId = "data",
): void {
  const scanAvailable = useDataValue<boolean>(
    dataSourceId,
    "scansat.available",
  );
  const cache = useFogMaskCache();

  useEffect(() => {
    if (!scanAvailable) return;
    if (!body || !cache) return;
    const source = getDataSource(dataSourceId);
    if (!source) return;

    const unsubs: Array<() => void> = [];
    let cancelled = false;

    // Eagerly acquire each per-type mask so the subscribe handler can
    // write into a real buffer the first time SCANsat pushes a frame.
    // Without the acquire, the cache has no entry → markDirty no-ops →
    // the first push silently drops on the floor.
    for (const scanType of FOG_SCAN_TYPES) {
      // FogMaskCache keys on an opaque string layerId; SCANsat's scan types
      // are still a numeric bit-value enum here (unaffected by this
      // package's own generalisation), so stringify at the boundary.
      const layerId = String(scanType);
      void cache.acquire(body.id, layerId).then((mask) => {
        if (cancelled) return;
        const key = `scansat.mask.${body.name}.${scanType}`;
        const unsub = source.subscribe(key, (value) => {
          if (!value || typeof value !== "object") return;
          const bitmap = value as Partial<SCANCoverageBitmap>;
          if (
            typeof bitmap.width !== "number" ||
            typeof bitmap.height !== "number" ||
            typeof bitmap.bits !== "string"
          ) {
            return;
          }
          const changed = applyScanCoverageToMask(
            bitmap as SCANCoverageBitmap,
            mask,
            body,
          );
          if (changed) cache.markDirty(body.id, layerId);
        });
        unsubs.push(unsub);
      });
    }

    return () => {
      cancelled = true;
      for (const u of unsubs) u();
    };
  }, [scanAvailable, body, cache, dataSourceId]);
}

// Re-export for callers — keeps the SCAN_TYPE constants reachable without
// needing the schemas import path.
export { SCAN_TYPE };
