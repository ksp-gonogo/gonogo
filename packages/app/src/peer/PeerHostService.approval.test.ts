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

  it("is sent nothing but its hello and where its approval stands", async () => {
    const host = await startedHost();
    const station = await join(host, "station-a", "cred-a");
    host.broadcast({
      type: "data",
      sourceId: "sitrep",
      key: "v.altitude",
      value: 1,
    });
    await new Promise((r) => setTimeout(r, 0));
    expect(station.told.map((m) => m.type)).toEqual([
      "hello",
      "station-approval",
    ]);
    host.stop();
  });

  it("has commands, flight requests and Uplink calls refused", async () => {
    const host = await startedHost();
    const station = await join(host, "station-a", "cred-a");
    await askEverything(station);
    refusedEverything(station);
    host.stop();
  });

  it("has its reads refused and leaves no subscription behind", async () => {
    const host = await startedHost();
    const station = await join(host, "station-a", "cred-a");
    station.conn.emit("data", {
      type: "query-range-request",
      requestId: "range-1",
      sourceId: "sitrep",
      key: "v.altitude",
      tStart: 0,
      tEnd: 1,
    });
    station.conn.emit("data", {
      type: "sitrep-subscribe",
      topic: "vessel.flight",
    });
    expect(replyTo(station, "range-1")).toMatchObject({
      type: "query-range-response",
      error: AWAITING_APPROVAL,
    });
    host.approveStation("station-a");
    host.broadcast({
      type: "data",
      sourceId: "sitrep",
      key: "v.altitude",
      value: 2,
    });
    expect(station.told).toContainEqual({
      type: "data",
      sourceId: "sitrep",
      key: "v.altitude",
      value: 2,
    });
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

/** One of each write with no command reply, as a station sends it. */
const WRITES = [
  { type: "gonogo-vote", status: "go" },
  { type: "gonogo-abort" },
  {
    type: "widget-push",
    widgetInstanceId: "w",
    componentId: "c",
    config: {},
    width: 1,
    height: 1,
  },
  { type: "alarm-add", name: "Burn", trigger: { kind: "time", ut: 1 } },
  { type: "alarm-update", id: "a", patch: { name: "Burn" } },
  { type: "alarm-delete", id: "a" },
] as const;

const NOTES = [
  { type: "note-add", ref: "n1", body: "x" },
  { type: "note-update", ref: "n2", id: "a", body: "x", baseVersion: 1 },
  { type: "note-delete", ref: "n3", id: "a", baseVersion: 1 },
  { type: "note-reorder", ref: "n4", id: "a", afterId: null, baseVersion: 1 },
] as const;

/** Which host events a station's writes reached. */
function heard(host: PeerHostService): string[] {
  const got: string[] = [];
  host.onGonogoVote(() => got.push("gonogo-vote"));
  host.onGonogoAbort(() => got.push("gonogo-abort"));
  host.onWidgetPush(() => got.push("widget-push"));
  host.onAlarmAdd(() => got.push("alarm-add"));
  host.onAlarmUpdate(() => got.push("alarm-update"));
  host.onAlarmDelete(() => got.push("alarm-delete"));
  host.onNoteAdd(() => got.push("note-add"));
  host.onNoteUpdate(() => got.push("note-update"));
  host.onNoteDelete(() => got.push("note-delete"));
  host.onNoteReorder(() => got.push("note-reorder"));
  return got;
}

describe("every other write from a station", () => {
  afterEach(() => {
    FakeHub.reset();
    localStorageMock.clear();
  });

  it("is refused with the reason before approval, and nothing reaches the main screen", async () => {
    const host = await startedHost();
    const got = heard(host);
    const station = await join(host, "station-a", "cred-a");
    for (const msg of [...WRITES, ...NOTES]) station.conn.emit("data", msg);
    expect(got).toEqual([]);
    for (const msg of WRITES) {
      expect(station.told).toContainEqual({
        type: "station-write-refused",
        refused: msg.type,
        reason: AWAITING_APPROVAL,
      });
    }
    for (const msg of NOTES) {
      expect(station.told).toContainEqual({
        type: "note-result",
        ref: msg.ref,
        ok: false,
        awaitingApproval: true,
      });
    }
    host.stop();
  });

  it("reaches the main screen once the station is approved", async () => {
    const host = await startedHost();
    const got = heard(host);
    const station = await join(host, "station-a", "cred-a");
    host.approveStation("station-a");
    for (const msg of [...WRITES, ...NOTES]) station.conn.emit("data", msg);
    expect(got).toEqual([...WRITES, ...NOTES].map((m) => m.type));
    expect(
      station.told.filter((m) => m.type === "station-write-refused"),
    ).toEqual([]);
    host.stop();
  });
});

describe("the relay's credentials", () => {
  const TURN: RTCIceServer[] = [
    { urls: "turn:203.0.113.5:3478", username: "u", credential: "secret" },
  ];
  const ROTATED: RTCIceServer[] = [
    { urls: "turn:203.0.113.5:3478", username: "u2", credential: "rotated" },
  ];

  afterEach(() => {
    FakeHub.reset();
    localStorageMock.clear();
  });

  function turnTold(station: Station): PeerMessage[] {
    return station.told.filter((m) => m.type === "relay-ice-servers");
  }

  /** Serve `servers` from the relay's `/ice-config` until `restore` is called. */
  function relayServes(servers: { current: RTCIceServer[] }) {
    const spy = vi.spyOn(globalThis, "fetch").mockImplementation(
      async () =>
        new Response(JSON.stringify({ iceServers: servers.current }), {
          status: 200,
        }),
    );
    return () => spy.mockRestore();
  }

  /** Let the host's minute-long `/ice-config` refresh run once, and settle. */
  async function rotate(): Promise<void> {
    await vi.advanceTimersByTimeAsync(60_000);
    for (let i = 0; i < 10; i++) await Promise.resolve();
  }

  it("are withheld from a station waiting for approval, even on a rotation", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    const servers = { current: TURN };
    const restore = relayServes(servers);
    const host = await startedHost();
    const station = await join(host, "station-a", "cred-a");
    servers.current = ROTATED;
    await rotate();
    expect(host.iceServers).toEqual(ROTATED);
    expect(turnTold(station)).toEqual([]);
    host.stop();
    restore();
    vi.useRealTimers();
  });

  it("are handed to a station when it is approved and on each rotation after", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    const servers = { current: TURN };
    const restore = relayServes(servers);
    const host = await startedHost();
    const station = await join(host, "station-a", "cred-a");
    host.approveStation("station-a");
    expect(turnTold(station)).toEqual([
      { type: "relay-ice-servers", iceServers: TURN },
    ]);
    servers.current = ROTATED;
    await rotate();
    expect(turnTold(station)).toEqual([
      { type: "relay-ice-servers", iceServers: TURN },
      { type: "relay-ice-servers", iceServers: ROTATED },
    ]);
    host.stop();
    restore();
    vi.useRealTimers();
  });

  it("are handed to a remembered station as soon as it rejoins", async () => {
    stationApprovals.approve("cred-a", "Flight");
    const host = await startedHost();
    host.iceServers = TURN;
    const station = await join(host, "station-a", "cred-a");
    expect(turnTold(station)).toEqual([
      { type: "relay-ice-servers", iceServers: TURN },
    ]);
    host.stop();
  });
});
