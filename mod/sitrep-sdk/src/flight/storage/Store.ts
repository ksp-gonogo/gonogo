import type { FlightRecord, SeriesRange } from "../types";

/**
 * Sort comparator for flight listings: most-recently-launched first.
 * Shared by every `FlightStore` implementation so all of them order
 * identically.
 */
export const FLIGHTS_DESC = (a: FlightRecord, b: FlightRecord): number =>
  b.launchedAt - a.launchedAt;

/**
 * Persistence contract for flight metadata + samples. `MemoryStore` implements
 * it for tests and non-browser environments; in the browser it is backed by
 * IndexedDB. Both back the same BufferedDataSource.
 *
 * All methods are async to match IndexedDB's native shape. `MemoryStore`
 * resolves synchronously.
 */
export interface FlightStore {
  // --- Flights -----------------------------------------------------------

  upsertFlight(record: FlightRecord): Promise<void>;
  getFlight(id: string): Promise<FlightRecord | null>;
  listFlights(): Promise<FlightRecord[]>;
  deleteFlight(id: string): Promise<void>;
  clearAllFlights(): Promise<void>;

  // --- Samples -----------------------------------------------------------

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
