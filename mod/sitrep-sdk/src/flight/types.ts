import type { DataKey, StreamStatusValue } from "../api/types";
import type { BandKind, Reading, ReckoningBasis } from "../reading";
import type { TopicId } from "../topics";
import type { SitrepUnit } from "../units";

// Units hint used by the graph widget's axis-grouping heuristic and by display formatting. "raw" is the fallback for values we don't want to classify.

/**
 * A display unit for a recorded key, used to group chart axes and format values.
 * `raw` leaves the value unformatted.
 *
 * @category Flight recording
 */
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
 * A {@link DataKey} with what a key picker shows: its label, unit and group.
 * The picker sorts keys alphabetically within each group.
 *
 * @category Flight recording
 */
export interface DataKeyMeta extends DataKey {
  /** What an operator reads for the key. */
  label: string;
  /**
   * The key's unit, as the contract or an Uplink declares it.
   */
  unit?: SitrepUnit;
  /** The group the key is filed under. */
  group?: string;
}

/**
 * One recorded value and the wall-clock time it was taken.
 *
 * @category Flight recording
 */
export interface Sample<Payload = unknown> {
  /** Unix ms. */
  t: number;
  /** The value. */
  v: Payload;
}

/**
 * Which clock a `SeriesRange`'s `t` is stamped against.
 *
 * The two producers of a series use different ones: `TimelineStore.sampleRange`
 * hands back the game's UT seconds, and `BufferedDataSource` buffers wall-clock
 * milliseconds.
 *
 * A basis cannot be inferred from the numbers: both are large monotonic
 * counts, and the wrong reading of either is plausible. So the producer states
 * it, and a consumer that does arithmetic on `t` reads the declaration.
 *
 * @category Flight recording
 */
export type SeriesTimeBasis = "ut-seconds" | "wall-ms";

/**
 * A run of samples that share a stream status other than `"live"`, as
 * inclusive indices into `t` and `v`: the part of a trace that came off the
 * craft's own recorder after a blackout rather than arriving live.
 *
 * Every sample in it was measured by the craft and is exact; it only arrived
 * late. So the built-in graph draws it exactly as it draws live data, and a
 * consumer should use it to name where a sample came from (a readout, a
 * caption), never to draw it as less certain. {@link SeriesReckonedSpan} is the
 * one to set apart.
 *
 * Only statuses the mod stamps on a sample appear here. `held` and
 * `disconnected` describe a Topic now, not a recorded sample, so they never do.
 *
 * @category Flight recording
 */
export interface SeriesStatusSpan {
  /** First sample of the run. */
  from: number;
  /** Last sample of the run, inclusive. */
  to: number;
  /** The status the run carried. */
  status: StreamStatusValue;
}

/**
 * A run of points nobody measured, as inclusive indices into `t` and `v`: a
 * model supplied them, and `basis` names the model, in the vocabulary
 * `Reckoning` uses.
 *
 * This is the one kind of span a trace should set apart, since the line there
 * is a model's estimate rather than a reading. A sample in a
 * {@link SeriesStatusSpan} was measured and only arrived late.
 *
 * @category Flight recording
 */
export interface SeriesReckonedSpan {
  /** First point of the run. */
  from: number;
  /** Last point of the run, inclusive. */
  to: number;
  /** The kind of model that made the run. */
  basis: ReckoningBasis;
  /**
   * The lower bound of how well the model knew each point of the run, in the
   * units of `v`, one entry per point from `from` to `to`. `bandLo`, `bandHi`
   * and `bandKind` come together: a run missing any of them has no band.
   */
  bandLo?: number[];
  /** The upper bound, as `bandLo` gives the lower. */
  bandHi?: number[];
  /** What `bandLo` and `bandHi` mean. See `UncertaintyBand`. */
  bandKind?: BandKind;
}

/**
 * What a value's own model says happened inside one gap between two samples:
 * its values at instants strictly inside the gap, in the clock of `t` and the
 * units of `v`.
 *
 * `to` is the index of the later sample, as in `breaks`. Where the straight
 * line from `to - 1` to `to` and the model's path part by more than the chart
 * can draw, the chart breaks the line there or draws the model's path instead.
 * A gap the model could not cover at all is a `breaks` index, not a bridge.
 *
 * Computed when the series is read; never stored.
 *
 * @category Flight recording
 */
export interface SeriesBridge {
  /** Index of the point the bridge runs to. */
  to: number;
  /** The times of the points the model carried. */
  t: readonly number[];
  /** The values the model carried. */
  v: readonly number[];
  /** The kind of model that carried them. */
  basis: ReckoningBasis;
}

