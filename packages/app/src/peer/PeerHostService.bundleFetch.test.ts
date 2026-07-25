/**
 * D6 — the station conduit for Uplink bundle bytes. Covers the full
 * request/response round trip through a real `PeerHostService` +
 * `PeerClientService` pair connected via a fake PeerJS hub (mirrors
 * PeerHostService.uplinkRelay.test.ts's pattern): a station never fetches
 * an Uplink bundle directly — it asks the host, which downloads once,
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

import { sha256Hex } from "./BundleFetchCache";
import { PeerClientService } from "./PeerClientService";
import { PeerHostService } from "./PeerHostService";

async function connectedPair() {
  const host = new PeerHostService();
  await host.start();
  await Promise.resolve();

  const client = new PeerClientService();
  client.connect(host.peerId ?? "");
  for (let i = 0; i < 6; i++) await Promise.resolve();

  return { host, client };
}

function textBytes(s: string): ArrayBuffer {
  return new TextEncoder().encode(s).buffer as ArrayBuffer;
}

describe("PeerHostService.handleUplinkBundleRequest (D6 conduit)", () => {
  afterEach(() => {
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

  it("refuses to redistribute bytes on a hash mismatch — station's fetchBytes rejects", async () => {
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
    // (`/ice-config`, the relay's best-effort `/host` registration) — only
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
        // Simulate a slow author-host download so both requests are
        // genuinely in-flight together, not just sequential-and-cached.
        await new Promise((r) => setTimeout(r, 10));
        return { ok: true, status: 200, arrayBuffer: async () => bundle };
      }),
    );

    const host = new PeerHostService();
    await host.start();
    await Promise.resolve();

    const clientA = new PeerClientService();
    clientA.connect(host.peerId ?? "");
    const clientB = new PeerClientService();
    clientB.connect(host.peerId ?? "");
    for (let i = 0; i < 6; i++) await Promise.resolve();

    const [resultA, resultB] = await Promise.all([
      clientA.sendBundleFetch("https://example.test/shared.js", goodHash),
      clientB.sendBundleFetch("https://example.test/shared.js", goodHash),
    ]);

    expect(callCount).toBe(1);
    expect(new Uint8Array(resultA)).toEqual(new Uint8Array(bundle));
    expect(new Uint8Array(resultB)).toEqual(new Uint8Array(bundle));

    // A THIRD, later request for the same url reuses the cached verified
    // bytes too — still exactly one underlying fetch.
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
