/**
 * IndexedDB-backed persistence for fog-of-war masks.
 *
 * Masks are raw alpha bytes (0 = fogged, 255 = fully imaged), one per pixel
 * in an equirectangular projection of the body's surface. Stored verbatim
 * as a Uint8Array — IndexedDB structured-clone handles typed arrays natively,
 * so there's no encode/decode cost on read or write.
 *
 * Keys are `${profileId}:${bodyId}:${layerId}` so each (profile, body,
 * scan-type) triple has its own mask. All masks for a profile share the
 * `${profileId}:` prefix for bulk deletion on profile removal; all masks
 * for a (profile, body) share `${profileId}:${bodyId}:` for body-level
 * resets.
 *
 * Per-type masks let the display compose precedence rules at paint time
 * (AltimetryHiRes overrides AltimetryLoRes; Biome and Resource layers stay
 * independent) without losing per-channel granularity. PeerJS sync also
 * routes per-type so stations can render the same layers the host sees.
 */

const DB_NAME = "gonogo-fog";
/**
 * DB version bumped from 1 → 2 to drop the old single-mask-per-body
 * schema. onupgradeneeded recreates the object store, which wipes any
 * pre-existing keys. SCANsat regenerates the underlying coverage cheaply
 * (it's persisted in the save's SCANcontroller), so the wipe is recoverable
 * by flying over already-scanned regions again.
 */
const DB_VERSION = 3;
const STORE = "masks";

/** Incremented if the per-record on-disk shape changes. Independent from
 *  DB_VERSION — the IDB version controls store-level migrations; the
 *  record version controls per-row migrations. */
export const MASK_SCHEMA_VERSION = 3;

export interface StoredMask {
  key: string;
  version: number;
  layerId: string;
  width: number;
  height: number;
  data: Uint8Array;
  updatedAt: number;
}

function makeKey(profileId: string, bodyId: string, layerId: string): string {
  return `${profileId}:${bodyId}:${layerId}`;
}

/**
 * Fires whenever the store's contents change for a specific
 * `(profileId, bodyId, layerId)` triple. The listener is *not* given the
 * new bytes — it should `load(...)` if it needs them. Used by
 * `FogMaskCache` to detect external writes (e.g. a fog snapshot from the
 * host arriving via PeerJS, written straight to the store, bypassing the
 * cache's own mutate-then-flush path).
 *
 * `origin` lets the cache skip its own writes — if the cache itself
 * called `save(..., origin: this.tag)`, the listener fires with that
 * tag and the cache short-circuits. Without this, the cache would
 * race-reload its own data over a fresh in-memory mutation.
 */
export type FogMaskChangeListener = (
  profileId: string,
  bodyId: string,
  layerId: string,
  origin: string | undefined,
) => void;

export class FogMaskStore {
  private dbPromise: Promise<IDBDatabase> | null = null;
  private readonly dbName: string;
  private readonly changeListeners = new Set<FogMaskChangeListener>();

  constructor(opts: { dbName?: string } = {}) {
    this.dbName = opts.dbName ?? DB_NAME;
  }

  onChange(listener: FogMaskChangeListener): () => void {
    this.changeListeners.add(listener);
    return () => this.changeListeners.delete(listener);
  }

  private fireChange(
    profileId: string,
    bodyId: string,
    layerId: string,
    origin: string | undefined,
  ): void {
    for (const l of this.changeListeners) l(profileId, bodyId, layerId, origin);
  }

  async load(
    profileId: string,
    bodyId: string,
    layerId: string,
  ): Promise<StoredMask | null> {
    const db = await this.open();
    return new Promise<StoredMask | null>((resolve, reject) => {
      const req = db
        .transaction(STORE)
        .objectStore(STORE)
        .get(makeKey(profileId, bodyId, layerId));
      req.onsuccess = () => {
        const value = req.result as StoredMask | undefined;
        if (!value) {
          resolve(null);
          return;
        }
        if (value.version !== MASK_SCHEMA_VERSION) {
          // Future-proofing: treat mismatched schema as absent rather than
          // corrupting in-memory state. A migration path would slot in here.
          resolve(null);
          return;
        }
        resolve(value);
      };
      req.onerror = () => reject(req.error);
    });
  }

  async save(
    profileId: string,
    bodyId: string,
    layerId: string,
    data: Uint8Array,
    width: number,
    height: number,
    origin?: string,
  ): Promise<void> {
    const db = await this.open();
    const record: StoredMask = {
      key: makeKey(profileId, bodyId, layerId),
      version: MASK_SCHEMA_VERSION,
      layerId,
      width,
      height,
      data,
      updatedAt: Date.now(),
    };
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put(record);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
    this.fireChange(profileId, bodyId, layerId, origin);
  }

