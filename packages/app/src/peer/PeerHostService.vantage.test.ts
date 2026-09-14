/**
 * A connection reads from the vantage it asked for, and from the upstream
 * session that belongs to that vantage.
 *
 * The mod keeps the chosen vantage per CLIENT SESSION and applies each
 * subscriber's delay from it, so two peers observing from two places need two
 * sessions: there is no way to re-derive one stream's delay from the other's,
 * because a frame does not carry the delay it travelled under. The host
 * therefore holds a session per vantage anything asks for, and each
 * connection's topic claims are refcounted against its own.
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

    send() {}

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

const TOPIC = "thirdparty.readout";
const CRAFT = "vessel:abc-123";

/** Records what the host currently holds upstream, the way `SitrepPeerRelay` supplies it. */
function makeSink() {
  const live = new Set<string>();
  return {
    live,
    subscribe(topic: string) {
      live.add(topic);
      return () => live.delete(topic);
    },
    cachedFrame() {
      return undefined;
    },
  };
}

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

function claim(conn: FakeConn, topic: string): void {
  conn.emit("data", { type: "sitrep-subscribe", topic });
}

async function startedHost(): Promise<PeerHostService> {
  const host = new PeerHostService();
  await host.start();
  await Promise.resolve();
  return host;
}

function setVantage(conn: FakeConn, vantage: string | null): void {
  conn.emit("data", { type: "sitrep-set-vantage", vantage });
}

describe("a connection's upstream vantage", () => {
  afterEach(() => {
    FakeHub.reset();
    localStorageMock.clear();
  });

  it("reads from the host's own session until it asks for another", async () => {
    const host = await startedHost();
    const hostSink = makeSink();
    host.attachSitrepSink(hostSink);

    const conn = await connectStation(host, "station-a");
    claim(conn, TOPIC);

    expect(hostSink.live.has(TOPIC)).toBe(true);
    expect(host.requestedVantages()).toEqual([]);
    host.stop();
  });

  it("pulls from the session at the vantage it asked for, not the host's", async () => {
    const host = await startedHost();
    const hostSink = makeSink();
    const craftSink = makeSink();
    host.attachSitrepSink(hostSink);
    host.attachSitrepSinkFor(CRAFT, craftSink);

    const conn = await connectStation(host, "pilot-a");
    setVantage(conn, CRAFT);
    claim(conn, TOPIC);

    expect(craftSink.live.has(TOPIC)).toBe(true);
    // The whole point: the ground session must not be pulling the pilot's
    // topic, or the host is paying for two streams and reading one.
    expect(hostSink.live.has(TOPIC)).toBe(false);
    host.stop();
  });

  it("CARRIES a claim across when the vantage changes after it was made", async () => {
    /*
     * The peer has no reason to re-send a subscribe list it has not changed,
     * so a claim left behind would pin the old session for the rest of the
     * session and leave the new one pulling nothing.
     */
    const host = await startedHost();
    const hostSink = makeSink();
    const craftSink = makeSink();
    host.attachSitrepSink(hostSink);
    host.attachSitrepSinkFor(CRAFT, craftSink);

    const conn = await connectStation(host, "pilot-a");
    claim(conn, TOPIC);
    expect(hostSink.live.has(TOPIC)).toBe(true);

    setVantage(conn, CRAFT);

    expect(craftSink.live.has(TOPIC)).toBe(true);
    expect(hostSink.live.has(TOPIC)).toBe(false);
    host.stop();
  });

  it("hands a connection back to the host's session when its vantage is cleared", async () => {
    const host = await startedHost();
    const hostSink = makeSink();
    const craftSink = makeSink();
    host.attachSitrepSink(hostSink);
    host.attachSitrepSinkFor(CRAFT, craftSink);

    const conn = await connectStation(host, "pilot-a");
    setVantage(conn, CRAFT);
    claim(conn, TOPIC);
    // Proves the claim really was on the craft's session, so the assertions
    // after the clear are about it MOVING rather than never having left.
    expect(craftSink.live.has(TOPIC)).toBe(true);
    expect(hostSink.live.has(TOPIC)).toBe(false);

    setVantage(conn, null);

    expect(hostSink.live.has(TOPIC)).toBe(true);
    expect(craftSink.live.has(TOPIC)).toBe(false);
    expect(host.requestedVantages()).toEqual([]);
    host.stop();
  });

  it("keeps two vantages' refcounts apart, so one leaving does not drop the other", async () => {
    /*
     * Collapsing the two counts would drop BOTH upstream subscriptions the
     * moment either side let go, which is the bug a single global refcount
     * would have.
     */
    const host = await startedHost();
    const hostSink = makeSink();
    const craftSink = makeSink();
    host.attachSitrepSink(hostSink);
    host.attachSitrepSinkFor(CRAFT, craftSink);

    const ground = await connectStation(host, "station-a");
    claim(ground, TOPIC);
    const pilot = await connectStation(host, "pilot-a");
    setVantage(pilot, CRAFT);
    claim(pilot, TOPIC);
    // Both sessions genuinely holding it is the state the assertion below is
    // about; without this the test passes whenever the move never happened.
    expect(hostSink.live.has(TOPIC)).toBe(true);
    expect(craftSink.live.has(TOPIC)).toBe(true);

    pilot.close();

    expect(hostSink.live.has(TOPIC)).toBe(true);
    expect(craftSink.live.has(TOPIC)).toBe(false);
    host.stop();
  });

  it("reports the vantages live connections are reading from, so a session can be opened for each", async () => {
    const host = await startedHost();
    host.attachSitrepSink(makeSink());

    const pilot = await connectStation(host, "pilot-a");
    setVantage(pilot, CRAFT);

    expect(host.requestedVantages()).toEqual([CRAFT]);

    pilot.close();

    // A vantage nobody reads from is a session to close, so it must stop being
    // reported the moment its last reader goes.
    expect(host.requestedVantages()).toEqual([]);
    host.stop();
  });

  it("releases a pilot's claims on disconnect, against its own vantage's count", async () => {
    const host = await startedHost();
    const craftSink = makeSink();
    host.attachSitrepSink(makeSink());
    host.attachSitrepSinkFor(CRAFT, craftSink);

    const pilot = await connectStation(host, "pilot-a");
    setVantage(pilot, CRAFT);
    claim(pilot, TOPIC);
    expect(craftSink.live.has(TOPIC)).toBe(true);

    pilot.close();

    expect(craftSink.live.has(TOPIC)).toBe(false);
    host.stop();
  });
});