/**
 * A window of a series as parallel arrays: `t` and `v` have the same length.
 * `queryRange` and `getLatest` return one.
 *
 * @category Flight recording
 */
export interface SeriesRange<Payload = unknown> {
  /** The time of each point. */
  t: number[];
  /** The value of each point. */
  v: Payload[];

  /**
   * The clock `t` is stamped against. Absent means `"wall-ms"`: that is what
   * every producer predating the field emitted, and reading an unstated series
   * as wall-clock keeps those callers exactly where they were.
   */
  basis?: SeriesTimeBasis;

  /**
   * Indices at which a known gap comes before the point: `breaks: [7]` means
   * there is no data between `t[6]` and `t[7]`, because it is missing rather
   * than because nothing was sampled. Absent or empty means the series is
   * continuous. Never draw a line across a break.
   */
  breaks?: number[];

  /**
   * Runs of samples carrying a server-stamped status other than `"live"`, in
   * ascending order and non-overlapping. Absent or empty means every sample in
   * the slice arrived live. See {@link SeriesStatusSpan}.
   */
  spans?: SeriesStatusSpan[];

  /**
   * Runs of points a model produced rather than the craft, in ascending order
   * and not overlapping. Absent or empty means every point was measured. See
   * {@link SeriesReckonedSpan}.
   *
   * Modelled points are made when the series is read for drawing; nothing saves
   * one, so a series read from a saved flight never has any.
   */
  reckoned?: SeriesReckonedSpan[];

  /**
   * One entry per gap the sampling missed and the value's own model carried,
   * ascending by `to`. Absent or empty means no chord in the slice crosses a
   * span a model has something to say about. See {@link SeriesBridge}.
   */
  bridges?: SeriesBridge[];

  /**
   * The instant the window was asked for, in the series' time basis, when the
   * reader knows it. A saved flight's range does not carry it.
   *
   * `t` may end well before it, as when a model stops short of the view time.
   * Draw the axis out to this instant, so the gap between the last point and
   * now shows.
   */
  windowEndAt?: number;
}

/**
 * One plotted quantity: a Topic, and the dotted path of one field inside its
 * payload. Leave out `field` for a Topic whose whole payload is the quantity.
 *
 * @category Flight recording
 */
export interface TopicFieldHandle {
  /** A contract Topic, or any string for a registered, derived or computed one. */
  topic: TopicId | (string & {});
  /** The dotted path of the field inside the payload. */
  field?: string;
}

/**
 * The flat key a {@link TopicFieldHandle} reads: `<topic>.<field>`, or the
 * Topic alone.
 *
 * @category Flight recording
 */
export function seriesKeyOf(handle: TopicFieldHandle): string {
  return handle.field ? `${handle.topic}.${handle.field}` : handle.topic;
}

/**
 * A window of a series in which every sample is a {@link Reading}: the value
 * with its unit, and how it came to be known. `t` and `readings` have the same
 * length, and `t` ascends.
 *
 * Each sample reads as a point read at that instant would have:
 *
 * - `"observed"`: the craft measured it and it arrived live
 * - `"held"` with grade `"recorded"` or `"last-before-blackout"`: the craft
 *   measured it and it arrived late. It is exact for its instant, so a trace
 *   draws it as it draws a live sample
 * - `"held"` with `reckoning.status` `"available"`: nobody measured this
 *   instant. `value` is the last observation before it, and
 *   `reckoning.modelled` is the model's value for it, with its `basis` and,
 *   where the model gives one, its `band`. Only these should be set apart on a
 *   trace
 *
 * {@link SeriesRange} carries the same window as bare numbers. Use this one for
 * anything drawn live; a saved flight is read back as a `SeriesRange`.
 *
 * @typeParam Payload - What each sample holds: a `Value` for a quantity.
 *
 * @category Flight recording
 */
export interface ReadingSeriesRange<Payload = unknown> {
  /** The time of each reading. */
  t: number[];
  /** The readings, one per time. */
  readings: Reading<Payload>[];
  /** The clock `t` is stamped against. See {@link SeriesRange.basis}. */
  basis?: SeriesTimeBasis;
  /** Indices a known hole precedes. See {@link SeriesRange.breaks}. */
  breaks?: number[];
  /** Gaps the sampling missed and the value's own model carried. See {@link SeriesBridge}. */
  bridges?: SeriesBridge[];
  /** The instant the window was asked for. See {@link SeriesRange.windowEndAt}. */
  windowEndAt?: number;
}