  /**
   * Load every mask for a profile in one transaction. Used by the host
   * peer service to send a fog snapshot to a newly-connected station so
   * the station's map mirrors the host's exploration state. The list is
   * unordered; callers shouldn't depend on insertion order. Each row
   * carries its `layerId` so receivers route to the right per-type slot.
   */
  async loadAllForProfile(profileId: string): Promise<StoredMask[]> {
    const db = await this.open();
    return new Promise<StoredMask[]>((resolve, reject) => {
      const lower = `${profileId}:`;
      const upper = `${profileId}:￿`;
      const out: StoredMask[] = [];
      const tx = db.transaction(STORE);
      const cursorReq = tx
        .objectStore(STORE)
        .openCursor(IDBKeyRange.bound(lower, upper));
      cursorReq.onsuccess = () => {
        const cursor = cursorReq.result;
        if (!cursor) return;
        const value = cursor.value as StoredMask;
        if (value.version === MASK_SCHEMA_VERSION) out.push(value);
        cursor.continue();
      };
      cursorReq.onerror = () => reject(cursorReq.error);
      tx.oncomplete = () => resolve(out);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  }

  async clear(
    profileId: string,
    bodyId: string,
    layerId: string,
    origin?: string,
  ): Promise<void> {
    const db = await this.open();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).delete(makeKey(profileId, bodyId, layerId));
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
    this.fireChange(profileId, bodyId, layerId, origin);
  }

  /**
   * Clear every per-type mask for a (profile, body). Used when the user
   * resets a body's exploration state via the save-profile UI.
   */
  async clearBody(
    profileId: string,
    bodyId: string,
    origin?: string,
  ): Promise<void> {
    const db = await this.open();
    const cleared: string[] = [];
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      const store = tx.objectStore(STORE);
      const lower = `${profileId}:${bodyId}:`;
      const upper = `${profileId}:${bodyId}:￿`;
      const cursorReq = store.openCursor(IDBKeyRange.bound(lower, upper));
      cursorReq.onsuccess = () => {
        const cursor = cursorReq.result;
        if (!cursor) return;
        const value = cursor.value as StoredMask;
        cleared.push(value.layerId);
        cursor.delete();
        cursor.continue();
      };
      cursorReq.onerror = () => reject(cursorReq.error);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
    for (const layerId of cleared) {
      this.fireChange(profileId, bodyId, layerId, origin);
    }
  }

  async clearProfile(profileId: string): Promise<void> {
    const db = await this.open();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      const store = tx.objectStore(STORE);
      // Delete all keys matching `${profileId}:...` by walking the prefix
      // range. `:` is a safe separator because body ids never contain it.
      const lower = `${profileId}:`;
      const upper = `${profileId}:￿`;
      const cursorReq = store.openCursor(IDBKeyRange.bound(lower, upper));
      cursorReq.onsuccess = () => {
        const cursor = cursorReq.result;
        if (cursor) {
          cursor.delete();
          cursor.continue();
        }
      };
      cursorReq.onerror = () => reject(cursorReq.error);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  }

  private open(): Promise<IDBDatabase> {
    if (this.dbPromise) return this.dbPromise;
    this.dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open(this.dbName, DB_VERSION);
      req.onupgradeneeded = (event) => {
        const db = req.result;
        const oldVersion = event.oldVersion;
        // v1 → v2: schema added layerId to the key shape. Old single-mask-
        // per-body rows can't be migrated to per-type rows without inventing
        // the type, so drop the store and let SCANsat repopulate from its
        // own persisted coverage.
        if (
          oldVersion > 0 &&
          oldVersion < 2 &&
          db.objectStoreNames.contains(STORE)
        ) {
          db.deleteObjectStore(STORE);
        }
        // v2 → v3: scanType (a closed SCANsat bit-value enum) generalised to
        // layerId (an opaque string) — old rows carry a numeric field where a
        // string is now expected, so they're dropped the same way v1→v2 was,
        // and any registered reveal source repopulates on its own schedule.
        if (
          oldVersion > 0 &&
          oldVersion < 3 &&
          db.objectStoreNames.contains(STORE)
        ) {
          db.deleteObjectStore(STORE);
        }
        if (!db.objectStoreNames.contains(STORE)) {
          db.createObjectStore(STORE, { keyPath: "key" });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return this.dbPromise;
  }
}
