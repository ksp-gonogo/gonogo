import { deriveTrueAnomalyDeg } from "@ksp-gonogo/sitrep-client";
import type { CatalogEntry, Value } from "@ksp-gonogo/sitrep-sdk";
import { conicElements, ringPlace } from "./vesselOrbitsContribution";

/** The flown craft as its command centre's record draws it: the conic the record gives, and where on it the craft is at the instant on screen. */
export interface RecordedCraft {
  parentName: string;
  sma: number;
  ecc: number;
  /** Longitude of the ascending node, degrees. */
  lan: number;
  /** Argument of periapsis, degrees. */
  argPe: number;
  /** Inclination, degrees. */
  inclination: number;
  /** True anomaly at the instant on screen, degrees. */
  trueAnomaly: number;
}

/**
 * The flown craft as its command centre's record places it, when the record
 * knows more than the craft's own report: the record's place was fixed after
 * the instant the report's elements are for, which is the case once the centre
 * has seen the craft since it last heard from it. Null when the record is no
 * newer, and when its orbit, its body or that body's gravitational parameter is
 * unread: an unread element is never filled in.
 *
 * Not a reckoner: the record states a mean anomaly at an epoch and the widget
 * carries it to the instant on screen to place a mark; no Topic holds the
 * result, and `registerReckoner` takes a `TopicId`.
 */
export function recordedFlownCraft({
  entry,
  reportEpoch,
  nameOf,
  muOf,
  ut,
}: {
  entry: CatalogEntry | undefined;
  /** The instant the craft's own report's elements are for; undefined when no report has arrived. */
  reportEpoch: Value<"ut"> | undefined;
  nameOf: (bodyIndex: number) => string | undefined;
  muOf: (bodyName: string) => number | null | undefined;
  ut: number | undefined;
}): RecordedCraft | null {
  const placedAt = entry?.placeAsOfUt;
  if (entry == null || placedAt == null || ut === undefined) return null;
  if (!placedAt.isFinite()) return null;
  if (reportEpoch !== undefined && !placedAt.greaterThan(reportEpoch)) {
    return null;
  }
  const parentName =
    entry.bodyIndex == null ? undefined : nameOf(entry.bodyIndex);
  if (parentName === undefined) return null;
  const elements = conicElements(entry);
  const place = ringPlace(entry);
  if (elements === null || place === null) return null;
  const trueAnomaly = deriveTrueAnomalyDeg({
    semiMajorAxis: elements.sma,
    eccentricity: elements.ecc,
    meanAnomalyAtEpoch: place.meanAnomalyAtEpoch,
    epoch: place.epoch,
    parentGravParameter: muOf(parentName),
    ut,
  });
  if (trueAnomaly === null) return null;
  return { parentName, ...elements, trueAnomaly };
}
