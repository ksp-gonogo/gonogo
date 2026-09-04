import type { DataKey, StreamStatusValue } from "../api/types";
import type { ReckoningBasis } from "../reading";
import type { SitrepUnit } from "../units";

// ---------------------------------------------------------------------------
// Units hint used by the graph widget's axis-grouping heuristic and by
// display formatting. "raw" is the fallback for values we don't want to
// classify.
// ---------------------------------------------------------------------------

export type UnitHint =
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
  | "kg/m³"
  | "N"
  | "kPa"
  | "Pa"
  | "g"
  | "K"
  | "W/m²"
  // "units" covers KSP's dimensionless stock-resource quantities (fuel,
  // oxidiser, monoprop, electric charge...). They're numeric and graphable
  // but have no real SI unit.
  | "units"
  | "bool"
  | "enum"
  | "raw";

/**
 * DataKey enriched with human-facing metadata. A key picker consumes these
 * and groups alphabetically within `group`.
 */
export interface DataKeyMeta extends DataKey {
  label: string;
  /**
   * The contract's own unit token. Open rather than the closed `UnitHint`
   * union below: a key enumerated from the contract carries whatever token the
   * contract declares, an Uplink registers tokens of its own, and a closed
   * union cannot accept either.
   */
  unit?: SitrepUnit;
  group?: string;
}

export interface Sample<V = unknown> {
  /** Unix ms. */
  t: number;
  v: V;
}

/**
 * Which clock a `SeriesRange`'s `t` is stamped against.
 *
 * The two producers of a series use different ones and always did:
 * `TimelineStore.sampleRange` hands back the game's UT SECONDS, and the legacy
 * `BufferedDataSource` buffers wall-clock MILLISECONDS. Nothing said so, so
 * every consumer had to guess, and the chart guessed wall-clock: it scaled UT
 * samples against a `Date.now()` domain (fixed by `computeTimeDomain`) and then
 * went on labelling a twenty-minute window `0:00 ... 0:01`, a factor of a
 * thousand out, under a trace that was by then drawn correctly.
 *
 * A basis cannot be inferred from the numbers: both are large monotonic
 * counts, and the wrong reading of either is plausible. So the producer states
 * it, and a consumer that does arithmetic on `t` reads the declaration.
 */
export type SeriesTimeBasis = "ut-seconds" | "wall-ms";

/**
 * A contiguous run of samples that share a stream status other than `"live"`,
 * as INCLUSIVE indices into `t`/`v`.
 *
 * What the wire knows and a plain `{t, v}` throws away: which part of a trace
 * came off the craft's own recorder during a blackout, and which part arrived
 * live. `breaks` carries what is GONE; this carries what is merely LATE.
 *
 * **It is a record, not a warning, and a trace should not mark it.** Every
 * sample named here is one the craft MEASURED; the only thing that differs is
 * that the operator did not have it while the blackout was on, and once it is
 * filled in that is history rather than a property of the sample. Setting it
 * apart on a chart says "trust this less" about a reading that is exact, so
 * the built-in graph draws a run named here exactly as it draws a live one.
 * Use this to NAME the provenance (a readout, a caption, a DOM attribute),
 * never to grade it. What a trace has cause to set apart is a value nobody
 * measured at all, which is not this and does not come off the wire.
 *
 * A RANGE rather than a per-sample status array, for the two reasons `breaks`
 * chose indices: a chart draws a SEGMENT, so a per-sample encoding only makes
 * every consumer re-derive these runs before it can draw anything, and the
 * all-live case (very nearly all of them) costs one empty array rather than one
 * string per sample.
 *
 * Only server-stamped grades appear here. `held-stale` and `disconnected` are
 * inferred about the topic NOW, not recorded about a sample, so they have no
 * honest per-sample extent to name.
 */
