import { logger } from "@ksp-gonogo/logger";
import { sha256Integrity } from "@ksp-gonogo/sitrep-sdk/uplink-load";

/**
 * Bundle bytes that already passed their sha256 check, kept across page loads
 * and keyed by the `sha256-<hex>` integrity they were checked against. A new
 * release carries a new integrity, so an entry can never be served for a build
 * it is not. Every method resolves rather than throws: a store that fails
 * reads as a miss and a failed write is dropped.
 */
export interface VerifiedBundleStore {
  get(integrity: string): Promise<ArrayBuffer | undefined>;
  put(integrity: string, bytes: ArrayBuffer): Promise<void>;
  delete(integrity: string): Promise<void>;
}

/** How many bundles the store keeps before it drops the oldest. */
export const VERIFIED_BUNDLE_LIMIT = 20;

const CACHE_NAME = "gonogo-uplink-bundles-v1";

/* Cache Storage keys on a Request, so each integrity gets a synthetic url on a reserved domain nothing resolves. */
const keyFor = (integrity: string) =>
  `https://uplink-bundle.invalid/${encodeURIComponent(integrity)}`;

function warn(action: string, err: unknown): void {
  logger.warn(
    `[VerifiedBundleStore] ${action} failed: ${
      err instanceof Error ? err.message : String(err)
    }`,
  );
}

/** The part of a `Cache` the store reads and writes; a real `Cache` satisfies it. */
export interface BundleCache {
  match(key: string): Promise<Response | undefined>;
  put(key: string, response: Response): Promise<void>;
  keys(): Promise<readonly { url: string }[]>;
  delete(key: string): Promise<boolean>;
}

/** The part of `CacheStorage` the store opens; a real `CacheStorage` satisfies it. */
export interface BundleCacheStorage {
  open(name: string): Promise<BundleCache>;
}

/**
 * A {@link VerifiedBundleStore} over Cache Storage. Cache keys come back in
 * insertion order, so the oldest entries are the first ones `keys()` lists.
 */
export function createCacheStorageStore(
  storage: BundleCacheStorage,
  limit: number = VERIFIED_BUNDLE_LIMIT,
): VerifiedBundleStore {
  return {
    async get(integrity) {
      try {
        const cache = await storage.open(CACHE_NAME);
        const hit = await cache.match(keyFor(integrity));
        return hit ? await hit.arrayBuffer() : undefined;
      } catch (err) {
        warn("read", err);
        return undefined;
      }
    },
    async put(integrity, bytes) {
      try {
        const cache = await storage.open(CACHE_NAME);
        await cache.put(
          keyFor(integrity),
          new Response(bytes, {
            headers: { "content-type": "text/javascript" },
          }),
        );
        const keys = await cache.keys();
        for (const stale of keys.slice(0, Math.max(0, keys.length - limit))) {
          await cache.delete(stale.url);
        }
      } catch (err) {
        warn("write", err);
      }
    },
    async delete(integrity) {
      try {
        const cache = await storage.open(CACHE_NAME);
        await cache.delete(keyFor(integrity));
      } catch (err) {
        warn("delete", err);
      }
    },
  };
}

let defaultStore: VerifiedBundleStore | null | undefined;

/**
 * This page's store, or `null` where Cache Storage is missing (a non-secure
 * origin, a test environment) or refuses to be touched (blocked site data).
 */
export function defaultVerifiedBundleStore(): VerifiedBundleStore | null {
  if (defaultStore !== undefined) return defaultStore;
  try {
    const storage = globalThis.caches;
    defaultStore = storage ? createCacheStorageStore(storage) : null;
  } catch (err) {
    warn("open", err);
    defaultStore = null;
  }
  return defaultStore;
}

/**
 * The bytes for `integrity`, from `store` when it holds a copy that still
 * hashes to `integrity`, otherwise from `fetchBytes`. A stored copy that hashes
 * to anything else is deleted and fetched again. Freshly fetched bytes are
 * stored only when they hash to `integrity`; bytes that do not are returned
 * unstored, for the caller's own check to refuse.
 */
export async function fetchThroughStore(
  store: VerifiedBundleStore | null,
  integrity: string,
  fetchBytes: () => Promise<ArrayBuffer>,
): Promise<ArrayBuffer> {
  if (!store) return fetchBytes();
  const cached = await store.get(integrity).catch(() => undefined);
  if (cached) {
    const digest = await sha256Integrity(cached).catch(() => undefined);
    if (digest === integrity) return cached;
    logger.warn(
      `[VerifiedBundleStore] stored bundle for ${integrity} hashes to ${digest}: deleted and fetched again`,
    );
    await store.delete(integrity).catch(() => undefined);
  }
  const bytes = await fetchBytes();
  const digest = await sha256Integrity(bytes).catch(() => undefined);
  if (digest === integrity) {
    await store.put(integrity, bytes).catch(() => undefined);
  }
  return bytes;
}
