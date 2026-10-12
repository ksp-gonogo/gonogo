/**
 * Which connections the host lets go of, and what it still accepts from one it
 * has let go.
 */

import { afterEach, describe, expect, it, vi } from "vitest";

const { FakeHub } = vi.hoisted(() => {
  /** Enough RTCPeerConnection for `attachIceDiagnostics` to watch. */
  class FakePeerConnection {
    iceConnectionState: RTCIceConnectionState = "connected";
    iceGatheringState: RTCIceGatheringState = "complete";
    connectionState: RTCPeerConnectionState = "connected";
    signalingState: RTCSignalingState = "stable";
    private listeners = new Map<string, Array<() => void>>();

    addEventListener(event: string, cb: () => void) {
      const bucket = this.listeners.get(event) ?? [];
      bucket.push(cb);
      this.listeners.set(event, bucket);
    }

    /** The silent death: ICE goes terminal and PeerJS says nothing. */
    fail() {
      this.iceConnectionState = "failed";
      for (const cb of this.listeners.get("iceconnectionstatechange") ?? [])
        cb();
    }
  }

  class FakeDataConnection {
    private listeners = new Map<string, Array<(...args: unknown[]) => void>>();
    peer: string;
    open = true;
    peerConnection: FakePeerConnection | undefined;

    constructor(peer: string, withPeerConnection: boolean) {
      this.peer = peer;
      this.peerConnection = withPeerConnection
        ? new FakePeerConnection()
        : undefined;
    }

    on(event: string, cb: (...args: unknown[]) => void) {
      const bucket = this.listeners.get(event) ?? [];
      bucket.push(cb);
      this.listeners.set(event, bucket);
    }

    emit(event: string, ...args: unknown[]) {
      for (const cb of this.listeners.get(event) ?? []) cb(...args);
    }

    send(_msg?: unknown) {}

    close() {
      this.open = false;
      this.emit("close");
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

    destroy() {}
  }

  return {
    FakeHub: {
      Peer: FakePeer,
      DataConnection: FakeDataConnection,
      reset() {
        FakePeer.registry.clear();
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

import { PeerHostService } from "./PeerHostService";

type FakeConn = InstanceType<typeof FakeHub.DataConnection>;

/** Bring a station up on the host and hand back its host-side connection. */
async function connectStation(
  host: PeerHostService,
  peerId: string,
  { withPeerConnection = true } = {},
): Promise<FakeConn> {
  const peer = FakeHub.Peer.registry.get(host.peerId ?? "");
  if (!peer) throw new Error("host peer not registered");
  const conn = new FakeHub.DataConnection(peerId, withPeerConnection);
  peer.emit("connection", conn);
  conn.emit("open");
  await Promise.resolve();
  return conn;
}

async function startedHost(): Promise<PeerHostService> {
  const host = new PeerHostService();
  await host.start();
  await Promise.resolve();
  return host;
}

function stationInfo(conn: FakeConn, stationKey: string): void {
  conn.emit("data", { type: "station-info", name: "S", stationKey });
}

describe("two pages with one station identity", () => {
  afterEach(() => {
    FakeHub.reset();
    localStorageMock.clear();
  });

  it("hands the station to the newest page and tells the older one why before closing it", async () => {
    const host = await startedHost();
    const older = await connectStation(host, "station-k-1");
    const told: unknown[] = [];
    older.send = (msg: unknown) => {
      if (older.open) told.push(msg);
    };
    stationInfo(older, "k");
    const newer = await connectStation(host, "station-k-2");
    stationInfo(newer, "k");
    expect(told).toContainEqual({ type: "station-superseded" });
    expect(older.open).toBe(false);
    expect(newer.open).toBe(true);
    host.stop();
  });

  it("does not close a station that sends its info again, as a rename does", async () => {
    const host = await startedHost();
    const conn = await connectStation(host, "station-k-1");
    stationInfo(conn, "k");
    stationInfo(conn, "k");
    expect(conn.open).toBe(true);
    host.stop();
  });
});

describe("a connection whose ICE has died", () => {
  afterEach(() => {
    FakeHub.reset();
    localStorageMock.clear();
  });

  it("is closed, and nothing it sends afterwards is acted on", async () => {
    const host = await startedHost();
    const pushed: string[] = [];
    host.onWidgetPush((peerId) => {
      pushed.push(peerId);
    });
    const conn = await connectStation(host, "station-a");
    conn.peerConnection?.fail();
    expect(conn.open).toBe(false);
    conn.emit("data", {
      type: "widget-push",
      widgetInstanceId: "w",
      componentId: "c",
      config: {},
      width: 1,
      height: 1,
    });
    expect(pushed).toEqual([]);
    host.stop();
  });
});
