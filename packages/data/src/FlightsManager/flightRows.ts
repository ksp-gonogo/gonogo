import type { ContractFinish } from "../storage/MissionStore";
import type { FlightRecord } from "../types";

/** What one line of the flight history stands for: a recording, or every open recording of a craft that is still flying. */
export interface FlightRow {
  /** The recording the row's actions act on: the newest of the craft's recordings. */
  flight: FlightRecord;
  /** Every recording the row stands for, `flight`'s first. */
  ids: string[];
  stillFlying: boolean;
  launchedAt: number;
  /** The sum of each recording's own span, wall-clock ms. */
  durationMs: number;
  sampleCount: number;
  /** The earliest game time, in seconds, any recording of the row holds a sample valid at. Absent when none of them kept one. */
  firstValidUt?: number;
  /** The latest game time, in seconds, any recording of the row holds a sample valid at. */
  lastValidUt?: number;
}

/**
 * The contracts that finished during a row's flight: those whose finish time falls within the span the row's recordings hold samples for. A finish with no flight spanning it belongs to no row, and a row whose recordings kept no valid-time span has none.
 *
 * A reverted flight and its retry cover the same game time, so `rows`, when given, settles which of them a finish belongs to: of the rows whose span holds it, the one launched last before the finish was heard. A finish that does not say when it was heard is listed under each.
 */
export function contractsOnRow(
  row: Pick<FlightRow, "firstValidUt" | "lastValidUt" | "launchedAt">,
  finishes: readonly ContractFinish[],
  rows: readonly Pick<
    FlightRow,
    "firstValidUt" | "lastValidUt" | "launchedAt"
  >[] = [],
): ContractFinish[] {
  return finishes.filter((f) => {
    if (!spans(row, f.validAt)) return false;
    if (f.recordedAt === undefined) return true;
    return (heardOn(rows, f.validAt, f.recordedAt) ?? row) === row;
  });
}

function spans(
  row: Pick<FlightRow, "firstValidUt" | "lastValidUt">,
  ut: number,
): boolean {
  const { firstValidUt, lastValidUt } = row;
  if (firstValidUt === undefined || lastValidUt === undefined) return false;
  return ut >= firstValidUt && ut <= lastValidUt;
}

/** Of the rows spanning `validAt`, the one launched last at or before `recordedAt`, or undefined when none was. */
function heardOn<
  Row extends Pick<FlightRow, "firstValidUt" | "lastValidUt" | "launchedAt">,
>(rows: readonly Row[], validAt: number, recordedAt: number): Row | undefined {
  let best: Row | undefined;
  for (const candidate of rows) {
    if (!spans(candidate, validAt) || candidate.launchedAt > recordedAt)
      continue;
    if (best === undefined || candidate.launchedAt > best.launchedAt) {
      best = candidate;
    }
  }
  return best;
}

function widen(
  row: Pick<FlightRow, "firstValidUt" | "lastValidUt">,
  flight: Pick<FlightRecord, "firstValidUt" | "lastValidUt">,
): void {
  if (flight.firstValidUt !== undefined) {
    row.firstValidUt = Math.min(
      row.firstValidUt ?? flight.firstValidUt,
      flight.firstValidUt,
    );
  }
  if (flight.lastValidUt !== undefined) {
    row.lastValidUt = Math.max(
      row.lastValidUt ?? flight.lastValidUt,
      flight.lastValidUt,
    );
  }
}

/**
 * The flight history's lines, given its recordings newest first and the names of the craft still flying.
 *
 * A craft left in orbit sends no end, so every visit to it leaves a recording that looks like an unknown ending. A recording with no end and no outcome, of a craft that is still flying, folds into one row with the other such recordings of that craft; every other recording keeps its own row.
 */
export function flightRows(
  flights: readonly FlightRecord[],
  stillFlyingNames: ReadonlySet<string>,
): FlightRow[] {
  const rows: FlightRow[] = [];
  const open = new Map<string, FlightRow>();
  for (const flight of flights) {
    const span = flight.lastSampleAt - flight.launchedAt;
    const folds =
      flight.endReason === undefined &&
      flight.outcome === undefined &&
      stillFlyingNames.has(flight.vesselName);
    const into = folds ? open.get(flight.vesselName) : undefined;
    if (into) {
      into.ids.push(flight.id);
      into.launchedAt = Math.min(into.launchedAt, flight.launchedAt);
      into.durationMs += span;
      into.sampleCount += flight.sampleCount;
      widen(into, flight);
      continue;
    }
    const row: FlightRow = {
      flight,
      ids: [flight.id],
      stillFlying: folds,
      launchedAt: flight.launchedAt,
      durationMs: span,
      sampleCount: flight.sampleCount,
    };
    widen(row, flight);
    rows.push(row);
    if (folds) open.set(flight.vesselName, row);
  }
  return rows;
}
