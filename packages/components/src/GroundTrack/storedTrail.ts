import type { TimelineStore } from "@ksp-gonogo/sitrep-client";
import { type FlightQuantities, flightNumbers } from "./flightNumbers";
import type { TrajectoryPoint } from "./useTrajectoryBuffer";

type Flight = FlightQuantities;
type Identity = { vesselId?: unknown; parentBodyIndex?: unknown };

/** Seconds of game time of flight a screen asks its history source for, which bounds what a station fetches to draw the trail. */
export const TRAIL_BACKFILL_SECONDS = 600;

/** The UT the current craft's current stretch over its current body began, or -Infinity when the held identities never changed. */
function currentTrackStart(store: TimelineStore, viewUt: number): number {
  const identities = store.sampleRange<Identity>(
    "vessel.identity",
    Number.NEGATIVE_INFINITY,
    viewUt,
  );
  if (!identities || identities.length === 0) return Number.NEGATIVE_INFINITY;
  const key = (p: { payload: Identity | null }) =>
    `${p.payload?.vesselId}|${p.payload?.parentBodyIndex}`;
  const now = key(identities[identities.length - 1]);
  let start = Number.NEGATIVE_INFINITY;
  for (let i = identities.length - 1; i >= 0; i--) {
    if (key(identities[i]) !== now) {
      start = identities[i + 1].validAt;
      break;
    }
  }
  return start;
}

/**
 * The newest `limit` positions the stream holds of the active craft's current
 * stretch over its current body, oldest first. A stretch begins where the
 * craft or the body it is over last changed, so nothing before an SOI change
 * or a switch of craft is returned.
 */
export function storedTrail(
  store: TimelineStore,
  limit: number,
): TrajectoryPoint[] {
  const viewUt = store.currentFrame().viewUt;
  if (!Number.isFinite(viewUt)) return [];
  const from = currentTrackStart(store, viewUt);
  const flown = store.sampleRange<Flight>("vessel.flight", from, viewUt) ?? [];
  const points: TrajectoryPoint[] = [];
  let laterUt = Number.NaN;
  for (let i = flown.length - 1; i >= 0 && points.length < limit; i--) {
    const sample = flown[i];
    const p = sample.payload;
    // One position per instant: a sample restated at the same UT is the same fix.
    if (p === null || sample.validAt === laterUt) continue;
    const { lat, lon, alt, ...rest } = flightNumbers(p);
    if (lat === undefined || lon === undefined || alt === undefined) continue;
    laterUt = sample.validAt;
    points.push({ lat, lon, alt, ...rest });
  }
  points.reverse();
  return points;
}

/** The UT of the oldest flight sample held, which moves back when a history source answers. */
export function earliestFlightUt(store: TimelineStore): number {
  return (
    store.getTimeline("vessel.flight").earliest()?.validAt ??
    Number.POSITIVE_INFINITY
  );
}
