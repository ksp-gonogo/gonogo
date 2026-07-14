/**
 * A station-dispatched command's `label`/`topic` must survive the PeerJS
 * hop to the host and land on the host's own `TelemetryClient.dispatch()`
 * call — before this, `PeerClientService.sendSitrepCommand` and the
 * `sitrep-command-request` wire message only carried `command`/`args`, so
 * a station-originated kOS command showed a bare command name (and the
 * wrong scope) in the host's `system.uplink.pending` queue. Exercises the
 * real `PeerHostService`/`PeerClientService` pair over a fake PeerJS data
 * channel (mirrors `kos-execute-tunnel.test.ts`'s `FakeHub`), with the
 * host's `getActiveTelemetryClient()` backed by a real `TelemetryClient` +
 * `StubTransport` so `label`/`topic` are observed on the actual
 * `command-request` envelope the host's client sends onward — not just a
 * mock's call args.
 */

import {
  StubTransport,
  setActiveTelemetryClientForTests,
  TelemetryClient,
} from "@ksp-gonogo/sitrep-client";
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

import { PeerClientService } from "../peer/PeerClientService";
import { PeerHostService } from "../peer/PeerHostService";

describe("sitrep-command-request label/topic tunnel (station → host)", () => {
  afterEach(() => {
    FakeHub.reset();
    localStorageMock.clear();
    setActiveTelemetryClientForTests(undefined);
    vi.unstubAllGlobals();
    vi.stubGlobal("localStorage", localStorageMock);
  });

  it("carries a station-dispatched command's label and topic to the host's TelemetryClient.dispatch()", async () => {
    const transport = new StubTransport();
    const hostClient = new TelemetryClient(transport);
    transport.setCommandHandler(() => ({ ok: true }));
    setActiveTelemetryClientForTests(hostClient);

    const host = new PeerHostService();
    await host.start();
    await Promise.resolve();

    const client = new PeerClientService();
    client.connect(host.peerId ?? "");
    for (let i = 0; i < 6; i++) await Promise.resolve();

    client.sendSitrepCommand(
      "c0",
      "kos.run",
      { script: "boot.ks" },
      "Run boot script",
      "kos/cpu-1",
    );

    for (let i = 0; i < 6; i++) await Promise.resolve();

    expect(transport.sentCommands).toEqual([
      expect.objectContaining({
        command: "kos.run",
        args: { script: "boot.ks" },
        label: "Run boot script",
        topic: "kos/cpu-1",
      }),
    ]);
  });

  it("defaults to empty label/topic when a pre-update station omits them", async () => {
    const transport = new StubTransport();
    const hostClient = new TelemetryClient(transport);
    transport.setCommandHandler(() => ({ ok: true }));
    setActiveTelemetryClientForTests(hostClient);

    const host = new PeerHostService();
    await host.start();
    await Promise.resolve();

    const client = new PeerClientService();
    client.connect(host.peerId ?? "");
    for (let i = 0; i < 6; i++) await Promise.resolve();

    // Simulate an older station's wire message: no label/topic fields at all.
    client.sendSitrepCommand(
      "c1",
      "kos.run",
      { script: "boot.ks" },
      undefined as unknown as string,
      undefined as unknown as string,
    );

    for (let i = 0; i < 6; i++) await Promise.resolve();

    expect(transport.sentCommands).toEqual([
      expect.objectContaining({
        command: "kos.run",
        label: "",
        topic: "",
      }),
    ]);
  });
});
