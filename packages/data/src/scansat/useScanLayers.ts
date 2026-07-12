import type {
  SCANAnomalyEntry,
  SCANBiomeGrid,
  SCANCoverageBitmap,
  SCANHeightGrid,
  SCANScanningVessel,
  SCANType,
} from "@ksp-gonogo/core";
import { useDataValue } from "@ksp-gonogo/core";
import { useMemo } from "react";
import type {
  DecodedBiomes,
  DecodedCoverage,
  DecodedHeights,
} from "./scanDecode";
import {
  decodeBiomeGrid,
  decodeCoverage,
  decodeHeightGrid,
} from "./scanDecode";

/**
 * Live snapshot of SCANsat's per-tile coverage bitfield for the named
 * body and scan-type. `undefined` until the first push lands; `null` if
 * SCANsat isn't installed (the fork returns null on every SCANsat-only
 * key in that case).
 */
export function useScanCoverage(
  bodyName: string | undefined,
  scanType: SCANType,
  dataSourceId = "data",
): DecodedCoverage | null | undefined {
  const raw = useDataValue<SCANCoverageBitmap | null>(
    dataSourceId,
    bodyName ? `scansat.mask.${bodyName}.${scanType}` : "scansat.available",
  );
  return useMemo(() => {
    if (!bodyName) return undefined;
    if (raw == null) return raw as null | undefined;
    return decodeCoverage(raw);
  }, [raw, bodyName]);
}

/**
 * Live snapshot of the per-tile elevation grid (PQS-backed, doesn't
 * actually need SCANsat installed — the fork resolves it from stock).
 */
export function useScanHeightGrid(
  bodyName: string | undefined,
  dataSourceId = "data",
): DecodedHeights | null | undefined {
  const raw = useDataValue<SCANHeightGrid | null>(
    dataSourceId,
    bodyName ? `scansat.height.${bodyName}` : "scansat.available",
  );
  return useMemo(() => {
    if (!bodyName) return undefined;
    if (raw == null) return raw as null | undefined;
    return decodeHeightGrid(raw);
  }, [raw, bodyName]);
}

/**
 * Live snapshot of the per-tile biome grid + body's biome name/colour
 * table (stock BiomeMap-backed, no SCANsat install required).
 */
export function useScanBiomeGrid(
  bodyName: string | undefined,
  dataSourceId = "data",
): DecodedBiomes | null | undefined {
  const raw = useDataValue<SCANBiomeGrid | null>(
    dataSourceId,
    bodyName ? `scansat.biome.${bodyName}` : "scansat.available",
  );
  return useMemo(() => {
    if (!bodyName) return undefined;
    if (raw == null) return raw as null | undefined;
    return decodeBiomeGrid(raw);
  }, [raw, bodyName]);
}

/**
 * Anomalies known to SCANsat for the given body, with per-anomaly
 * discovery state. The list always returns the same anomalies for a
 * given save+body (KSP places them at world-gen); the per-entry
 * `known` and `detail` flags toggle as the player scans.
 */
export function useScanAnomalies(
  bodyName: string | undefined,
  dataSourceId = "data",
): SCANAnomalyEntry[] | null | undefined {
  const raw = useDataValue<SCANAnomalyEntry[] | null>(
    dataSourceId,
    bodyName ? `scansat.anomalies.${bodyName}` : "scansat.available",
  );
  if (!bodyName) return undefined;
  if (raw == null) return raw as null | undefined;
  return raw;
}

/**
 * Live list of vessels SCANsat is tracking (loaded or unloaded). Used
 * by the Scanning widget — MapView consumes a flat anomaly list and a
 * single-body fog mask, but the Scanning widget surfaces the per-
 * vessel scanner + footprint detail.
 */
export function useScanningVessels(
  dataSourceId = "data",
): SCANScanningVessel[] | null | undefined {
  return useDataValue<SCANScanningVessel[] | null>(
    dataSourceId,
    "scansat.scanningVessels",
  );
}
