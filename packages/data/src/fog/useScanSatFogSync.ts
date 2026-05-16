import {
  type BodyDefinition,
  getDataSource,
  SCAN_TYPE,
  type SCANCoverageBitmap,
  type SCANType,
  useDataValue,
} from "@gonogo/core";
import { useEffect } from "react";
import { useBodyFogMask, useFogMaskCache } from "./FogMaskContext";
import { applyScanCoverageToMask, DEFAULT_SCAN_TYPE } from "./scanCoverageSync";

/**
 * When SCANsat is installed and the active body is known, subscribe to
 * `scan.maskBitmap[bodyName, scanType]` and merge every push into the
 * gonogo fog mask. SCANsat's coverage is per-program (cross-vessel,
 * persists with the save), so this layer is *additive* to the painter
 * — both write the same `BodyMask` via max-lighten, and the painter's
 * per-vessel imaging continues to fill in tiles SCANsat hasn't reached
 * yet (low altitude / no scanner / un-mapped FOV).
 *
 * The scan-type defaults to AltimetryHiRes (the densest stock-style
 * scan); callers can pass a different bit if they want biome / anomaly
 * / resource layers as the truth source instead.
 */
export function useScanSatFogSync(
  body: BodyDefinition | undefined,
  scanType: SCANType = DEFAULT_SCAN_TYPE,
  dataSourceId = "data",
): void {
  const scanAvailable = useDataValue<boolean>(dataSourceId, "scan.available");
  const cache = useFogMaskCache();
  const { mask } = useBodyFogMask(body?.id);

  useEffect(() => {
    if (!scanAvailable) return;
    if (!body || !mask || !cache) return;
    const source = getDataSource(dataSourceId);
    if (!source) return;

    const key = `scan.maskBitmap[${body.name},${scanType}]`;
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
      if (changed) cache.markDirty(body.id);
    });
    return unsub;
  }, [scanAvailable, body, mask, cache, scanType, dataSourceId]);
}

// Re-export for callers — keeps the SCAN_TYPE constants reachable without
// needing the schemas import path.
export { SCAN_TYPE };
