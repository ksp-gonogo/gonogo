/**
 * Wire-shape types for the legacy Telemachus fork's `scan.*` keys
 * (`TelemaachusSchema` in `./telemachus.ts`). Telemachus stays installable
 * in KSP as an optional debug tool (see the project's Telemachus API docs)
 * even though the app itself no longer reads from it — these types exist
 * solely so that schema keeps typing correctly.
 *
 * This is a deliberately narrow, telemachus-only copy. The real SCANsat
 * integration (schema, decode, fog-reveal sync) now lives entirely inside
 * `mod/GonogoScansatUplink/client/src/schema.ts` — core no longer owns a
 * shared scansat schema (MapView overlay-host foundation plan, T9).
 */

/**
 * SCANsat scan-type bit values. The fork's `scan.*` keys take an integer
 * matching one of these — bit positions are the same as SCANsat's own
 * `SCANtype` enum so the wire shape mirrors the source mod.
 */
export const SCAN_TYPE = {
  AltimetryLoRes: 1,
  AltimetryHiRes: 2,
  Biome: 8,
  Anomaly: 16,
  AnomalyDetail: 32,
  ResourceLoRes: 128,
  ResourceHiRes: 256,
} as const;
export type SCANType = (typeof SCAN_TYPE)[keyof typeof SCAN_TYPE];

/**
 * `scan.maskBitmap[bodyName, scanType]` response. `bits` is a base64-encoded
 * `(width * height + 7) / 8` byte buffer; each bit (MSB-first within each
 * byte, row-major over coverage) is set when the corresponding 1°×1° tile
 * has been scanned for the requested scan type. The natural granularity is
 * 360×180 (matching SCANsat's own `Coverage` array); clients upsample to
 * their own fog-mask resolution.
 *
 * Coverage indexing follows SCANsat's `icLON`/`icLAT`: bit index
 * `ilon * height + ilat` where `ilon = (int)(lon + 540) % 360` and
 * `ilat = (int)(lat + 270) % 180`. So `ilat=0` is the south pole row,
 * `ilat=height-1` is the north pole row.
 */
export interface SCANCoverageBitmap {
  width: number;
  height: number;
  type: SCANType;
  /** Base64-encoded bit-packed coverage. */
  bits: string;
}

/**
 * `scan.heightGrid[bodyName]` response. `heights` is a base64-encoded
 * `Int16[width*height]` row-major in the same (lon+180)*height + (lat+90)
 * order as the coverage bitmap. Values are metres above the body's
 * reference radius; `minMetres` / `maxMetres` give the colour-ramp
 * extents without a full scan of the decoded array.
 *
 * PQS-backed on the fork side, so this resolves even without SCANsat
 * installed — operators should still gate display behind
 * `scan.maskBitmap` coverage if fog-of-war semantics are desired.
 */
export interface SCANHeightGrid {
  width: number;
  height: number;
  minMetres: number;
  maxMetres: number;
  /** Base64 Int16 little-endian per cell. */
  heights: string;
}

/**
 * One biome entry from `scan.biomeGrid[bodyName].biomes`. `colour` is a
 * packed RGB integer (0xRRGGBB) lifted from KSP's stock BiomeMap so the
 * client doesn't need a colour table of its own.
 */
export interface SCANBiomeEntry {
  name: string;
  displayName: string;
  colour: number;
}

/**
 * `scan.biomeGrid[bodyName]` response. `indices` is a base64 byte-per-
 * cell array; each byte is the position of the cell's biome in `biomes`
 * (or 0xFF for a null biome / a body without a BiomeMap). Same cell
 * order as scan.heightGrid + scan.maskBitmap.
 *
 * Stock BiomeMap-backed — works without SCANsat. Indices saturate at
 * 254; bodies with >254 biomes (unrealistic in stock) collapse the
 * tail.
 */
export interface SCANBiomeGrid {
  width: number;
  height: number;
  biomes: SCANBiomeEntry[];
  /** Base64 byte-per-cell. */
  indices: string;
}

/**
 * One scanner module on a `scan.scanningVessels` vessel. `type` is the
 * SCANsat `SCANtype` bit value (see SCAN_TYPE); a single vessel can carry
 * scanners of several types. `inRange` / `bestRange` reflect SCANsat's
 * own per-tick range gates: inRange means the vessel is between
 * `minAlt` and `maxAlt`, bestRange means it's at the high-fidelity
 * altitude. Below `minAlt` or above `maxAlt` both are false and the
 * scanner is idle.
 */
export interface SCANSensorEntry {
  type: number;
  fov: number;
  minAlt: number;
  maxAlt: number;
  bestAlt: number;
  inRange: boolean;
  bestRange: boolean;
}

/**
 * One entry from `scan.scanningVessels`. SCANsat tracks unloaded vessels
 * too, so this list is *cross-vessel by design* — a satellite mapping
 * Kerbin and a probe orbiting Mun both appear here at the same time.
 * `subLatitude` / `subLongitude` are the sub-satellite ground point;
 * the scanning footprint is a circle centred there with radius derived
 * from each sensor's `fov` and the body radius.
 */
export interface SCANScanningVessel {
  vesselId: string;
  vesselName: string;
  body: string;
  subLatitude: number;
  subLongitude: number;
  altitude: number;
  sensors: SCANSensorEntry[];
  /**
   * SCANsat's actual current ground-track FoV for this vessel in
   * degrees — reflected from the private `SCANcontroller.getFOV`
   * (the same number used to paint the in-flight overlay via
   * `drawGroundTrackTris`). This is the per-side latitude half-width.
   * Null when SCANsat is not installed or the vessel currently has
   * no in-range sensors.
   */
  groundTrackWidthDeg?: number | null;
  /**
   * Per-side longitude half-width in degrees, computed fork-side as
   * `groundTrackWidthDeg / cos(|subLat|)` and capped at 120°,
   * matching the widening SCANsat applies inside its coverage paint
   * loop. Null when SCANsat is not installed or the vessel has no
   * in-range sensors.
   */
  groundTrackLonHalfDeg?: number | null;
  /**
   * SCANsat's combined per-vessel `trackColor` (Color32). Use the
   * same tint on minimap footprints so the rendering matches the
   * in-game overlay. Null when SCANsat is not installed.
   */
  trackColor?: { r: number; g: number; b: number; a: number } | null;
}

/**
 * One anomaly from `scan.anomalies[bodyName]`. `known` is true once the
 * player has discovered the anomaly's position (SCANsat Anomaly scan);
 * `detail` is true once they have the name (AnomalyDetail scan). Pre-
 * discovery, the entry can still appear but with `known: false` — useful
 * for "this body has N anomalies, M discovered" readouts but not for
 * marker rendering.
 */
export interface SCANAnomalyEntry {
  name: string;
  latitude: number;
  longitude: number;
  known: boolean;
  detail: boolean;
}
