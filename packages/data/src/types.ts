import type { DataKey, TelemaachusSchema } from "@gonogo/core";

// ---------------------------------------------------------------------------
// DataSourceRegistry extension — declaration-merged so `useDataValue('data',
// key)` is strongly typed. The schema starts as a passthrough of the wrapped
// telemachus schema; as derived keys land (Phase 2), they extend this type.
// ---------------------------------------------------------------------------

declare module "@gonogo/core" {
  interface DataSourceRegistry {
    data: TelemaachusSchema;
  }
}

// ---------------------------------------------------------------------------
// Units hint used by the graph widget's axis-grouping heuristic and by
// display formatting. "raw" is the fallback for values we don't want to
// classify.
// ---------------------------------------------------------------------------

export type Unit =
  | "m"
  | "km"
  | "m/s"
  | "km/s"
  | "s"
  | "hr"
  | "°"
  | "°/s"
  | "%"
  | "kg"
  | "N"
  | "kPa"
  | "Pa"
  | "g"
  // "units" covers KSP's dimensionless stock-resource quantities (fuel,
  // oxidiser, monoprop, electric charge…). They're numeric and graphable
  // but have no real SI unit.
  | "units"
  | "bool"
  | "enum"
  | "raw";

/**
 * DataKey enriched with human-facing metadata. The `<DataKeyPicker>` in
 * `@gonogo/ui` consumes these and groups alphabetically within `group`.
 */
export interface DataKeyMeta extends DataKey {
  label: string;
  unit?: Unit;
  group?: string;
}

export interface Sample<V = unknown> {
  /** Unix ms. */
  t: number;
  v: V;
}

/**
 * Columnar series slice. `t` and `v` have identical length. Used as the
 * return shape for `queryRange` + `getLatest` because the graph widget
 * consumes parallel arrays and it's cheaper to stream over PeerJS later.
 */
export interface SeriesRange<V = unknown> {
  t: number[];
  v: V[];
}

/**
 * One inferred flight. Created by the flight detector when a launch is
 * observed, updated on every sample that belongs to it. Persisted to
 * IndexedDB so history survives reloads.
 *
 * `vesselUid` is reserved for a Phase 6 kOS-sourced authoritative ship id.
 * Until then the detector uses `vesselName + missionTime` heuristics.
 */
export interface FlightRecord {
  id: string;
  vesselName: string;
  vesselUid?: string | null;
  launchedAt: number;
  lastSampleAt: number;
  /** Last observed mission time for revert detection. Seconds. */
  lastMissionTime: number;
  sampleCount: number;
  /**
   * User-authored chapters / markers. Window bounds are **elapsed
   * milliseconds since `launchedAt`** so they stay readable when reviewing
   * the record by hand and survive any future re-anchoring of `launchedAt`.
   * Optional — flights start with none.
   */
  chapters?: FlightChapterRecord[];
  /**
   * User-pinned: starred flights are exempt from the "auto-delete after N
   * days" cleanup. Per-row delete and "Clear all" still remove them.
   */
  starred?: boolean;
}

/**
 * One named slice of a flight, persisted on the FlightRecord. Mirrors the
 * shape of `FlightChapter` (used in fixtures) — when the flight is exported,
 * its chapters round-trip into the fixture's chapters array.
 */
export interface FlightChapterRecord {
  id: string;
  label: string;
  /** Elapsed ms since `launchedAt`. */
  startMs: number;
  /** Elapsed ms since `launchedAt`. */
  endMs: number;
}
