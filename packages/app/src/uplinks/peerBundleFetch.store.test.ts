import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BundleFetchCache } from "../peer/BundleFetchCache";
import {
  createCacheStorageStore,
  type VerifiedBundleStore,
} from "../peer/verifiedBundleStore";
import type { HostCompat } from "./hostCompat";
import { loadEnabledUplinks } from "./loader";
import { __resetUplinkOutcomes } from "./loaderState";
import { createPeerBundleFetcher } from "./peerBundleFetch";
import type { RegistryIndex } from "./registry";

const HOST: HostCompat = {
  apiVersion: "1.2.0",
  contractMajor: 3,
  contractMinor: 5,
};

const BUNDLE_BYTES = new TextEncoder().encode("export const marker = 1;")
  .buffer as ArrayBuffer;
const TAMPERED_BYTES = new TextEncoder().encode("export const marker = 666;")
  .buffer as ArrayBuffer;

async function sha256Of(bytes: ArrayBuffer): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  const hex = Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return `sha256-${hex}`;
}

const text = (bytes: ArrayBuffer) => new TextDecoder().decode(bytes);

function indexWith(integrity: string): RegistryIndex {
  return {
    uplinks: [
      {
        id: "widget-a",
        name: "Widget A",
        author: "jonpepler",
        repo: "example/widget-a",
        versions: [
          {
            version: "1.0.0",
            minAppVersion: "1.0.0",
            apiVersion: "1.2.5",
            contractMajor: 3,
            contractMinor: 3,
            bundleUrl: "/uplinks/widget-a.client.js",
            integrity,
            expectedClientHash: null,
          },
        ],
      },
    ],
  };
}

function memoryStore(seed: Record<string, ArrayBuffer> = {}) {
  const entries = new Map(Object.entries(seed));
  const store = {
    entries,
    get: vi.fn(async (integrity: string) => entries.get(integrity)),
    put: vi.fn(async (integrity: string, bytes: ArrayBuffer) => {
      entries.set(integrity, bytes);
    }),
    delete: vi.fn(async (integrity: string) => {
      entries.delete(integrity);
    }),
  } satisfies VerifiedBundleStore & { entries: unknown };
  return store;
}

function throwingStore(): VerifiedBundleStore {
  const fail = vi.fn(async () => {
    throw new Error("SecurityError: storage blocked");
  });
  return { get: fail, put: fail, delete: fail };
}

let goodHash: string;

