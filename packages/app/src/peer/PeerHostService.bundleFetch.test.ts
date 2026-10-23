/**
 * D6: the station conduit for Uplink bundle bytes. Covers the full
 * request/response round trip through a real `PeerHostService` +
 * `PeerClientService` pair connected via a fake PeerJS hub (mirrors
 * PeerHostService.uplinkRelay.test.ts's pattern): a station never fetches
 * an Uplink bundle directly: it asks the host, which downloads once,
 * SHA-256-verifies, and relays the verified bytes back over the data
 * channel. See protocol.ts's `uplink-bundle-request`/`-response` doc
 * comment and PeerHostService.handleUplinkBundleRequest.
 */

import { afterEach, describe, expect, it, vi } from "vitest";

const { FakeHub } = vi.hoisted(() => {
  class FakeDataConnection {
    static all: FakeDataConnection[] = [];
    private listeners = new Map<string, Array<(...args: unknown[]) => void>>();
    peer: string;
    peerConn: FakeDataConnection | null = null;
    open = true;

    constructor(peer: string) {
      this.peer = peer;
      FakeDataConnection.all.push(this);
    }

    on(event: string, cb: (...args: unknown[]) => void) {
      const bucket = this.listeners.get(event) ?? [];
      bucket.push(cb);
      this.listeners.set(event, bucket);
    }

    emit(event: string, ...args: unknown[]) {
      for (const cb of this.listeners.get(event) ?? []) cb(...args);
    }

    send(msg: unknown) {
      queueMicrotask(() => {
        this.peerConn?.emit("data", msg);
      });
    }

    close() {
      this.open = false;
    }
  }

  class FakePeer {
    static registry = new Map<string, FakePeer>();
    private listeners = new Map<string, Array<(...args: unknown[]) => void>>();
    id: string;

    constructor(id?: string) {
      this.id = id ?? `peer-${Math.random().toString(36).slice(2, 10)}`;
      FakePeer.registry.set(this.id, this);
      queueMicrotask(() => this.emit("open", this.id));
    }

    on(event: string, cb: (...args: unknown[]) => void) {
      const bucket = this.listeners.get(event) ?? [];
      bucket.push(cb);
      this.listeners.set(event, bucket);
    }

    emit(event: string, ...args: unknown[]) {
      for (const cb of this.listeners.get(event) ?? []) cb(...args);
    }

    connect(hostId: string) {
      const host = FakePeer.registry.get(hostId);
      if (!host) throw new Error(`host ${hostId} not registered`);
      const stationOutbound = new FakeDataConnection(hostId);
      const hostInbound = new FakeDataConnection(this.id);
      stationOutbound.peerConn = hostInbound;
      hostInbound.peerConn = stationOutbound;
      queueMicrotask(() => {
        host.emit("connection", hostInbound);
        hostInbound.emit("open");
        stationOutbound.emit("open");
      });
      return stationOutbound;
    }

    destroy() {}
  }

  return {
    FakeHub: {
      Peer: FakePeer,
      reset() {
        FakePeer.registry.clear();
        FakeDataConnection.all = [];
      },
    },
  };
});

vi.mock("peerjs", () => ({ default: FakeHub.Peer }));

const localStorageMock = {
  store: new Map<string, string>(),
  getItem(k: string) {
    return this.store.get(k) ?? null;
  },
  setItem(k: string, v: string) {
    this.store.set(k, v);
  },
  removeItem(k: string) {
    this.store.delete(k);
  },
  clear() {
    this.store.clear();
  },
};
vi.stubGlobal("localStorage", localStorageMock);

import { approveStation } from "../test/approveStation";
import { hostCompat } from "../uplinks/hostCompat";
import { loadEnabledUplinks } from "../uplinks/loader";
import {
  createPeerBundleFetcher,
  createPeerManifestFetcher,
} from "../uplinks/peerBundleFetch";
import { rebaseBundleUrl, sha256Hex } from "./BundleFetchCache";
import { PeerClientService } from "./PeerClientService";
import { PeerHostService } from "./PeerHostService";

