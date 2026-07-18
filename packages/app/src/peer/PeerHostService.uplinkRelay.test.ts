/**
 * Generic coverage for PeerHostService's `handleUplinkRelay` — the single
 * handler every Uplink's peer-relayed calls route through (see
 * `uplink-relay-request`/`-response` in protocol.ts). Deliberately uses a
 * fixture uplinkId ("test-uplink") rather than a real Uplink's — this
 * mechanism is mod-agnostic and should be provable without naming one.
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

import {
  clearRegistry,
  type DataSource,
  registerDataSource,
  registerUplinkHandle,
  unregisterUplinkHandle,
} from "@ksp-gonogo/core";
import { PeerBroadcastingDataSource } from "./PeerBroadcastingDataSource";
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

describe("PeerHostService.handleUplinkRelay (generic)", () => {
  afterEach(() => {
    FakeHub.reset();
    localStorageMock.clear();
    clearRegistry();
    unregisterUplinkHandle("test-uplink");
    vi.unstubAllGlobals();
    vi.stubGlobal("localStorage", localStorageMock);
  });

  it("dispatches to a fixture handle registered via registerUplinkHandle and resolves with its result", async () => {
    const relay = vi.fn(async (method: string, args: unknown) => {
      expect(method).toBe("ping");
      expect(args).toEqual({ n: 1 });
      return { pong: true };
    });
    registerUplinkHandle("test-uplink", { relay });

    const { client } = await connectedPair();
    const result = await client.sendUplinkRelay("test-uplink", "ping", {
      n: 1,
    });
    expect(result).toEqual({ pong: true });
    expect(relay).toHaveBeenCalledWith("ping", { n: 1 });
  });

  it("responds with an error when no handle is registered for uplinkId", async () => {
    const { client } = await connectedPair();
    await expect(
      client.sendUplinkRelay("test-uplink", "ping", {}),
    ).rejects.toThrow(/no relay handle registered on the host/);
  });

  it("round-trips a thrown error's extra properties into errorMeta", async () => {
    registerUplinkHandle("test-uplink", {
      relay: async () => {
        throw Object.assign(new Error("boom"), { classification: "fatal" });
      },
    });

    const { client } = await connectedPair();
    const err = await client
      .sendUplinkRelay("test-uplink", "ping", {})
      .catch((e: Error) => e);
    expect((err as Error).message).toBe("boom");
    expect((err as unknown as { meta?: Record<string, unknown> }).meta).toEqual(
      { classification: "fatal" },
    );
  });

  it("is unaffected by DataSource-registry wrapping (PeerBroadcastingDataSource)", async () => {
    // Regression guard: the uplink-handle registry is a separate map,
    // keyed and populated independently of registerDataSource/getDataSource
    // — wrapping a DataSource with PeerBroadcastingDataSource (what
    // PeerHostProvider's wrap loop does on the main screen) must not affect
    // a relay handle registered under the same id.
    const handle = { relay: async () => "unwrapped" };
    registerUplinkHandle("test-uplink", handle);

    const { host } = await connectedPair();
    const realSource = {
      id: "test-uplink",
      name: "Test Uplink",
      status: "connected",
      connect: async () => {},
      disconnect: () => {},
      schema: () => [],
      subscribe: () => () => {},
      onStatusChange: () => () => {},
      execute: async () => {},
      configSchema: () => [],
      configure: () => {},
      getConfig: () => ({}),
    } as unknown as DataSource;
    registerDataSource(new PeerBroadcastingDataSource(realSource, host));

    const { getUplinkHandle } = await import("@ksp-gonogo/core");
    expect(getUplinkHandle("test-uplink")).toBe(handle);
  });
});
