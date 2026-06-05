import type { FlightRecord, SeriesRange } from "../types";
import { FLIGHTS_DESC, type Store } from "./Store";

interface SampleRow {
  t: number;
  v: unknown;
}

/**
 * In-memory implementation of `Store`. Used in tests (where IndexedDB is
 * available via fake-indexeddb but often clearer without) and as a
 * non-persistent fallback if IndexedDB is unavailable.
 *
 * Samples are kept in per-(flight, key) arrays sorted by timestamp.
 * Insertion is O(1) when timestamps arrive monotonically — which is the
 * expected case from a live stream — with a fallback linear-insert path
 * for out-of-order samples (e.g. backfilled history).
 */
export class MemoryStore implements Store {
  // Separator between flightId and key in a bucket map key. `\u0000`
  // prevents collisions between keys that happen to contain the flightId
  // as a prefix.
  private static readonly BUCKET_SEP = "\u0000";

  private flights = new Map<string, FlightRecord>();
  private samples = new Map<string, SampleRow[]>();

  // --- Flights -----------------------------------------------------------

  async upsertFlight(record: FlightRecord): Promise<void> {
    this.flights.set(record.id, { ...record });
  }

  async getFlight(id: string): Promise<FlightRecord | null> {
    const rec = this.flights.get(id);
    return rec ? { ...rec } : null;
  }

  async listFlights(): Promise<FlightRecord[]> {
    return Array.from(this.flights.values())
      .map((r) => ({ ...r }))
      .sort(FLIGHTS_DESC);
  }

  async deleteFlight(id: string): Promise<void> {
    this.flights.delete(id);
    for (const key of Array.from(this.samples.keys())) {
      if (key.startsWith(`${id}${MemoryStore.BUCKET_SEP}`))
        this.samples.delete(key);
    }
  }

  async clearAllFlights(): Promise<void> {
    this.flights.clear();
    this.samples.clear();
  }

  // --- Samples -----------------------------------------------------------

  async appendSample(
    flightId: string,
    key: string,
    t: number,
    v: unknown,
  ): Promise<void> {
    const bucket = this.bucketFor(flightId, key);
    // Fast path: timestamp is >= the last entry's timestamp.
    const last = bucket[bucket.length - 1];
    if (!last || t >= last.t) {
      bucket.push({ t, v });
      return;
    }
    // Slow path: out-of-order insert. Binary search for the right position.
    let lo = 0;
    let hi = bucket.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (bucket[mid].t <= t) lo = mid + 1;
      else hi = mid;
    }
    bucket.splice(lo, 0, { t, v });
  }

  async queryRange(
    flightId: string,
    key: string,
    tStart: number,
    tEnd: number,
  ): Promise<SeriesRange> {
    const bucket = this.samples.get(this.bucketKey(flightId, key));
    if (!bucket || bucket.length === 0) return { t: [], v: [] };

    const t: number[] = [];
    const v: unknown[] = [];
    for (const row of bucket) {
      if (row.t < tStart) continue;
      if (row.t > tEnd) break;
      t.push(row.t);
      v.push(row.v);
    }
    return { t, v };
  }

  async flush(): Promise<void> {
    // No-op — all writes are synchronous.
  }

  // --- Internal ----------------------------------------------------------

  private bucketKey(flightId: string, key: string): string {
    return `${flightId}${MemoryStore.BUCKET_SEP}${key}`;
  }

  private bucketFor(flightId: string, key: string): SampleRow[] {
    const k = this.bucketKey(flightId, key);
    let bucket = this.samples.get(k);
    if (!bucket) {
      bucket = [];
      this.samples.set(k, bucket);
    }
    return bucket;
  }
}