beforeEach(async () => {
  __resetUplinkOutcomes();
  goodHash = await sha256Of(BUNDLE_BYTES);
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      if (String(url).includes("registry.local.json")) {
        return Response.json(indexWith(goodHash));
      }
      throw new Error(`unexpected fetch: ${url}`);
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

async function loadOnStation(store: VerifiedBundleStore) {
  const sendBundleFetch = vi.fn(async () => BUNDLE_BYTES);
  const importBundle = vi.fn(async (_bytes: ArrayBuffer) => ({}));
  const [outcome] = await loadEnabledUplinks({
    registrySource: { url: "/uplinks/registry.local.json" },
    override: ["widget-a"],
    hostCompat: HOST,
    appVersion: "1.0.0",
    ensureConsent: async () => true,
    fetchBytes: createPeerBundleFetcher(
      { sendBundleFetch, sendManifestFetch: vi.fn() },
      store,
    ),
    importBundle,
  });
  return { outcome, sendBundleFetch, importBundle };
}

describe("a station keeps verified Uplink bundles across page loads", () => {
  it("imports a stored bundle without asking the main screen for it", async () => {
    const store = memoryStore({ [goodHash]: BUNDLE_BYTES });

    const { outcome, sendBundleFetch, importBundle } =
      await loadOnStation(store);

    expect(outcome.status).toBe("loaded");
    expect(sendBundleFetch).not.toHaveBeenCalled();
    expect(text(importBundle.mock.calls[0][0])).toBe(text(BUNDLE_BYTES));
  });

  it("deletes a stored bundle that no longer matches its hash and fetches it again", async () => {
    const store = memoryStore({ [goodHash]: TAMPERED_BYTES });

    const { outcome, sendBundleFetch, importBundle } =
      await loadOnStation(store);

    expect(outcome.status).toBe("loaded");
    expect(store.delete).toHaveBeenCalledWith(goodHash);
    expect(sendBundleFetch).toHaveBeenCalledWith(
      "/uplinks/widget-a.client.js",
      goodHash,
      expect.anything(),
    );
    expect(text(importBundle.mock.calls[0][0])).toBe(text(BUNDLE_BYTES));
    expect(text(store.entries.get(goodHash) as ArrayBuffer)).toBe(
      text(BUNDLE_BYTES),
    );
  });

  it("stores the bundle the main screen sent once it passes its hash", async () => {
    const store = memoryStore();

    const { outcome, sendBundleFetch } = await loadOnStation(store);

    expect(outcome.status).toBe("loaded");
    expect(sendBundleFetch).toHaveBeenCalledTimes(1);
    expect(store.put).toHaveBeenCalledWith(goodHash, BUNDLE_BYTES);
  });

  it("never stores bytes that miss the hash they were fetched under", async () => {
    const store = memoryStore();
    const fetchBytes = createPeerBundleFetcher(
      {
        sendBundleFetch: async () => TAMPERED_BYTES,
        sendManifestFetch: vi.fn(),
      },
      store,
    );

    await fetchBytes("/uplinks/widget-a.client.js", goodHash);

    expect(store.put).not.toHaveBeenCalled();
  });

  it("falls back to the main screen when the store throws on every call", async () => {
    const store = throwingStore();

    const { outcome, sendBundleFetch, importBundle } =
      await loadOnStation(store);

    expect(store.get).toHaveBeenCalledWith(goodHash);
    expect(outcome.status).toBe("loaded");
    expect(sendBundleFetch).toHaveBeenCalledTimes(1);
    expect(importBundle).toHaveBeenCalledTimes(1);
  });
});

describe("the main screen keeps verified Uplink bundles across page loads", () => {
  it("answers a station from the store without fetching from the author host", async () => {
    const store = memoryStore({ [goodHash]: BUNDLE_BYTES });
    const fetchBytes = vi.fn(async () => BUNDLE_BYTES);

    const { digest, bytes } = await new BundleFetchCache(store).fetchVerified(
      "https://author.test/widget-a.js",
      fetchBytes,
      goodHash,
    );

    expect(fetchBytes).not.toHaveBeenCalled();
    expect(digest).toBe(goodHash);
    expect(new TextDecoder().decode(bytes)).toBe(text(BUNDLE_BYTES));
  });

  it("refetches past a tampered stored copy and stores the verified bytes", async () => {
    const store = memoryStore({ [goodHash]: TAMPERED_BYTES });
    const fetchBytes = vi.fn(async () => BUNDLE_BYTES);

    const { digest } = await new BundleFetchCache(store).fetchVerified(
      "https://author.test/widget-a.js",
      fetchBytes,
      goodHash,
    );

    expect(fetchBytes).toHaveBeenCalledTimes(1);
    expect(digest).toBe(goodHash);
    expect(text(store.entries.get(goodHash) as ArrayBuffer)).toBe(
      text(BUNDLE_BYTES),
    );
  });

  it("fetches as before when the store throws", async () => {
    const store = throwingStore();
    const fetchBytes = vi.fn(async () => BUNDLE_BYTES);

    const { digest } = await new BundleFetchCache(store).fetchVerified(
      "https://author.test/widget-a.js",
      fetchBytes,
      goodHash,
    );

    expect(store.get).toHaveBeenCalledWith(goodHash);
    expect(fetchBytes).toHaveBeenCalledTimes(1);
    expect(digest).toBe(goodHash);
  });
});

describe("createCacheStorageStore", () => {
  function fakeCacheStorage() {
    const cache = new Map<string, Response>();
    const handle = {
      match: async (key: string) => cache.get(key)?.clone(),
      put: async (key: string, res: Response) => {
        cache.delete(key);
        cache.set(key, res);
      },
      keys: async () => [...cache.keys()].map((url) => ({ url })),
      delete: async (key: string) => cache.delete(key),
    };
    return {
      cache,
      storage: { open: async () => handle },
    };
  }

  it("round-trips bytes and drops the oldest entries beyond its limit", async () => {
    const { cache, storage } = fakeCacheStorage();
    const store = createCacheStorageStore(storage, 2);

    await store.put("sha256-a", BUNDLE_BYTES);
    await store.put("sha256-b", BUNDLE_BYTES);
    await store.put("sha256-c", TAMPERED_BYTES);

    expect(cache.size).toBe(2);
    expect(await store.get("sha256-a")).toBeUndefined();
    expect(text((await store.get("sha256-c")) as ArrayBuffer)).toBe(
      text(TAMPERED_BYTES),
    );
  });

  it("reads as a miss when Cache Storage refuses to open", async () => {
    const storage = {
      open: async () => {
        throw new Error("SecurityError");
      },
    };
    const store = createCacheStorageStore(storage);

    await expect(store.get("sha256-a")).resolves.toBeUndefined();
    await expect(store.put("sha256-a", BUNDLE_BYTES)).resolves.toBeUndefined();
  });
});
