/**
 * A mirrored game window reaches only the station whose press opened it. The mod
 * sends every window to the host's session, because a station's commands go out
 * through it, so the host decides which station is shown which window.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { HostJobs } from "../hosting/HostJobs";

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

    readonly sent: unknown[] = [];

    send(message?: unknown) {
      this.sent.push(message);
    }

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
  createTestTelemetryClient,
  StubTransport,
} from "@ksp-gonogo/sitrep-sdk/testing";
import { approveConnection } from "../test/approveStation";
import { hostShowsWindow } from "./gameWindowRouting";
import { PeerHostService } from "./PeerHostService";

type FakeConn = InstanceType<typeof FakeHub.DataConnection>;

async function connectStation(
  host: PeerHostService,
  peerId: string,
): Promise<FakeConn> {
  const peer = FakeHub.Peer.registry.get(host.peerId ?? "");
  if (!peer) throw new Error("host peer not registered");
  const conn = new FakeHub.DataConnection(peerId, true);
  peer.emit("connection", conn);
  conn.emit("open");
  await Promise.resolve();
  approveConnection(conn);
  return conn;
}

function press(
  conn: FakeConn,
  requestId: string,
  command = "vessel.invokePartAction",
) {
  conn.emit("data", {
    type: "sitrep-command-request",
    requestId,
    command,
    args: { partId: "7", eventName: "RenameVessel" },
  });
}

const window = (id: string, pressId: string) => ({
  id,
  technology: "ugui",
  title: "Rename",
  openedBy: {
    partId: "7",
    module: "ModuleCommand",
    event: "RenameVessel",
    label: "Rename Vessel",
    pressId,
  },
  root: { id: "w", kind: "group" },
});

function windowFrame(...windows: unknown[]) {
  return {
    type: "sitrep-frame",
    message: {
      type: "stream-data",
      topic: "vessel.gameWindows",
      payload: { windows },
      meta: { validAt: 1 },
    },
  };
}

/** The ids of the windows a sent message lists, when it is a `vessel.gameWindows` frame. */
function windowIdsIn(sent: unknown): string[] {
  if (typeof sent !== "object" || sent === null) return [];
  if (!("type" in sent) || sent.type !== "sitrep-frame") return [];
  if (!("message" in sent) || typeof sent.message !== "object") return [];
  const message = sent.message;
  if (message === null || !("topic" in message)) return [];
  if (message.topic !== "vessel.gameWindows" || !("payload" in message)) {
    return [];
  }
  const payload = message.payload;
  if (typeof payload !== "object" || payload === null) return [];
  if (!("windows" in payload) || !Array.isArray(payload.windows)) return [];
  return payload.windows.flatMap((w: unknown) =>
    typeof w === "object" && w !== null && "id" in w && typeof w.id === "string"
      ? [w.id]
      : [],
  );
}

function windowsSeenBy(conn: FakeConn): string[] {
  return conn.sent.flatMap(windowIdsIn);
}

describe("a game window the host relays to its stations", () => {
  afterEach(() => {
    FakeHub.reset();
    localStorageMock.clear();
  });

  it("is sent only to the station whose press opened it", async () => {
    const host = new PeerHostService();
    await host.start();
    await Promise.resolve();
    const first = await connectStation(host, "station-a");
    const second = await connectStation(host, "station-b");
    press(first, "a-1");
    press(second, "b-1");

    host.broadcast(
      windowFrame(window("ugui:1", "a-1"), window("ugui:2", "b-1")) as never,
    );

    expect(windowsSeenBy(first)).toEqual(["ugui:1"]);
    expect(windowsSeenBy(second)).toEqual(["ugui:2"]);
  });

  it("is sent to no station when no station pressed, so a window the host's own screen opened stays there", async () => {
    const host = new PeerHostService();
    await host.start();
    await Promise.resolve();
    const station = await connectStation(host, "station-a");

    host.broadcast(windowFrame(window("ugui:1", "host-9")) as never);

    expect(windowsSeenBy(station)).toEqual([]);
    expect(host.isStationWindowPress("host-9")).toBe(false);
  });

  it("is marked as a station's, for the host's own screen to leave out, until that station leaves", async () => {
    const host = new PeerHostService();
    await host.start();
    await Promise.resolve();
    const station = await connectStation(host, "station-a");
    press(station, "a-1", "vessel.gameWindow.press");

    expect(host.isStationWindowPress("a-1")).toBe(true);

    station.close();
    expect(host.isStationWindowPress("a-1")).toBe(false);
  });
});

describe("the host's own screen", () => {
  it("draws a window its own press opened and neither a station's nor one with no press behind it", () => {
    const stations = new Set(["a-1"]);

    expect(hostShowsWindow("host-1", (id) => stations.has(id))).toBe(true);
    expect(hostShowsWindow("a-1", (id) => stations.has(id))).toBe(false);
    expect(hostShowsWindow("", (id) => stations.has(id))).toBe(false);
    expect(hostShowsWindow(undefined, (id) => stations.has(id))).toBe(false);
  });
});