/**
 * One flight, recognised when a launch is seen and updated with every sample
 * that belongs to it. Saved in the browser, so flight history survives a
 * reload.
 *
 * @category Flight recording
 */
export interface FlightRecord {
  /** This flight's identifier. */
  id: string;
  /** The vessel's name when the recording began. */
  vesselName: string;
  /** The game's identifier for the vessel, when it has one. */
  vesselUid?: string | null;
  /** Wall-clock ms when the recording began. */
  launchedAt: number;
  /** Wall-clock ms of the latest sample. */
  lastSampleAt: number;
  /** Last observed mission time for revert detection. Seconds. */
  lastMissionTime: number;
  /** How many samples have been recorded. */
  sampleCount: number;
  /**
   * User-authored chapters / markers. Window bounds are **elapsed
   * milliseconds since `launchedAt`** so they stay readable when reviewing
   * the record by hand and survive any future re-anchoring of `launchedAt`.
   * Optional: flights start with none.
   */
  chapters?: FlightChapterRecord[];
  /**
   * Whether the operator starred the flight. Starred flights are never
   * auto-deleted, but can still be deleted by hand.
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
   * The UT, in seconds, of the first captured frame, set only by a recorder
   * that works in UT. A graph of such a record queries its range with these:
   * `launchedAt` and `lastSampleAt` are wall-clock milliseconds.
   */
  firstFrameUt?: number;
  /** The UT, in seconds, of the latest captured frame. */
  lastFrameUt?: number;
}

/**
 * How a recovered flight ended, from KSP's recovery summary: the vessel's name,
 * the headline figures and the crew. The full summary is on the
 * `recovery.lastSummary` Topic.
 *
 * @category Flight recording
 */
export interface FlightRecoveryOutcome {
  /** Marks this outcome as a recovery. */
  kind: "recovered";
  /** Wall-clock ms when the outcome was captured. */
  recordedAt: number;
  /** Where the vessel was recovered, as KSP names it. */
  recoveryLocation: string;
  /** The recovery factor KSP reported, as the text it showed. */
  recoveryFactor: string;
  /** Null in a save with no funds or no science: absent, not zero. */
  /** Funds the recovery earned. */
  fundsEarned: number | null;
  /** Science the recovery earned. */
  scienceEarned: number | null;
  /** Reputation the recovery earned. */
  reputationEarned: number;
  /** Names of crew that were aboard at recovery. */
  crew: string[];
}

/**
 * How a crashed flight ended: the cause KSP reported, and any kerbals killed.
 *
 * @category Flight recording
 */
export interface FlightCrashOutcome {
  /** Marks this outcome as a crash. */
  kind: "crashed";
  /** Wall-clock ms when the outcome was captured. */
  recordedAt: number;
  /** The name of the body the vessel crashed on or at. */
  body: string;
  /** The vessel's situation when it crashed, as KSP names it. */
  situation: string;
  /** KSP's description of what destroyed the vessel. */
  what: string;
  /** How many parts were lost. */
  partsLostCount: number;
  /** Names of the kerbals killed. */
  kerbalsKilled: string[];
}

/**
 * How a flight ended: recovered or crashed.
 *
 * @category Flight recording
 */
export type FlightOutcome = FlightRecoveryOutcome | FlightCrashOutcome;

/**
 * One named stretch of a flight, saved on its {@link FlightRecord}. An exported
 * flight carries its chapters as {@link FlightChapter}s.
 *
 * @category Flight recording
 */
export interface FlightChapterRecord {
  /** Identifier of the chapter. */
  id: string;
  /** The chapter's name. */
  label: string;
  /** Elapsed ms since `launchedAt`. */
  startMs: number;
  /** Elapsed ms since `launchedAt`. */
  endMs: number;
}

/**
 * A short summary of one recorded mission, stored apart from the recording
 * itself so a list of missions can be shown without loading every recording.
 *
 * @category Flight recording
 */
export interface MissionMeta {
  /** This mission's identifier. */
  id: string;
  /** The vessel's name. */
  vesselName: string;
  /** Wall-clock ms when recording started. */
  launchedAt: number;
  /** UT (seconds) of the first captured frame. */
  firstFrameUt: number;
  /** UT (seconds) of the last captured frame. */
  lastFrameUt: number;
  /** How many frames the recording holds. */
  frameCount: number;
  /**
   * Whether the operator starred the mission. Starred missions are never pruned
   * automatically, but can still be deleted by hand. Absent means not starred.
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