export interface SeriesStatusSpan {
  /** First sample of the run. */
  from: number;
  /** Last sample of the run, inclusive. */
  to: number;
  status: StreamStatusValue;
}

/**
 * A contiguous run of points NOBODY MEASURED, as INCLUSIVE indices into
 * `t`/`v`: a model answered for those instants, and `basis` is the model that
 * did the answering, in the vocabulary `Reckoning` already uses.
 *
 * This is the ONLY provenance a trace has cause to mark. A replayed sample is a
 * sample the craft measured and sent late, so it draws as live data draws (see
 * {@link SeriesStatusSpan}); a reckoned one is a claim the CHART is making on
 * its own behalf, and drawing arithmetic in the same stroke as a reading is a
 * lie about where the line came from.
 *
 * It sits beside `SeriesStatusSpan` rather than inside it because the two are
 * not the same kind of fact and must never collapse into one enum: a status
 * span names where an OBSERVATION came from, and a reckoned run says there was
 * no observation. Only the second one comes out of a model, and only the second
 * one carries a basis.
 */
export interface SeriesReckonedSpan {
  /** First point of the run. */
  from: number;
  /** Last point of the run, inclusive. */
  to: number;
  basis: ReckoningBasis;
}

/**
 * Columnar series slice. `t` and `v` have identical length. Used as the
 * return shape for `queryRange` + `getLatest` because the graph widget
 * consumes parallel arrays and it's cheaper to stream over PeerJS later.
 */
export interface SeriesRange<V = unknown> {
  t: number[];
  v: V[];

  /**
   * The clock `t` is stamped against. Absent means `"wall-ms"`: that is what
   * every producer predating the field emitted, and reading an unstated series
   * as wall-clock keeps those callers exactly where they were.
   */
  basis?: SeriesTimeBasis;

  /**
   * Indices at which a KNOWN break precedes the point: `breaks: [7]` means
   * there is no data between `t[6]` and `t[7]`, and it is missing rather than
   * simply not sampled. Absent or empty means the series is continuous.
   *
   * A chart must not join across one. Every consumer of this type before now
   * assumed `t`/`v` were continuous, which was safe only while nothing could
   * produce a hole: a stream's samples arrived one at a time and a stored
   * flight was recorded start to finish. The blackout recorder produces holes
   * (`Meta.gapSinceUt`), and without this index the store carried the
   * discontinuity and the series boundary threw it away, so a chart drew a
   * straight line through an outage it had no readings for. A line the operator
   * cannot tell from data is worse than a visible break.
   *
   * Indices rather than a parallel per-point flag array so the continuous case
   * (very nearly all of them) costs one empty array rather than one boolean per
   * sample, and so a consumer that ignores the field behaves exactly as it did.
   */
  breaks?: number[];

  /**
   * Runs of samples carrying a server-stamped status other than `"live"`, in
   * ascending order and non-overlapping. Absent or empty means every sample in
   * the slice arrived live. See {@link SeriesStatusSpan}.
   */
  spans?: SeriesStatusSpan[];

  /**
   * Runs of points a MODEL produced rather than the craft, in ascending order
   * and non-overlapping. Absent or empty means every point in the slice was
   * measured. See {@link SeriesReckonedSpan}.
   *
   * A reckoned point is a presentation-time projection and it is minted at the
   * boundary that draws it. Nothing puts one in a store, in a recording or in
   * an export, so a `SeriesRange` that came out of `queryRange` never carries
   * this and a later read can never mistake one for an observation.
   */
  reckoned?: SeriesReckonedSpan[];
}

