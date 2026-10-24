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
    rows.push(row);
    if (folds) open.set(flight.vesselName, row);
  }
  return rows;
}
