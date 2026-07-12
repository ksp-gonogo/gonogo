import type { ReplayFixture } from "@ksp-gonogo/sitrep-client";
import type { FlightChapterRecord } from "../types";

/**
 * Reserved for the video-recording fast-follow (synchronized `MediaRecorder`
 * capture, bound to a mission's `ViewClock` on replay) — not populated by
 * anything in this slice. The shape exists now so `MissionRecord.video`'s
 * type is stable once that follow-up lands.
 */
export interface VideoRecordingRef {
  /** Key into a future video blob store. */
  blobKey: string;
  /** UT the recording started at, for `ViewClock`-driven playout alignment. */
  startUt: number;
}

/**
 * Small, cheap-to-list metadata for one recorded mission. Kept in its own
 * object store, separate from the (potentially large) `fixture` payload, so
 * populating the FlightsManager list never has to pull every recording's raw
 * wire frames into memory.
 */
export interface MissionMeta {
  id: string;
  vesselName: string;
  /** Wall-clock ms when recording started. */
  launchedAt: number;
  /** UT (seconds) of the first captured frame. */
  firstFrameUt: number;
  /** UT (seconds) of the last captured frame. */
  lastFrameUt: number;
  frameCount: number;
  /**
   * User-pinned: starred missions are exempt from `pruneMissionsKeepLatest`.
   * Per-row delete and "Clear all" still remove them. Optional/backward
   * compatible — existing rows read as `undefined` (falsy, same as
   * unstarred).
   */
  starred?: boolean;
  /**
   * User-authored chapters / markers, ported from the old
   * `FlightRecord.chapters`. Reuses `FlightChapterRecord` as-is — its
   * `startMs`/`endMs` fields keep their literal millisecond semantics,
   * elapsed since `firstFrameUt` (converted from the mission's UT-second
   * delta: `(ut - firstFrameUt) * 1000`) rather than since the old
   * wall-clock-ms `launchedAt`. Keeping the unit as ms means
   * `ChaptersEditor`'s `formatElapsed`/`parseElapsed` (which do real ms
   * math, dividing/multiplying by 1000) need no changes — only the anchor
   * point moves. Optional — missions start with none.
   */
  chapters?: FlightChapterRecord[];
}

/** One recorded mission: metadata + the raw-frame fixture `ReplayTransport` replays, plus an optional video ref (fast-follow, unpopulated today). */
export interface MissionRecord {
  meta: MissionMeta;
  fixture: ReplayFixture;
  video?: VideoRecordingRef;
}

const DB_NAME = "gonogo-missions";
const DB_VERSION = 1;
const META_STORE = "missionMeta";
const FIXTURE_STORE = "missionFixtures";

interface FixtureRow {
  id: string;
  fixture: ReplayFixture;
  video?: VideoRecordingRef;
}

/**
 * IndexedDB-backed persistence for `StreamRecorder`-produced mission
 * recordings — the replacement for the old `FlightRecord`/sample-based
 * flight history this record/replay path used to piggyback on. Deliberately
 * a SEPARATE database from `IndexedDbStore`'s `gonogo-data` (still used by
 * `BufferedDataSource` for its own, unrelated flight-detection/graph
 * bookkeeping) — this is a fresh, unrelated schema, not a migration of the
 * old one. Old recordings are intentionally not carried over (user-approved:
 * the old `BufferedDataSource` sample format doesn't map onto a raw wire
 * fixture at all).
 */
export class MissionStore {
  private dbPromise: Promise<IDBDatabase> | null = null;
  private readonly dbName: string;

  constructor(opts: { dbName?: string } = {}) {
    this.dbName = opts.dbName ?? DB_NAME;
  }

  async saveMission(record: MissionRecord): Promise<void> {
    await this.runTx([META_STORE, FIXTURE_STORE], "readwrite", (tx) => {
      tx.objectStore(META_STORE).put(record.meta);
      const fixtureRow: FixtureRow = {
        id: record.meta.id,
        fixture: record.fixture,
        video: record.video,
      };
      tx.objectStore(FIXTURE_STORE).put(fixtureRow);
    });
  }