/**
 * One inferred flight. Created by the flight detector when a launch is
 * observed, updated on every sample that belongs to it. Persisted to
 * IndexedDB so history survives reloads.
 *
 * `vesselUid` is reserved for an authoritative ship id sourced from the
 * vessel. Until then the detector uses `vesselName + missionTime` heuristics.
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
   * Optional: flights start with none.
   */
  chapters?: FlightChapterRecord[];
  /**
   * User-pinned: starred flights are exempt from the "auto-delete after N
   * days" cleanup. Per-row delete and "Clear all" still remove them.
   */
  starred?: boolean;
  /**
   * Final outcome of the flight, populated when KSP fires a recovery
   * dialog (`recovery.lastSummary`) or a crash (`crash.lastCrash`).
   * Untouched while the flight is in progress and on flights that
   * neither finished cleanly nor crashed (e.g. a save reload pulled
   * the vessel out from under the detector). Most-recent-outcome
   * wins if both events fire for the same vessel, KSP can crash a
   * vessel and the operator might still recover its remains.
   */
  outcome?: FlightOutcome;
  /**
   * UT (seconds) of the first/last captured frame, populated only by a
   * UT-based recorder (`BufferedDataSource`'s own flights have no UT domain
   * at all and leave these undefined). A graph over such a record needs the
   * real UT bounds to call `queryRange` correctly,
   * they can't be reconstructed from `launchedAt`/`lastSampleAt` alone,
   * since those stay wall-clock-ms-shaped for backward compatibility with
   * every other `FlightRecord` consumer, duration calculations included.
   */
  firstFrameUt?: number;
  lastFrameUt?: number;
}

/**
 * Recovery-side outcome: KSP completed its post-flight tally and
 * surfaced the mission summary dialog. Captures the bits relevant to
 * a flight-record view (vesselName + headline scalars + crew); the
 * full breakdown lives on `recovery.lastSummary` and isn't duplicated
 * onto every flight record.
 */
export interface FlightRecoveryOutcome {
  kind: "recovered";
  /** Wall-clock ms when the outcome was captured. */
  recordedAt: number;
  recoveryLocation: string;
  recoveryFactor: string;
  fundsEarned: number;
  scienceEarned: number;
  reputationEarned: number;
  /** Names of crew that were aboard at recovery. */
  crew: string[];
}

/**
 * Crash-side outcome: KSP fired `onCrash` / `onCrashSplashdown`
 * for the vessel. Records the headline cause and any kerbals killed.
 */
export interface FlightCrashOutcome {
  kind: "crashed";
  recordedAt: number;
  body: string;
  situation: string;
  what: string;
  partsLostCount: number;
  kerbalsKilled: string[];
}

export type FlightOutcome = FlightRecoveryOutcome | FlightCrashOutcome;

/**
 * One named slice of a flight, persisted on the FlightRecord. Mirrors the
 * shape of `FlightChapter` (used in fixtures): when the flight is exported,
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

/**
 * Small, cheap-to-list metadata for one recorded mission. Kept in its own
 * object store, separate from the (potentially large) `fixture` payload, so
 * populating the FlightsManager list never has to pull every recording's raw
 * wire frames into memory.
 */
export interface MissionMeta {
  id: string;
  vesselName: string;
  /** Wall-clock ms when recording started. */
  launchedAt: number;
  /** UT (seconds) of the first captured frame. */
  firstFrameUt: number;
  /** UT (seconds) of the last captured frame. */
  lastFrameUt: number;
  frameCount: number;
  /**
   * User-pinned: starred missions are exempt from `pruneMissionsKeepLatest`.
   * Per-row delete and "Clear all" still remove them. Optional/backward
   * compatible: existing rows read as `undefined` (falsy, same as
   * unstarred).
   */
  starred?: boolean;
  /**
   * User-authored chapters / markers, as `FlightChapterRecord`. Its
   * `startMs`/`endMs` are literal milliseconds elapsed since `firstFrameUt`,
   * converted from the mission's UT-second delta as
   * `(ut - firstFrameUt) * 1000`. The unit stays ms so an editor formatting and
   * parsing these does plain ms arithmetic and needs nothing special: only the
   * anchor is a UT. Optional: missions start with none.
   */
  chapters?: FlightChapterRecord[];
}
