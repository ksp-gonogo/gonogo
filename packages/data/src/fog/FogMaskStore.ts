/**
 * IndexedDB-backed persistence for fog-of-war masks.
 *
 * Masks are raw alpha bytes (0 = fogged, 255 = fully imaged), one per pixel
 * in an equirectangular projection of the body's surface. Stored verbatim
 * as a Uint8Array — IndexedDB structured-clone handles typed arrays natively,
 * so there's no encode/decode cost on read or write.
 *
 * Keys are `${profileId}:${bodyId}` so all masks for a profile share a prefix
 * for bulk deletion on profile removal.
 */

const DB_NAME = "gonogo-fog";
const DB_VERSION = 1;
const STORE = "masks";

/** Incremented if the on-disk shape changes. Lets us migrate/skip old masks. */
export const MASK_SCHEMA_VERSION = 1;

export interface StoredMask {
  key: string;
  version: number;
  width: number;
  height: number;
  data: Uint8Array;
  updatedAt: number;
}

function makeKey(profileId: string, bodyId: string): string {
  return `${profileId}:${bodyId}`;
}

export class FogMaskStore {
  private dbPromise: Promise<IDBDatabase> | null = null;
  private readonly dbName: string;

  constructor(opts: { dbName?: string } = {}) {
    this.dbName = opts.dbName ?? DB_NAME;
  }

  async load(profileId: string, bodyId: string): Promise<StoredMask | null> {
    const db = await this.open();
    return new Promise<StoredMask | null>((resolve, reject) => {
      const req = db
        .transaction(STORE)
        .objectStore(STORE)
        .get(makeKey(profileId, bodyId));
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
    data: Uint8Array,
    width: number,
    height: number,
  ): Promise<void> {
    const db = await this.open();
    const record: StoredMask = {
      key: makeKey(profileId, bodyId),
      version: MASK_SCHEMA_VERSION,
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
  }

  /**
   * Load every mask for a profile in one transaction. Used by the host
   * peer service to send a fog snapshot to a newly-connected station so
   * the station's map mirrors the host's exploration state. The list is
   * unordered; callers shouldn't depend on insertion order.
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

  async clear(profileId: string, bodyId: string): Promise<void> {
    const db = await this.open();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).delete(makeKey(profileId, bodyId));
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
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
      req.onupgradeneeded = () => {
        const db = req.result;
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