  /**
   * Patches `starred`/`chapters` on one mission's meta row — a
   * `META_STORE`-only transaction, never touching the (potentially large)
   * `FIXTURE_STORE` blob. Read-modify-write since IndexedDB has no partial
   * `put`; no-ops (resolves without writing) when the mission doesn't exist.
   */
  async updateMissionMeta(
    id: string,
    patch: Partial<Pick<MissionMeta, "starred" | "chapters">>,
  ): Promise<void> {
    const db = await this.open();
    return new Promise<void>((resolve, reject) => {
      const tx = db.transaction(META_STORE, "readwrite");
      const store = tx.objectStore(META_STORE);
      const getReq = store.get(id);
      getReq.onsuccess = () => {
        const existing = getReq.result as MissionMeta | undefined;
        if (!existing) return;
        store.put({ ...existing, ...patch });
      };
      getReq.onerror = () => reject(getReq.error);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  }

  async listMissions(): Promise<MissionMeta[]> {
    const db = await this.open();
    return new Promise<MissionMeta[]>((resolve, reject) => {
      const req = db.transaction(META_STORE).objectStore(META_STORE).getAll();
      req.onsuccess = () => {
        const list = req.result as MissionMeta[];
        list.sort((a, b) => b.launchedAt - a.launchedAt);
        resolve(list);
      };
      req.onerror = () => reject(req.error);
    });
  }

  /** Single-row meta lookup by id — cheaper than `listMissions()` + filter for callers (chapter edits, star toggles) that only need one mission. */
  async getMissionMeta(id: string): Promise<MissionMeta | null> {
    const db = await this.open();
    return new Promise<MissionMeta | null>((resolve, reject) => {
      const req = db.transaction(META_STORE).objectStore(META_STORE).get(id);
      req.onsuccess = () =>
        resolve((req.result as MissionMeta | undefined) ?? null);
      req.onerror = () => reject(req.error);
    });
  }

  /** Loads the (potentially large) fixture payload for one mission — only called when actually replaying/exporting, never for the list view. */
  async getMissionFixture(
    id: string,
  ): Promise<{ fixture: ReplayFixture; video?: VideoRecordingRef } | null> {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const req = db
        .transaction(FIXTURE_STORE)
        .objectStore(FIXTURE_STORE)
        .get(id);
      req.onsuccess = () => {
        const row = req.result as FixtureRow | undefined;
        resolve(row ? { fixture: row.fixture, video: row.video } : null);
      };
      req.onerror = () => reject(req.error);
    });
  }

  async deleteMission(id: string): Promise<void> {
    await this.runTx([META_STORE, FIXTURE_STORE], "readwrite", (tx) => {
      tx.objectStore(META_STORE).delete(id);
      tx.objectStore(FIXTURE_STORE).delete(id);
    });
  }

  /**
   * Keep the `keepCount` most recently launched missions (by `launchedAt`),
   * deleting the rest. Starred missions are exempt: never evicted, and don't
   * count toward the cap. Mirrors `BufferedDataSource.pruneFlightsKeepLatest`
   * — same semantics, minus the "current flight" exemption (Missions has no
   * live/in-progress row; a mission only exists once `StreamRecorder` has
   * finished and `saveMission` has been called). Returns the ids actually
   * removed.
   */
  async pruneMissionsKeepLatest(opts: {
    keepCount: number;
  }): Promise<string[]> {
    if (opts.keepCount <= 0) return [];
    const all = await this.listMissions();
    const sorted = [...all].sort((a, b) => b.launchedAt - a.launchedAt);
    const victims: MissionMeta[] = [];
    let kept = 0;
    for (const m of sorted) {
      if (m.starred) continue;
      kept += 1;
      if (kept > opts.keepCount) victims.push(m);
    }
    for (const m of victims) {
      await this.deleteMission(m.id);
    }
    return victims.map((m) => m.id);
  }

  async clearAllMissions(): Promise<void> {
    await this.runTx([META_STORE, FIXTURE_STORE], "readwrite", (tx) => {
      tx.objectStore(META_STORE).clear();
      tx.objectStore(FIXTURE_STORE).clear();
    });
  }

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
        if (!db.objectStoreNames.contains(META_STORE)) {
          db.createObjectStore(META_STORE, { keyPath: "id" });
        }
        if (!db.objectStoreNames.contains(FIXTURE_STORE)) {
          db.createObjectStore(FIXTURE_STORE, { keyPath: "id" });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return this.dbPromise;
  }
}
