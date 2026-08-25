/**
 * Whether the DEMAND-ONLY refcount balances.
 *
 * `peerDrivenSubs` holds one upstream subscribe per (source, key) a station
 * asked for that the source's own `schema()` does not already cover, and it is
 * fed by events the same way the sitrep refcount next door is. The question
 * asked of it was whether it leaks, and the honest way to answer that is to
 * assert the property rather than to read the three call sites and conclude
 * they look paired.
 *
 * Three paths can release a claim, and each is a separate way to leave one
 * held: an explicit unsubscribe, a connection closing, and a re-subscribe that
 * should not double-count. A leak in any of them pins an upstream subscription
 * for the rest of the session.
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

import type { DataConnection } from "peerjs";
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
  peer.emit("connection", conn as unknown as DataConnection);
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

const SOURCE = "demand-source";
/** Not in the source's schema below, so a station asking for it drives the subscribe. */
const DEMAND_KEY = "demand.only.key";

/**
 * A source whose `schema()` deliberately does NOT list `DEMAND_KEY`, which is
 * what makes a station's request for it demand-driven rather than something the
 * broadcast wrapper already covers.
 */
function makeDemandSource() {
  let live = 0;
  return {
    peakLive: 0,
    get live() {
      return live;
    },
    schema: () => [{ key: "in.the.schema" }],
    subscribe(_key: string, _cb: (value: unknown) => void) {
      live += 1;
      this.peakLive = Math.max(this.peakLive, live);
      return () => {
        live -= 1;
      };
    },
  };
}

function subscribeKeys(conn: FakeConn, keys: string[]): void {
  conn.emit("data", { type: "peer-data-subscribe", sourceId: SOURCE, keys });
}

function unsubscribeKeys(conn: FakeConn, keys: string[]): void {
  conn.emit("data", { type: "peer-data-unsubscribe", sourceId: SOURCE, keys });
}

describe("peerDrivenSubs: the demand-only upstream refcount", () => {
  afterEach(() => {
    FakeHub.reset();
    localStorageMock.clear();
  });

  it("brings an upstream subscribe up for a key outside the source's schema", async () => {
    const host = await startedHost();
    const source = makeDemandSource();
    host.registerSourceForBackfill(SOURCE, source);
    const conn = await connectStation(host, "station-a");

    subscribeKeys(conn, [DEMAND_KEY]);
    expect(source.live).toBe(1);
    host.stop();
  });

  it("does not subscribe twice for a key the source's schema already covers", async () => {
    const host = await startedHost();
    const source = makeDemandSource();
    host.registerSourceForBackfill(SOURCE, source);
    const conn = await connectStation(host, "station-a");

    subscribeKeys(conn, ["in.the.schema"]);
    expect(source.live).toBe(0);
    host.stop();
  });

  it("releases it on an explicit unsubscribe", async () => {
    const host = await startedHost();
    const source = makeDemandSource();
    host.registerSourceForBackfill(SOURCE, source);
    const conn = await connectStation(host, "station-a");

    subscribeKeys(conn, [DEMAND_KEY]);
    unsubscribeKeys(conn, [DEMAND_KEY]);
    expect(source.live).toBe(0);
    host.stop();
  });

  it("releases it when the connection closes without unsubscribing", async () => {
    const host = await startedHost();
    const source = makeDemandSource();
    host.registerSourceForBackfill(SOURCE, source);
    const conn = await connectStation(host, "station-a");

    subscribeKeys(conn, [DEMAND_KEY]);
    conn.close();
    expect(source.live).toBe(0);
    host.stop();
  });

  it("counts a re-asserted subscription once, so the claim can still be released", async () => {
    // A station re-sending its subscription list is routine. Counting each
    // re-send would pin the upstream subscribe forever, because only as many
    // unsubscribes as there were sends could ever bring it down.
    const host = await startedHost();
    const source = makeDemandSource();
    host.registerSourceForBackfill(SOURCE, source);
    const conn = await connectStation(host, "station-a");

    subscribeKeys(conn, [DEMAND_KEY]);
    subscribeKeys(conn, [DEMAND_KEY]);
    subscribeKeys(conn, [DEMAND_KEY]);
    expect(source.peakLive).toBe(1);

    unsubscribeKeys(conn, [DEMAND_KEY]);
    expect(source.live).toBe(0);
    host.stop();
  });

  it("holds one claim while a second station still wants the key", async () => {
    const host = await startedHost();
    const source = makeDemandSource();
    host.registerSourceForBackfill(SOURCE, source);
    const a = await connectStation(host, "station-a");
    const b = await connectStation(host, "station-b");

    subscribeKeys(a, [DEMAND_KEY]);
    subscribeKeys(b, [DEMAND_KEY]);
    expect(source.peakLive).toBe(1);

    a.close();
    expect(source.live).toBe(1);
    b.close();
    expect(source.live).toBe(0);
    host.stop();
  });
});
