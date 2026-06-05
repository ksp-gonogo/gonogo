import { debugFlight } from "../logger";
import type { FlightRecord, SeriesRange } from "../types";
import { FLIGHTS_DESC, type Store } from "./Store";

const DB_NAME = "gonogo-data";
const DB_VERSION = 1;
const FLIGHTS_STORE = "flights";
const SAMPLES_STORE = "samples";

const DEFAULT_FLUSH_INTERVAL_MS = 250;

interface PendingSample {
  flightId: string;
  key: string;
  t: number;
  v: unknown;
}

/**
 * IndexedDB-backed `Store`. Persists across reloads so graph history
 * survives browser restarts.
 *
 * Writes are batched and flushed every `flushIntervalMs` (default 250ms)
 * to reduce per-sample transaction overhead — a live Telemachus stream
 * produces ~4 samples/sec per subscribed key, and committing each one
 * individually is measurably wasteful in Chromium. Reads always trigger
 * a synchronous flush so range queries observe the latest data.
 */
export class IndexedDbStore implements Store {
  private dbPromise: Promise<IDBDatabase> | null = null;
  private readonly dbName: string;
  private readonly flushIntervalMs: number;
  private pending: PendingSample[] = [];
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private flushInFlight: Promise<void> | null = null;

  constructor(opts: { dbName?: string; flushIntervalMs?: number } = {}) {
    this.dbName = opts.dbName ?? DB_NAME;
    this.flushIntervalMs = opts.flushIntervalMs ?? DEFAULT_FLUSH_INTERVAL_MS;
  }

  // --- Flights -----------------------------------------------------------

  async upsertFlight(record: FlightRecord): Promise<void> {
    await this.runTx(FLIGHTS_STORE, "readwrite", (tx) => {
      tx.objectStore(FLIGHTS_STORE).put(record);
    });
  }

  async getFlight(id: string): Promise<FlightRecord | null> {
    const db = await this.open();
    return new Promise<FlightRecord | null>((resolve, reject) => {
      const req = db
        .transaction(FLIGHTS_STORE)
        .objectStore(FLIGHTS_STORE)
        .get(id);
      req.onsuccess = () =>
        resolve((req.result as FlightRecord | undefined) ?? null);
      req.onerror = () => reject(req.error);
    });
  }

  async listFlights(): Promise<FlightRecord[]> {
    const db = await this.open();
    return new Promise<FlightRecord[]>((resolve, reject) => {
      const req = db
        .transaction(FLIGHTS_STORE)
        .objectStore(FLIGHTS_STORE)
        .getAll();
      req.onsuccess = () => {
        const list = req.result as FlightRecord[];
        list.sort(FLIGHTS_DESC);
        resolve(list);
      };
      req.onerror = () => reject(req.error);
    });
  }

  async deleteFlight(id: string): Promise<void> {
    await this.flush();
    await this.runTx(
      [FLIGHTS_STORE, SAMPLES_STORE],
      "readwrite",
      (tx, reject) => {
        tx.objectStore(FLIGHTS_STORE).delete(id);

        // Delete all samples with this flightId by walking the key range
        // [id, "", -Infinity] … [id, "\uffff", Infinity] on the compound key.
        const samples = tx.objectStore(SAMPLES_STORE);
        const range = IDBKeyRange.bound(
          [id, "", Number.NEGATIVE_INFINITY],
          [id, "\uffff", Number.POSITIVE_INFINITY],
        );
        const cursorReq = samples.openCursor(range);
        cursorReq.onsuccess = () => {
          const cursor = cursorReq.result;
          if (cursor) {
            cursor.delete();
            cursor.continue();
          }
        };
        cursorReq.onerror = () => reject(cursorReq.error);
      },
    );
  }

  async clearAllFlights(): Promise<void> {
    await this.flush();
    await this.runTx([FLIGHTS_STORE, SAMPLES_STORE], "readwrite", (tx) => {
      tx.objectStore(FLIGHTS_STORE).clear();
      tx.objectStore(SAMPLES_STORE).clear();
    });
  }

  // --- Samples -----------------------------------------------------------

  async appendSample(
    flightId: string,
    key: string,
    t: number,
    v: unknown,
  ): Promise<void> {
    this.pending.push({ flightId, key, t, v });
    this.scheduleFlush();
  }

  async queryRange(
    flightId: string,
    key: string,
    tStart: number,
    tEnd: number,
  ): Promise<SeriesRange> {
    // Flush any pending writes so the caller observes them.
    await this.flush();

    const db = await this.open();
    return new Promise<SeriesRange>((resolve, reject) => {
      const tx = db.transaction(SAMPLES_STORE);
      const store = tx.objectStore(SAMPLES_STORE);
      const range = IDBKeyRange.bound(
        [flightId, key, tStart],
        [flightId, key, tEnd],
      );
      const t: number[] = [];
      const v: unknown[] = [];
      const cursorReq = store.openCursor(range);
      cursorReq.onsuccess = () => {
        const cursor = cursorReq.result;
        if (cursor) {
          const row = cursor.value as PendingSample;
          t.push(row.t);
          v.push(row.v);
          cursor.continue();
        } else {
          resolve({ t, v });
        }
      };
      cursorReq.onerror = () => reject(cursorReq.error);
    });
  }

  async flush(): Promise<void> {
    if (this.flushTimer !== null) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    if (this.flushInFlight) return this.flushInFlight;
    if (this.pending.length === 0) return;

    const batch = this.pending;
    this.pending = [];

    this.flushInFlight = this.writeBatch(batch).finally(() => {
      this.flushInFlight = null;
    });
    return this.flushInFlight;
  }

  // --- Internal ----------------------------------------------------------

  private scheduleFlush(): void {
    if (this.flushTimer !== null) return;
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      void this.flush().catch((err) => {
        debugFlight("flush-error", { err: String(err) });
      });
    }, this.flushIntervalMs);
  }

  private async writeBatch(batch: PendingSample[]): Promise<void> {
    await this.runTx(SAMPLES_STORE, "readwrite", (tx) => {
      const store = tx.objectStore(SAMPLES_STORE);
      for (const row of batch) store.put(row);
    });
  }

  /**
   * Open the db, start a transaction over `stores`, run `fn`, and resolve on
   * `oncomplete` / reject on `onerror`/`onabort`. `fn` receives the live
   * transaction plus the promise's `reject` so it can surface request-level
   * errors (e.g. a cursor's `onerror`).
   */
  private async runTx<T = void>(
    stores: string | string[],
    mode: IDBTransactionMode,
    fn: (tx: IDBTransaction, reject: (reason?: unknown) => void) => void,
  ): Promise<T> {
    const db = await this.open();
    return new Promise<T>((resolve, reject) => {
      const tx = db.transaction(stores, mode);
      fn(tx, reject);
      tx.oncomplete = () => resolve(undefined as T);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  }

  private open(): Promise<IDBDatabase> {
    if (this.dbPromise) return this.dbPromise;
    this.dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open(this.dbName, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(FLIGHTS_STORE)) {
          const flights = db.createObjectStore(FLIGHTS_STORE, {
            keyPath: "id",
          });
          flights.createIndex("vesselName", "vesselName");
          flights.createIndex("launchedAt", "launchedAt");
        }
        if (!db.objectStoreNames.contains(SAMPLES_STORE)) {
          db.createObjectStore(SAMPLES_STORE, {
            keyPath: ["flightId", "key", "t"],
          });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return this.dbPromise;
  }
}
