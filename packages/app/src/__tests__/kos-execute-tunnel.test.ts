/**
 * End-to-end test: station-side useKosWidget dispatches → PeerJS data
 * channel → host's KosDataSource → back. Before the tunnel landed,
 * stations couldn't run kOS scripts because the registered entry was a
 * PeerClientDataSource mirror with no executeScript method.
 */

import { afterEach, describe, expect, it, vi } from "vitest";

// FakePeer / FakeDataConnection: one pair in a single module, wired up so
// that a conn created by the "station" Peer and one created by the "host"
// Peer can cross-send — simulates the peerjs data channel without PeerJS.
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
      // Deliver to the paired connection's "data" listeners.
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

    /** Station-side outbound connect. Pairs with a host conn, fires opens. */
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

// localStorage → fresh-peer-id path goes through these; stub for the test.
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
} from "@ksp-gonogo/core";
import { PeerBroadcastingDataSource } from "../peer/PeerBroadcastingDataSource";
import { PeerClientDataSource } from "../peer/PeerClientDataSource";
import { PeerClientService } from "../peer/PeerClientService";
import { PeerHostService } from "../peer/PeerHostService";

describe("kOS execute tunnel (station → host → kos)", () => {
  afterEach(() => {
    FakeHub.reset();
    localStorageMock.clear();
    clearRegistry();
    vi.unstubAllGlobals();
    vi.stubGlobal("localStorage", localStorageMock);
  });

  it("routes station executeScript() through PeerJS to the host's kos", async () => {
    // Fake host-side kos that captures calls + returns data.
    const executeScript = vi.fn(async (_cpu, _script, _args) => ({
      dv: 1234,
      ok: true,
    }));
    registerDataSource({
      id: "kos",
      name: "kOS",
      status: "connected",
      affectedBySignalLoss: false,
      connect: async () => {},
      disconnect: () => {},
      schema: () => [],
      subscribe: () => () => {},
      onStatusChange: () => () => {},
      execute: async () => {},
      configSchema: () => [],
      configure: () => {},
      getConfig: () => ({}),
      executeScript,
    } as unknown as DataSource);

    const host = new PeerHostService();
    await host.start();
    await Promise.resolve(); // let FakePeer "open" fire and register host id

    const client = new PeerClientService();
    client.connect(host.peerId ?? "");
    // Flush microtasks so the station's conn + host's conn both fire "open".
    for (let i = 0; i < 6; i++) await Promise.resolve();

    const source = new PeerClientDataSource("kos", "kOS", client);

    const result = await source.executeScript("datastream", "deltav", [2]);
    expect(result).toEqual({ dv: 1234, ok: true });
    expect(executeScript).toHaveBeenCalledWith(
      "datastream",
      "deltav",
      [2],
      undefined,
    );
  });

  it("propagates host-side errors back to the station", async () => {
    registerDataSource({
      id: "kos",
      name: "kOS",
      status: "connected",
      affectedBySignalLoss: false,
      connect: async () => {},
      disconnect: () => {},
      schema: () => [],
      subscribe: () => () => {},
      onStatusChange: () => () => {},
      execute: async () => {},
      configSchema: () => [],
      configure: () => {},
      getConfig: () => ({}),
      executeScript: async () => {
        throw new Error("kOS boom: script not found");
      },
    } as unknown as DataSource);

    const host = new PeerHostService();
    await host.start();
    await Promise.resolve();

    const client = new PeerClientService();
    client.connect(host.peerId ?? "");
    for (let i = 0; i < 6; i++) await Promise.resolve();

    const source = new PeerClientDataSource("kos", "kOS", client);
    await expect(source.executeScript("datastream", "bad", [])).rejects.toThrow(
      /kOS boom: script not found/,
    );
  });

  it("routes through a PeerBroadcastingDataSource wrapper (prod path)", async () => {
    // Regression: on the main screen every source — including kos —
    // is replaced in the registry by a PeerBroadcastingDataSource wrapper.
    // The wrapper must forward executeScript or the host rejects every
    // station's kos-execute-request with "not registered on main screen".
    const executeScript = vi.fn(async (_cpu, _script, _args) => ({ dv: 42 }));
    const realSource = {
      id: "kos",
      name: "kOS",
      status: "connected",
      affectedBySignalLoss: false,
      connect: async () => {},
      disconnect: () => {},
      schema: () => [],
      subscribe: () => () => {},
      onStatusChange: () => () => {},
      execute: async () => {},
      configSchema: () => [],
      configure: () => {},
      getConfig: () => ({}),
      executeScript,
    } as unknown as DataSource;

    const host = new PeerHostService();
    await host.start();
    await Promise.resolve();

    // Wrap exactly the way PeerHostProvider does on the main screen.
    registerDataSource(new PeerBroadcastingDataSource(realSource, host));

    const client = new PeerClientService();
    client.connect(host.peerId ?? "");
    for (let i = 0; i < 6; i++) await Promise.resolve();

    const source = new PeerClientDataSource("kos", "kOS", client);

    const result = await source.executeScript("datastream", "deltav", [2]);
    expect(result).toEqual({ dv: 42 });
    expect(executeScript).toHaveBeenCalledWith(
      "datastream",
      "deltav",
      [2],
      undefined,
    );
  });

  it("errors if the host has no kos registered", async () => {
    // No registerDataSource call — host has nothing.
    const host = new PeerHostService();
    await host.start();
    await Promise.resolve();

    const client = new PeerClientService();
    client.connect(host.peerId ?? "");
    for (let i = 0; i < 6; i++) await Promise.resolve();

    const source = new PeerClientDataSource("kos", "kOS", client);
    await expect(source.executeScript("c", "s", [])).rejects.toThrow(
      /not registered on main screen/,
    );
  });
});
