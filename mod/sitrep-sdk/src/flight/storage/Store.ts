import type { FlightRecord, SeriesRange } from "../types";

/**
 * Sorts flights most recently launched first, as every {@link FlightStore}
 * lists them.
 *
 * @category Flight recording
 */
export const FLIGHTS_DESC = (a: FlightRecord, b: FlightRecord): number =>
  b.launchedAt - a.launchedAt;

/**
 * Where flights and their samples are saved. The app uses IndexedDB;
 * {@link MemoryStore} keeps them in memory. Every method returns a promise.
 *
 * @category Flight recording
 * @categoryDescription Flight recording
 * The record of past flights: how samples are buffered and kept, the stores
 * that hold them, how a flight is detected and what ended it, and the fixture
 * format a flight is exported to and replayed from.
 */
export interface FlightStore {
  upsertFlight(record: FlightRecord): Promise<void>;
  getFlight(id: string): Promise<FlightRecord | null>;
  listFlights(): Promise<FlightRecord[]>;
  deleteFlight(id: string): Promise<void>;
  clearAllFlights(): Promise<void>;

  /**
   * Append one sample. Implementations are free to batch writes internally;
   * the sample becomes queryable after any pending batch flushes.
   */
  appendSample(
    flightId: string,
    key: string,
    t: number,
    v: unknown,
  ): Promise<void>;

  /**
   * Inclusive at both ends. Returns samples ordered by `t`. Empty arrays
   * when nothing matches: never rejects on empty range.
   */
  queryRange(
    flightId: string,
    key: string,
    tStart: number,
    tEnd: number,
  ): Promise<SeriesRange>;

  /**
   * Flush any pending batched writes so subsequent reads observe them. An
   * implementation that batches needs it; `MemoryStore` is a no-op.
   */
  flush(): Promise<void>;
}
