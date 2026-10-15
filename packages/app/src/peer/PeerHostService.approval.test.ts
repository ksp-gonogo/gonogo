/**
 * The main screen's approval of a station: what a station is served before
 * and after it, and what the host remembers.
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

import {
  AWAITING_APPROVAL,
  PeerHostService,
  type PendingStation,
} from "./PeerHostService";
import { asPeerMessage, type PeerMessage } from "./protocol";
import { stationApprovals } from "./stationApprovals";

type FakeConn = InstanceType<typeof FakeHub.DataConnection>;

interface Station {
  conn: FakeConn;
  told: PeerMessage[];
}

async function startedHost(): Promise<PeerHostService> {
  const host = new PeerHostService();
  await host.start();
  await Promise.resolve();
  return host;
}

/** Bring a station up, introduce it by name and credential, and record what the host tells it. */
async function join(
  host: PeerHostService,
  peerId: string,
  credential: string,
  name = "Flight",
): Promise<Station> {
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
  conn.emit("data", { type: "station-credential", credential });
  conn.emit("data", {
    type: "station-info",
    name,
    stationKey: `key-${peerId}`,
  });
  return { conn, told };
}

/** Ask for a command, a flight deletion and an Uplink call, and settle. */
async function askEverything(station: Station): Promise<void> {
  station.conn.emit("data", {
    type: "sitrep-command-request",
    requestId: "cmd-1",
    command: "vessel.stage",
    args: {},
  });
  station.conn.emit("data", {
    type: "flight-rpc-request",
    requestId: "rpc-1",
    op: { op: "delete", id: "flight-1" },
  });
  station.conn.emit("data", {
    type: "uplink-relay-request",
    requestId: "relay-1",
    uplinkId: "test-uplink",
    method: "run",
    args: {},
  });
  for (let i = 0; i < 10; i++) await Promise.resolve();
}

function replyTo(station: Station, requestId: string) {
  return station.told.find(
    (m) => "requestId" in m && m.requestId === requestId,
  );
}

function refusedEverything(station: Station): void {
  expect(replyTo(station, "cmd-1")).toMatchObject({
    type: "sitrep-command-response",
    result: { success: false, reason: AWAITING_APPROVAL },
  });
  expect(replyTo(station, "rpc-1")).toMatchObject({
    type: "flight-rpc-response",
    error: AWAITING_APPROVAL,
  });
  expect(replyTo(station, "relay-1")).toMatchObject({
    type: "uplink-relay-response",
    error: AWAITING_APPROVAL,
  });
}

/** A served request goes on to the real handler, which answers in its own time. */
async function servedEverything(station: Station): Promise<void> {
  for (const id of ["cmd-1", "rpc-1", "relay-1"]) {
    await vi.waitFor(() => expect(replyTo(station, id)).toBeDefined());
    expect(JSON.stringify(replyTo(station, id))).not.toContain(
      AWAITING_APPROVAL,
    );
  }
}

describe("a station the main screen has not approved", () => {
  afterEach(() => {
    FakeHub.reset();
    localStorageMock.clear();
  });

  it("reads telemetry but has commands, flight requests and Uplink calls refused", async () => {
    const host = await startedHost();
    const station = await join(host, "station-a", "cred-a");
    host.broadcast({
      type: "data",
      sourceId: "sitrep",
      key: "v.altitude",
      value: 1,
    });
    expect(station.told).toContainEqual({
      type: "data",
      sourceId: "sitrep",
      key: "v.altitude",
      value: 1,
    });
    await askEverything(station);
    refusedEverything(station);
    host.stop();
  });

  it("is raised on the main screen by name and told it is waiting", async () => {
    const host = await startedHost();
    const seen: Array<readonly PendingStation[]> = [];
    host.onPendingStationsChange((p) => seen.push(p));
    const station = await join(host, "station-a", "cred-a", "Booster");
    expect(host.pendingStations()).toEqual([
      { peerId: "station-a", name: "Booster" },
    ]);
    expect(seen.at(-1)).toEqual(host.pendingStations());
    expect(station.told).toContainEqual({
      type: "station-approval",
      state: "pending",
    });
    host.stop();
  });

  it("is refused, told so and disconnected, and nothing is remembered", async () => {
    const host = await startedHost();
    const station = await join(host, "station-a", "cred-a");
    const told = station.told;
    host.refuseStation("station-a");
    expect(told).toContainEqual({ type: "station-approval", state: "refused" });
    expect(station.conn.open).toBe(false);
    expect(host.pendingStations()).toEqual([]);
    expect(stationApprovals.isApproved("cred-a")).toBe(false);
    host.stop();
  });

  it("cannot be approved by presenting another station's key without its credential", async () => {
    const host = await startedHost();
    await join(host, "station-a", "cred-a");
    host.approveStation("station-a");
    const impostor = await join(host, "station-b", "cred-guess");
    impostor.conn.emit("data", {
      type: "station-info",
      name: "Flight",
      stationKey: "key-station-a",
    });
    await askEverything(impostor);
    refusedEverything(impostor);
    host.stop();
  });
});

describe("a station the main screen approves", () => {
  afterEach(() => {
    FakeHub.reset();
    localStorageMock.clear();
  });

  it("is served from then on and leaves the pending list", async () => {
    const host = await startedHost();
    const station = await join(host, "station-a", "cred-a");
    host.approveStation("station-a");
    expect(host.pendingStations()).toEqual([]);
    expect(station.told).toContainEqual({
      type: "station-approval",
      state: "approved",
    });
    await askEverything(station);
    await servedEverything(station);
    host.stop();
  });

  it("is served on rejoin in a later session without being raised again", async () => {
    const first = await startedHost();
    await join(first, "station-a", "cred-a");
    first.approveStation("station-a");
    first.stop();
    FakeHub.reset();

    const host = await startedHost();
    const station = await join(host, "station-a2", "cred-a");
    expect(host.pendingStations()).toEqual([]);
    expect(station.told).toContainEqual({
      type: "station-approval",
      state: "approved",
    });
    await askEverything(station);
    await servedEverything(station);
    host.stop();
  });

  it("is refused and disconnected once removed, and refused when it rejoins", async () => {
    const host = await startedHost();
    const station = await join(host, "station-a", "cred-a");
    host.approveStation("station-a");
    host.removeApprovedStation("cred-a");
    expect(station.conn.open).toBe(false);
    expect(station.told).toContainEqual({
      type: "station-approval",
      state: "refused",
    });

    const back = await join(host, "station-a2", "cred-a");
    await askEverything(back);
    refusedEverything(back);
    expect(host.pendingStations()).toEqual([
      { peerId: "station-a2", name: "Flight" },
    ]);
    host.stop();
  });
});