const live: Array<{ disconnect?: () => void; stop?: () => void }> = [];

/** Remembers a service so the test's `afterEach` can stop it before the fake hub is emptied. */
function track<T extends { disconnect?: () => void; stop?: () => void }>(
  service: T,
): T {
  live.push(service);
  return service;
}

function stopAll() {
  for (const service of live.splice(0)) {
    service.disconnect?.();
    service.stop?.();
  }
}

async function connectedPair() {
  approveStation();
  const host = track(new PeerHostService());
  await host.start();
  await Promise.resolve();

  const client = track(new PeerClientService());
  client.connect(host.peerId ?? "");
  for (let i = 0; i < 6; i++) await Promise.resolve();

  return { host, client };
}

function textBytes(s: string): ArrayBuffer {
  return new TextEncoder().encode(s).buffer as ArrayBuffer;
}

describe("PeerHostService.handleUplinkBundleRequest (D6 conduit)", () => {
  afterEach(() => {
    stopAll();
    FakeHub.reset();
    localStorageMock.clear();
    vi.unstubAllGlobals();
    vi.stubGlobal("localStorage", localStorageMock);
  });

  it("fetches, verifies, and relays bundle bytes to the requesting station", async () => {
    const bundle = textBytes("console.log('hello uplink');");
    const goodHash = await sha256Hex(bundle);
    const fetchSpy = vi.fn(async (url: string) => {
      expect(url).toBe("https://example.test/bundle.js");
      return bundle;
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => ({
        ok: true,
        status: 200,
        arrayBuffer: () => fetchSpy(url),
      })),
    );

    const { client } = await connectedPair();
    const result = await client.sendBundleFetch(
      "https://example.test/bundle.js",
      goodHash,
    );

    expect(new Uint8Array(result)).toEqual(new Uint8Array(bundle));
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("tells the station the bundle's size before sending it", async () => {
    const bundle = textBytes("console.log('sized uplink');");
    const goodHash = await sha256Hex(bundle);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 200,
        arrayBuffer: async () => bundle,
      })),
    );

    const { client } = await connectedPair();
    const progress: Array<[number, number]> = [];
    await client.sendBundleFetch("https://example.test/sized.js", goodHash, {
      onProgress: (received, total) => progress.push([received, total]),
    });

    expect(progress).toEqual([[0, bundle.byteLength]]);
  });

  it("fetches a station's hosted-site bundle path under the host's own base", async () => {
    const bundle = textBytes("console.log('bundled client');");
    const goodHash = await sha256Hex(bundle);
    const requested: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        requested.push(String(url));
        return {
          ok: true,
          status: 200,
          arrayBuffer: async () =>
            String(url) === "/uplinks/bg.client.js"
              ? bundle
              : textBytes("<!doctype html>app shell"),
        };
      }),
    );

    const { client } = await connectedPair();
    const result = await client.sendBundleFetch(
      "/rc/uplinks/bg.client.js",
      goodHash,
      { appBase: "/rc/" },
    );

    expect(new Uint8Array(result)).toEqual(new Uint8Array(bundle));
    expect(requested).toContain("/uplinks/bg.client.js");
    expect(requested).not.toContain("/rc/uplinks/bg.client.js");
  });

  it("refuses to redistribute bytes on a hash mismatch, station's fetchBytes rejects", async () => {
    const bundle = textBytes("evil payload");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 200,
        arrayBuffer: async () => bundle,
      })),
    );

    const { client } = await connectedPair();
    await expect(
      client.sendBundleFetch(
        "https://example.test/bundle.js",
        "sha256-not-the-real-hash",
      ),
    ).rejects.toThrow(/hash .* != expected/);
  });

  it("surfaces a host-side fetch failure as a rejection, not a hang", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: false,
        status: 404,
        arrayBuffer: async () => {
          throw new Error("should not be read");
        },
      })),
    );

    const { client } = await connectedPair();
    await expect(
      client.sendBundleFetch("https://example.test/missing.js", "sha256-x"),
    ).rejects.toThrow(/bundle fetch failed/);
  });

  it("downloads a given bundleUrl exactly ONCE even when two stations request it concurrently (dedup)", async () => {
    const bundle = textBytes("shared bundle bytes");
    const goodHash = await sha256Hex(bundle);
    let callCount = 0;
    const BUNDLE_URL = "https://example.test/shared.js";
    // Scoped by url: the host's OWN boot sequence also calls global `fetch`
    // (`/ice-config`, the relay's analytics-consent post): only
    // count/delay the bundle url itself, or those unrelated calls would
    // inflate callCount and defeat the dedup assertion below.
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (String(url) !== BUNDLE_URL) {
          return {
            ok: true,
            status: 200,
            json: async () => ({}),
            arrayBuffer: async () => new ArrayBuffer(0),
          };
        }
        callCount++;
        // Simulate a slow author-host download so both requests are genuinely in-flight together, not just sequential-and-cached.
        await new Promise((r) => setTimeout(r, 10));
        return { ok: true, status: 200, arrayBuffer: async () => bundle };
      }),
    );

    approveStation();
    const host = track(new PeerHostService());
    await host.start();
    await Promise.resolve();

    const clientA = track(new PeerClientService());
    clientA.connect(host.peerId ?? "");
    const clientB = track(new PeerClientService());
    clientB.connect(host.peerId ?? "");
    for (let i = 0; i < 6; i++) await Promise.resolve();

    const [resultA, resultB] = await Promise.all([
      clientA.sendBundleFetch("https://example.test/shared.js", goodHash),
      clientB.sendBundleFetch("https://example.test/shared.js", goodHash),
    ]);

    expect(callCount).toBe(1);
    expect(new Uint8Array(resultA)).toEqual(new Uint8Array(bundle));
    expect(new Uint8Array(resultB)).toEqual(new Uint8Array(bundle));

    // A THIRD, later request for the same url reuses the cached verified bytes too: still exactly one underlying fetch.
    const resultC = await clientA.sendBundleFetch(
      "https://example.test/shared.js",
      goodHash,
    );
    expect(callCount).toBe(1);
    expect(new Uint8Array(resultC)).toEqual(new Uint8Array(bundle));
  });

  it("wire-shape round trip: bytes in == bytes out, including a large/binary-ish payload", async () => {
    const payload = new Uint8Array(4096);
    for (let i = 0; i < payload.length; i++) payload[i] = i % 256;
    const goodHash = await sha256Hex(payload.buffer as ArrayBuffer);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 200,
        arrayBuffer: async () => payload.buffer,
      })),
    );

    const { client } = await connectedPair();
    const result = await client.sendBundleFetch(
      "https://example.test/big.bin",
      goodHash,
    );
    expect(result).toBeInstanceOf(ArrayBuffer);
    expect(new Uint8Array(result)).toEqual(payload);
  });
});