describe("a press that opens a game window from a station", () => {
  afterEach(() => {
    FakeHub.reset();
    localStorageMock.clear();
  });

  /** A command route that records the commands it is given, named so a test can say which session sent what. */
  function route(name: string, log: string[]) {
    return {
      dispatch: (command: string) => {
        log.push(`${name}:${command}`);
        return { requestId: "r", result: Promise.resolve(null) };
      },
      dispatchGroup: () => ({ result: Promise.resolve([]) }),
      onRawMessage: () => () => {},
    };
  }

  async function hostWithSessions(log: string[]) {
    const host = new PeerHostService();
    await host.start();
    await Promise.resolve();
    // The session that reads for plain stations, and the separate jobs connection every other command uses.
    host.attachSitrepSink({
      subscribe: () => () => {},
      requestRate: () => () => {},
      cachedFrames: () => [],
      command: route("reading", log) as never,
    });
    const jobs = new HostJobs();
    jobs.setClient(route("jobs", log) as never);
    host.attachHostJobs(jobs);
    return host;
  }

  it("is sent on the session that reads for the station, and every other command stays on the jobs connection", async () => {
    const log: string[] = [];
    const host = await hostWithSessions(log);
    const station = await connectStation(host, "station-a");

    press(station, "a-1", "vessel.invokePartAction");
    press(station, "a-2", "vessel.gameWindow.press");
    press(station, "a-3", "vessel.control.setSas");
    await Promise.resolve();

    expect(log).toEqual([
      "reading:vessel.invokePartAction",
      "reading:vessel.gameWindow.press",
      "jobs:vessel.control.setSas",
    ]);
  });

  it("gets the form to the station that pressed and to no other screen", async () => {
    const log: string[] = [];
    const host = await hostWithSessions(log);
    const stationA = await connectStation(host, "station-a");
    const stationB = await connectStation(host, "station-b");

    press(stationA, "a-1");
    await Promise.resolve();
    // The mod opens a window for that press and the reading session is sent it.
    host.broadcast(windowFrame(window("ugui:1", "a-1")) as never);

    expect(log).toEqual(["reading:vessel.invokePartAction"]);
    expect(windowsSeenBy(stationA)).toEqual(["ugui:1"]);
    expect(windowsSeenBy(stationB)).toEqual([]);
    expect(hostShowsWindow("a-1", (id) => host.isStationWindowPress(id))).toBe(
      false,
    );
  });
});

describe("the main screen's own reading of the windows after a station leaves", () => {
  afterEach(() => {
    FakeHub.reset();
    localStorageMock.clear();
  });

  const TOPIC = "vessel.gameWindows";

  async function hostOverRealClient() {
    const host = new PeerHostService();
    await host.start();
    await Promise.resolve();
    const transport = new StubTransport();
    const client = createTestTelemetryClient(transport);
    // The sink as SitrepPeerRelay supplies it: a subscription on the screen's own client.
    host.attachSitrepSink({
      subscribe: (topic) => client.subscribe(topic, () => {}),
      requestRate: () => () => {},
      cachedFrames: () => [],
      command: client,
    });
    return { host, transport, client };
  }

  it("keeps the main screen's subscription when the station that shared it leaves", async () => {
    const { host, transport, client } = await hostOverRealClient();
    const station = await connectStation(host, "station-a");
    station.emit("data", { type: "sitrep-subscribe", topic: TOPIC });
    const mainRead = client.subscribe(TOPIC, () => {});
    expect(transport.isSubscribed(TOPIC)).toBe(true);

    station.close();

    expect(transport.isSubscribed(TOPIC)).toBe(true);
    mainRead();
    expect(transport.isSubscribed(TOPIC)).toBe(false);
  });

  it("subscribes the main screen's reading afresh when it opens after the station has left", async () => {
    const { host, transport, client } = await hostOverRealClient();
    const station = await connectStation(host, "station-a");
    station.emit("data", { type: "sitrep-subscribe", topic: TOPIC });
    expect(transport.isSubscribed(TOPIC)).toBe(true);
    station.close();
    expect(transport.isSubscribed(TOPIC)).toBe(false);

    const mainRead = client.subscribe(TOPIC, () => {});

    expect(transport.isSubscribed(TOPIC)).toBe(true);
    mainRead();
  });

  it("lets a main-screen press get its form after a station has joined, pressed and left", async () => {
    const { host, transport, client } = await hostOverRealClient();
    const station = await connectStation(host, "station-a");
    station.emit("data", { type: "sitrep-subscribe", topic: TOPIC });
    press(station, "a-1");
    await Promise.resolve();
    expect(host.isStationWindowPress("a-1")).toBe(true);
    station.close();

    // The main screen presses and opens its panel, which reads the windows on the screen's own session.
    const mainRead = client.subscribe(TOPIC, () => {});
    expect(transport.isSubscribed(TOPIC)).toBe(true);
    expect(host.isStationWindowPress("a-1")).toBe(false);
    expect(hostShowsWindow("m-1", (id) => host.isStationWindowPress(id))).toBe(
      true,
    );

    // The reader lets go of the topic and takes it again when the screen redraws around it: the wire shows a gap the mod has to ride out.
    mainRead();
    expect(transport.isSubscribed(TOPIC)).toBe(false);
    const again = client.subscribe(TOPIC, () => {});
    expect(transport.isSubscribed(TOPIC)).toBe(true);
    again();
  });
});
