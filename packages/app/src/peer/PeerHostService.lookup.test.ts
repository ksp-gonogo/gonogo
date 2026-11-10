/**
 * A join page's look-up of a code, and the host seat every peer is told.
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

import { MemoryApprovalBook } from "../test/approveStation";
import { PeerHostService } from "./PeerHostService";
import { asPeerMessage, type PeerMessage } from "./protocol";

type FakeConn = InstanceType<typeof FakeHub.DataConnection>;

interface Link {
  conn: FakeConn;
  told: PeerMessage[];
}

async function startedHost(): Promise<PeerHostService> {
  const host = new PeerHostService();
  host.attachApprovals(new MemoryApprovalBook());
  await host.adoptShareCode("ABC234");
  await host.start();
  await Promise.resolve();
  return host;
}

/** Open a link to the host and record what it is told. */
async function open(host: PeerHostService, peerId: string): Promise<Link> {
  const peer = FakeHub.Peer.registry.get(host.peerId ?? "");
  if (!peer) throw new Error("host peer not registered");
  const conn = new FakeHub.DataConnection(peerId, true);
  const told: PeerMessage[] = [];
  conn.send = (msg?: unknown) => {
    const message = asPeerMessage(msg);
    if (conn.open && message) told.push(message);
  };
  peer.emit("connection", conn);
  conn.emit("open");
  await Promise.resolve();
  return { conn, told };
}

/** Join at `seat` and have the host approve it. */
async function joinApproved(
  host: PeerHostService,
  peerId: string,
  seat?: "pilot",
): Promise<Link> {
  const link = await open(host, peerId);
  link.conn.emit("data", {
    type: "station-credential",
    credential: `cred-${peerId}`,
  });
  link.conn.emit("data", {
    type: "station-info",
    name: peerId,
    stationKey: `key-${peerId}`,
    ...(seat ? { seat } : {}),
  });
  await Promise.resolve();
  host.approveStation(peerId);
  for (let i = 0; i < 5; i++) await Promise.resolve();
  return link;
}

describe("a join page's look-up", () => {
  afterEach(() => {
    FakeHub.reset();
    localStorageMock.clear();
  });

  it("is answered with the host's seat, the stations connected and the pilots aboard, without approval", async () => {
    const host = await startedHost();
    await joinApproved(host, "pilot-a", "pilot");
    await joinApproved(host, "station-a");
    host.setHostSeat("pilot");
    const lookup = await open(host, "lookup-1");
    lookup.conn.emit("data", { type: "game-lookup" });
    expect(lookup.told.find((m) => m.type === "game-facts")).toEqual({
      type: "game-facts",
      hostSeat: "pilot",
      stations: 1,
      pilots: 2,
    });
    expect(host.pendingStations()).toEqual([]);
    host.stop();
  });

  it("is sent nothing beyond the hello, the analytics switch and the facts", async () => {
    const host = await startedHost();
    const lookup = await open(host, "lookup-1");
    lookup.conn.emit("data", { type: "game-lookup" });
    host.broadcast({ type: "data", sourceId: "s", key: "k", value: 1 });
    await new Promise((r) => setTimeout(r, 0));
    expect(lookup.told.map((m) => m.type)).toEqual([
      "hello",
      "analytics-consent",
      "game-facts",
    ]);
    host.stop();
  });
});

describe("a waiting request", () => {
  afterEach(() => {
    FakeHub.reset();
    localStorage.clear();
  });

  it("carries the pilot seat when a pilot asks to join", async () => {
    const host = await startedHost();
    const link = await open(host, "pilot-a");
    link.conn.emit("data", { type: "station-credential", credential: "c" });
    link.conn.emit("data", {
      type: "station-info",
      name: "Pilot",
      stationKey: "key-pilot-a",
      seat: "pilot",
    });
    await Promise.resolve();
    expect(host.pendingStations()).toEqual([
      { peerId: "pilot-a", name: "Pilot", seat: "pilot" },
    ]);
    host.stop();
  });
});

describe("the host's seat", () => {
  afterEach(() => {
    FakeHub.reset();
    localStorageMock.clear();
  });

  it("is told to a peer as it joins, and to every peer when it changes", async () => {
    const host = await startedHost();
    const station = await joinApproved(host, "station-a");
    expect(station.told).toContainEqual({ type: "host-seat", seat: "main" });
    host.setHostSeat("pilot");
    expect(station.told).toContainEqual({ type: "host-seat", seat: "pilot" });
    host.stop();
  });

  it("remembers the seat each approved screen joined at", async () => {
    const host = await startedHost();
    await joinApproved(host, "station-a");
    await joinApproved(host, "pilot-a", "pilot");
    expect(host.approvedSeat("id-cred-station-a")).toBe("station");
    expect(host.approvedSeat("id-cred-pilot-a")).toBe("pilot");
    expect(host.approvedSeat("id-unknown")).toBeUndefined();
    host.stop();
  });

  it("counts the stations and pilots that are approved", async () => {
    const host = await startedHost();
    const seen = vi.fn();
    host.onSeatsChange(seen);
    await joinApproved(host, "station-a");
    await joinApproved(host, "station-b");
    const pilot = await joinApproved(host, "pilot-a", "pilot");
    expect(host.seatCounts()).toEqual({ stations: 2, pilots: 1 });
    pilot.conn.close();
    expect(host.seatCounts()).toEqual({ stations: 2, pilots: 0 });
    expect(seen).toHaveBeenCalled();
    host.stop();
  });
});