describe("rebaseBundleUrl", () => {
  it("swaps the station's base for the host's on a path under it", () => {
    expect(rebaseBundleUrl("/rc/uplinks/a.js", "/rc/", "/")).toBe(
      "/uplinks/a.js",
    );
    expect(rebaseBundleUrl("/uplinks/a.js", "/", "/app/")).toBe(
      "/app/uplinks/a.js",
    );
  });

  it("leaves absolute urls and matching bases alone", () => {
    expect(rebaseBundleUrl("https://x.test/a.js", "/rc/", "/")).toBe(
      "https://x.test/a.js",
    );
    expect(rebaseBundleUrl("/uplinks/a.js", "/", "/")).toBe("/uplinks/a.js");
    expect(rebaseBundleUrl("/uplinks/a.js", undefined, "/app/")).toBe(
      "/uplinks/a.js",
    );
  });
});

describe("PeerHostService.handleUplinkManifestRequest (station conduit for a manifest)", () => {
  afterEach(() => {
    stopAll();
    FakeHub.reset();
    localStorageMock.clear();
    vi.unstubAllGlobals();
    vi.stubGlobal("localStorage", localStorageMock);
  });

  const LAN_BUNDLE = "http://builder.example.test:8099/third.client.js";
  const LAN_MANIFEST = "http://builder.example.test:8099/gonogo-uplink.json";

  it("fetches the manifest on the host's network and relays the parsed document", async () => {
    const manifest = { id: "third", version: "1.0.0", integrity: "sha256-x" };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => ({
        ok: true,
        status: 200,
        json: async () =>
          String(url) === LAN_MANIFEST ? manifest : ({} as unknown),
      })),
    );

    const { client } = await connectedPair();
    await expect(client.sendManifestFetch(LAN_MANIFEST)).resolves.toEqual(
      manifest,
    );
  });

  it("surfaces a host-side manifest failure as a rejection naming the reason", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: false, status: 404, json: async () => ({}) })),
    );

    const { client } = await connectedPair();
    await expect(client.sendManifestFetch(LAN_MANIFEST)).rejects.toThrow(
      /manifest fetch failed.*404/,
    );
  });

  it("ends a host fetch that never answers with a legible reason instead of waiting", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        (_url: string, init?: RequestInit) =>
          new Promise((_resolve, reject) => {
            init?.signal?.addEventListener("abort", () =>
              reject(init.signal?.reason),
            );
          }),
      ),
    );

    const { client } = await connectedPair();
    vi.useFakeTimers();
    try {
      const outcome = expect(
        client.sendManifestFetch(LAN_MANIFEST),
      ).rejects.toThrow(/manifest fetch failed.*(timed out|timeout)/i);
      await vi.advanceTimersByTimeAsync(60_000);
      await outcome;
    } finally {
      vi.useRealTimers();
    }
  });

  it("carries a station through the real loader to a loaded third-party client", async () => {
    const bundle = textBytes("export const marker = 'third';");
    const hash = await sha256Hex(bundle);
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (String(url) === LAN_BUNDLE) {
          return { ok: true, status: 200, arrayBuffer: async () => bundle };
        }
        if (String(url) === LAN_MANIFEST) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              id: "third",
              version: "1.0.0",
              minAppVersion: "0.0.0",
              apiVersion: hostCompat.apiVersion,
              contractMajor: hostCompat.contractMajor,
              contractMinor: hostCompat.contractMinor,
              integrity: hash,
            }),
          };
        }
        if (String(url).includes("registry.json")) {
          return { ok: true, status: 200, json: async () => ({ uplinks: [] }) };
        }
        return { ok: true, status: 200, json: async () => ({}) };
      }),
    );

    const { client } = await connectedPair();
    const importBundle = vi.fn(async () => ({}));
    const outcomes = await loadEnabledUplinks({
      registrySource: { url: "/uplinks/registry.json" },
      hostCompat,
      appVersion: "1.0.0",
      roster: [
        {
          id: "third",
          version: "1.0.0",
          available: true,
          reason: null,
          expectedClientHash: hash,
          clientSource: { url: "", devPath: LAN_BUNDLE },
        },
      ],
      override: ["third"],
      ensureConsent: async () => true,
      fetchBytes: createPeerBundleFetcher(client),
      fetchManifest: createPeerManifestFetcher(client),
      bundlesFromHost: true,
      importBundle,
    });

    expect(outcomes.map((o) => [o.id, o.status])).toEqual([
      ["third", "loaded"],
    ]);
    expect(importBundle).toHaveBeenCalledOnce();
  });
});
