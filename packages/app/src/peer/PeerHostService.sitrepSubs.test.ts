/**
 * What re-syncs the sitrep refcount.
 *
 * The host holds one upstream subscription per topic any connected station
 * says it is reading, and that refcount is what decides what the host pulls
 * from the mod. It is fed by events, so every event that can go missing is a
 * claim that never comes back: PeerJS can lose an open connection without
 * firing `close`, and `stop()` empties the live set without any connection
 * closing at all. Both leave the count above what the live stations justify,
 * and the count can only climb.
 *
 * Two independent recoveries, one per failure: the ICE liveness detector gives
 * the host the same "this connection is dead" signal a station already acts on,
 * and reconciling against the live connections repairs whatever the events
 * missed. Each test below goes red if its own half is removed.
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

const TOPIC = "thirdparty.readout";

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
  peer.emit("connection", conn as unknown as DataConnection);
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

describe("the sitrep refcount re-syncs", () => {
  afterEach(() => {
    FakeHub.reset();
    localStorageMock.clear();
  });

  it("releases a station's claims when its connection dies without a close event", async () => {
    const host = await startedHost();
    const sink = makeSink();
    host.attachSitrepSink(sink);

    const conn = await connectStation(host, "station-a");
    claim(conn, TOPIC);
    expect(sink.live.has(TOPIC)).toBe(true);

    // ICE goes terminal and PeerJS never fires `close`. This is the failure the
    // station half already carries a workaround for; the host now sees it too.
    conn.peerConnection?.fail();

    expect(sink.live.has(TOPIC)).toBe(false);
    host.stop();
  });

  it("counts a station that came back after a silent death once, not twice", async () => {
    const host = await startedHost();
    const sink = makeSink();
    host.attachSitrepSink(sink);

    const first = await connectStation(host, "station-a-1");
    claim(first, TOPIC);
    first.peerConnection?.fail();

    // A reconnecting station arrives under a fresh peer id (`openPeer` re-rolls
    // the session token), so nothing about the id says it is the same device.
    const second = await connectStation(host, "station-a-2");
    claim(second, TOPIC);
    expect(sink.live.has(TOPIC)).toBe(true);

    // One station wanted it, so one departure must be enough to drop it.
    second.close();
    expect(sink.live.has(TOPIC)).toBe(false);
    host.stop();
  });

  it("drops claims held by connections the host no longer has, whatever lost them", async () => {
    const host = await startedHost();
    const sink = makeSink();
    const detach = host.attachSitrepSink(sink);

    // No underlying peer connection, so the liveness detector is blind here:
    // reconciliation is the only thing that can answer for this station.
    const conn = await connectStation(host, "station-a", {
      withPeerConnection: false,
    });
    claim(conn, TOPIC);
    expect(sink.live.has(TOPIC)).toBe(true);

    // `stop()` empties the live connection set without any connection closing,
    // so nothing released what that station was reading.
    host.stop();
    expect(sink.live.has(TOPIC)).toBe(false);

    // And the claim must not come back when the host's own stream reconnects
    // and every upstream subscription is rebuilt from the refcounts.
    detach();
    const rebuilt = makeSink();
    host.attachSitrepSink(rebuilt);
    expect(rebuilt.live.size).toBe(0);
  });

  it("keeps a live station's claim while another station's is reconciled away", async () => {
    const host = await startedHost();
    const sink = makeSink();
    host.attachSitrepSink(sink);

    const leaving = await connectStation(host, "station-a");
    const staying = await connectStation(host, "station-b");
    claim(leaving, TOPIC);
    claim(staying, TOPIC);

    leaving.peerConnection?.fail();

    // Two stations asked, one is gone: the topic is still wanted.
    expect(sink.live.has(TOPIC)).toBe(true);
    staying.close();
    expect(sink.live.has(TOPIC)).toBe(false);
    host.stop();
  });
});
