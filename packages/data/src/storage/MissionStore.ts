import type { ReplayFixture } from "@ksp-gonogo/sitrep-client";
import type { MissionMeta } from "@ksp-gonogo/sitrep-sdk";

/**
 * Reserved for the video-recording fast-follow (synchronized `MediaRecorder`
 * capture, bound to a mission's `ViewClock` on replay), not populated by
 * anything in this slice. The shape exists now so `MissionRecord.video`'s
 * type is stable once that follow-up lands.
 */
export interface VideoRecordingRef {
  /** Key into a future video blob store. */
  blobKey: string;
  /** UT the recording started at, for `ViewClock`-driven playout alignment. */
  startUt: number;
}

export type { MissionMeta } from "@ksp-gonogo/sitrep-sdk";

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

/** What separates a mission's id from a part's number in a fixture row's key. Mission ids are UUIDs, which hold no `#`. */
const PART_SEPARATOR = "#part-";

/**
 * The key of the fixture row holding one part of a mission. The first part
 * is keyed by the mission's own id, which is where a mission stored whole
 * keeps its only fixture.
 */
function partKey(id: string, part: number): string {
  return part === 0 ? id : `${id}${PART_SEPARATOR}${part}`;
}

/** Every key a mission's later parts can have, for deleting them without knowing how many there are. */
function laterPartKeys(id: string): IDBKeyRange {
  return IDBKeyRange.bound(
    `${id}${PART_SEPARATOR}`,
    `${id}${PART_SEPARATOR}\uffff`,
  );
}

/** A stored meta row when it carries the identity and launch instant the list
 *  view sorts and keys on, and `null` for anything else in the store. */
function asMissionMeta(row: unknown): MissionMeta | null {
  if (
    typeof row !== "object" ||
    row === null ||
    typeof Reflect.get(row, "id") !== "string" ||
    typeof Reflect.get(row, "launchedAt") !== "number"
  ) {
    return null;
  }
  return row as MissionMeta;
}

/** A stored fixture row when it carries a fixture, and `null` otherwise: a row
 *  without one has nothing to replay or export. */
function asFixtureRow(row: unknown): FixtureRow | null {
  if (typeof row !== "object" || row === null) return null;
  const fixture: unknown = Reflect.get(row, "fixture");
  if (typeof fixture !== "object" || fixture === null) return null;
  return row as FixtureRow;
}

/**
 * IndexedDB-backed persistence for `StreamRecorder`-produced mission
 * recordings. Deliberately a separate database from `IndexedDbStore`'s
 * `gonogo-data`, which `BufferedDataSource` keeps for its own unrelated
 * flight-detection and graph bookkeeping: this schema is unrelated to that
 * one, not a migration of it. A `BufferedDataSource` sample does not map onto
 * a raw wire fixture at all, so recordings in that older format are
 * deliberately not carried over.
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
   * Stores one part of a mission that is recorded in several, with the
   * mission's meta as it stands once this part is counted. `part` counts from
   * 0, in the order the parts were recorded.
   *
   * The meta is written with every part, so a mission whose first part could
   * not be stored still has a row once a later one is. What the operator set on
   * the mission while it was being recorded, its star and its chapters, is kept.
   */
  async saveMissionPart(
    meta: MissionMeta,
    part: number,
    fixture: ReplayFixture,
  ): Promise<void> {
    await this.runTx([META_STORE, FIXTURE_STORE], "readwrite", (tx) => {
      const metaStore = tx.objectStore(META_STORE);
      const existingReq = metaStore.get(meta.id);
      existingReq.onsuccess = () => {
        const existing = asMissionMeta(existingReq.result);
        metaStore.put({
          ...meta,
          partCount: Math.max(meta.partCount ?? 1, part + 1),
          ...(existing?.starred === undefined
            ? {}
            : { starred: existing.starred }),
          ...(existing?.chapters === undefined
            ? {}
            : { chapters: existing.chapters }),
        });
      };
      const fixtureRow: FixtureRow = { id: partKey(meta.id, part), fixture };
      tx.objectStore(FIXTURE_STORE).put(fixtureRow);
    });
  }

  /**
   * Patches `starred`/`chapters` on one mission's meta row, a
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
        const existing = asMissionMeta(getReq.result);
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
        const rows: unknown[] = req.result;
        const list = rows
          .map(asMissionMeta)
          .filter((row): row is MissionMeta => row !== null);
        list.sort((a, b) => b.launchedAt - a.launchedAt);
        resolve(list);
      };
      req.onerror = () => reject(req.error);
    });
  }

  /** Single-row meta lookup by id: cheaper than `listMissions()` + filter for callers (chapter edits, star toggles) that only need one mission. */
  async getMissionMeta(id: string): Promise<MissionMeta | null> {
    const db = await this.open();
    return new Promise<MissionMeta | null>((resolve, reject) => {
      const req = db.transaction(META_STORE).objectStore(META_STORE).get(id);
      req.onsuccess = () => resolve(asMissionMeta(req.result));
      req.onerror = () => reject(req.error);
    });
  }

  /**
   * Loads the (potentially large) fixture payload for one mission, only called
   * when actually replaying/exporting, never for the list view. A mission stored
   * in parts comes back as one fixture, its parts' frames joined in the order
   * they were recorded. A part that was never stored is left out.
   */
  async getMissionFixture(
    id: string,
  ): Promise<{ fixture: ReplayFixture; video?: VideoRecordingRef } | null> {
    const partCount = (await this.getMissionMeta(id))?.partCount ?? 1;
    const db = await this.open();
    const store = db.transaction(FIXTURE_STORE).objectStore(FIXTURE_STORE);
    const rows = await Promise.all(
      Array.from(
        { length: partCount },
        (_, part) =>
          new Promise<FixtureRow | null>((resolve, reject) => {
            const req = store.get(partKey(id, part));
            req.onsuccess = () => resolve(asFixtureRow(req.result));
            req.onerror = () => reject(req.error);
          }),
      ),
    );
    const stored = rows.filter((row): row is FixtureRow => row !== null);
    if (stored.length === 0) return null;
    const topics = new Set<string>();
    const frames: string[] = [];
    for (const row of stored) {
      for (const topic of row.fixture.subscribedTopics ?? []) topics.add(topic);
      for (const frame of row.fixture.frames) frames.push(frame);
    }
    return {
      fixture: { subscribedTopics: [...topics], frames },
      video: stored[0]?.video,
    };
  }

  async deleteMission(id: string): Promise<void> {
    await this.runTx([META_STORE, FIXTURE_STORE], "readwrite", (tx) => {
      tx.objectStore(META_STORE).delete(id);
      tx.objectStore(FIXTURE_STORE).delete(id);
      tx.objectStore(FIXTURE_STORE).delete(laterPartKeys(id));
    });
  }

  /**
   * Keep the `keepCount` most recently launched missions (by `launchedAt`),
   * deleting the rest. Starred missions are exempt: never evicted, and don't
   * count toward the cap. Mirrors `BufferedDataSource.pruneFlightsKeepLatest`,
   * same semantics, minus the "current flight" exemption (Missions has no
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

  private async runTx<Result = void>(
    stores: string | string[],
    mode: IDBTransactionMode,
    fn: (tx: IDBTransaction, reject: (reason?: unknown) => void) => void,
  ): Promise<Result> {
    const db = await this.open();
    return new Promise<Result>((resolve, reject) => {
      const tx = db.transaction(stores, mode);
      fn(tx, reject);
      tx.oncomplete = () => resolve(undefined as Result);
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
