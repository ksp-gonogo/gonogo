import type { DataRateReport, SetRate } from "./__generated__/contract";
import { magnitudeOr } from "./magnitude";

/**
 * A rate a widget can ask the mod to send a Topic at: `"base"`, the rate every
 * Topic runs at, or `"fast"`. The tier names how much the widget needs the
 * Topic; what each tier is in samples a second is set by the mod and reported
 * on `system.dataRates`.
 *
 * @category Reading telemetry
 */
export type DataRateTier = SetRate["tier"];

/**
 * The faster rates a widget can ask for on Topics it reads, each a list of the
 * Values or whole Topics it wants at that tier (`"vessel.flight.altitude"` or
 * `"vessel.flight"`). The mod sends a whole Topic at a time, so naming one Value
 * puts its Topic at that tier. Useful for a widget that plots or models a Value
 * closely and draws it in steps at one sample a second. Used by the Landing
 * Status and Graph widgets.
 *
 * @category Registering widgets and themes
 */
export interface WidgetDataRates {
  /** Values or Topics to send at the fast tier while the widget is open. */
  readonly fast?: readonly string[];
}

/**
 * The samples a game second a Topic arrives at, read off a `system.dataRates`
 * report: the Topic's own row when it is above the base tier, otherwise the base
 * tier's rate. One a second when `report` is absent or not a report, which is
 * the base rate the mod sends at until it says otherwise. Useful for sizing how many samples
 * of a Topic to keep so a plot spans the same game time at any rate.
 *
 * @category Reading telemetry
 */
export function samplesPerSecondOf(report: unknown, topic: string): number {
  if (!isDataRateReport(report)) return 1;
  return rateOf(
    report.topics.find((entry) => entry.topic === topic) ??
      report.tiers.find((entry) => entry.tier === "base"),
  );
}

/* Read as a report only when both lists are present, so any other payload reads as none. */
function isDataRateReport(value: unknown): value is DataRateReport {
  return (
    typeof value === "object" &&
    value !== null &&
    Array.isArray(Reflect.get(value, "tiers")) &&
    Array.isArray(Reflect.get(value, "topics"))
  );
}

/** The base tier's samples a game second on a `system.dataRates` report, one a second when no report has arrived. */
export function baseSamplesPerSecondOf(
  report: DataRateReport | undefined,
): number {
  return rateOf(report?.tiers.find((entry) => entry.tier === "base"));
}

/* A sample rate becomes the plain number that sizes how many samples a timeline keeps. */
function rateOf(
  row: Pick<DataRateReport["tiers"][number], "samplesPerSecond"> | undefined,
): number {
  return magnitudeOr(row?.samplesPerSecond, 1);
}

/*
 * Fields too large to keep on every sample of a Topic sent above the base
 * rate, and read only from the sample on screen. A vessel.landing sample is
 * about 61 KB with its terrain and 1.4 KB without, so at ten a second its
 * history would hold close to a gigabyte if every sample kept them.
 */
const SUPERSEDED_FIELDS: ReadonlyMap<string, readonly string[]> = new Map([
  [
    "vessel.landing",
    [
      "siteHeights",
      "horizonAngles",
      "groundTrackDistances",
      "groundTrackElevations",
    ],
  ],
]);

/**
 * True for a Topic whose history drops some fields once a sample is no longer
 * the one on screen, as {@link supersededPayload} drops them. Useful for
 * skipping that work on every other Topic. Used by every screen's timelines and
 * by the main screen's relay to stations.
 *
 * @category Reading telemetry
 */
export function hasSupersededFields(topic: string): boolean {
  return SUPERSEDED_FIELDS.has(topic);
}

/**
 * A sample's payload once a newer sample of its Topic is on screen: the same
 * payload without the fields only the sample on screen is read for, such as
 * Landing Status's terrain on `vessel.landing`. The payload itself, unchanged,
 * for any other Topic or when none of those fields are present. Useful for
 * keeping a long history of a fast Topic without holding its largest fields on
 * every sample. Used by every screen's timelines and by the main screen's
 * relay to stations.
 *
 * @category Reading telemetry
 */
export function supersededPayload<Payload>(
  topic: string,
  payload: Payload,
): Payload {
  const fields = SUPERSEDED_FIELDS.get(topic);
  if (!fields || payload === null || typeof payload !== "object") {
    return payload;
  }
  const record = payload as Record<string, unknown>;
  if (!fields.some((field) => field in record)) return payload;
  const kept: Record<string, unknown> = {};
  for (const key of Object.keys(record)) {
    if (!fields.includes(key)) kept[key] = record[key];
  }
  return kept as Payload;
}
