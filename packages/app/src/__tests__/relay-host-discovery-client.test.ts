import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mirror the hoisted FakePeer pattern from peer-client-service.test.ts so
// these tests can drive the broker handshake + read the connect target.
const { FakePeer } = vi.hoisted(() => {
  class FakeDataConnection {
    private listeners = new Map<string, Array<(...args: unknown[]) => void>>();
    sent: unknown[] = [];
    target: string;
    constructor(target = "") {
      this.target = target;
    }
    on(event: string, cb: (...args: unknown[]) => void) {
      const bucket = this.listeners.get(event) ?? [];
      bucket.push(cb);
      this.listeners.set(event, bucket);
    }
    emit(event: string, ...args: unknown[]) {
      this.listeners.get(event)?.forEach((cb) => {
        cb(...args);
      });
    }
    close() {}
    send(msg: unknown) {
      this.sent.push(msg);
    }
  }

  class FakePeer {
    static instances: FakePeer[] = [];
    private listeners = new Map<string, Array<(...args: unknown[]) => void>>();
    _lastConn: FakeDataConnection | null = null;
    _lastConnectTarget: string | null = null;
    _conns: FakeDataConnection[] = [];

    constructor() {
      FakePeer.instances.push(this);
    }
    on(event: string, cb: (...args: unknown[]) => void) {
      const bucket = this.listeners.get(event) ?? [];
      bucket.push(cb);
      this.listeners.set(event, bucket);
    }
    emit(event: string, ...args: unknown[]) {
      this.listeners.get(event)?.forEach((cb) => {
        cb(...args);
      });
    }
    connect(id: string) {
      const conn = new FakeDataConnection(id);
      this._lastConn = conn;
      this._lastConnectTarget = id;
      this._conns.push(conn);
      return conn;
    }
    destroy() {}
  }

  return { FakePeer };
});

vi.mock("peerjs", () => ({ default: FakePeer }));

import { resolveHostPeerId } from "../peer/iceServers";
import { PeerClientService } from "../peer/PeerClientService";

// Drive the broker handshake on a freshly-constructed FakePeer: open the
// Peer (which triggers resolveAndConnect → the directory resolve), let the
// async resolve settle, then open the resulting host data connection.
async function driveOpen(peer: InstanceType<typeof FakePeer>) {
  peer.emit("open");
  // Let the resolveAndConnect microtask chain settle so peer.connect(host)
  // has run before callers read _lastConnectTarget / drive the conn open.
  await vi.waitFor(() => expect(peer._lastConn).not.toBeNull());
  peer._lastConn?.emit("open");
}

describe("PeerClientService — relay share-code resolution", () => {
  beforeEach(() => {
    FakePeer.instances = [];
  });

  it("resolves the share-code to a peer id (post-open) before connecting to the host", async () => {
    const resolveHost = vi.fn(async (_code: string) => "PEER-RESOLVED");
    const svc = new PeerClientService({ resolveHost });

    svc.connect("SHARE");

    // The Peer is constructed up front — the directory resolve needs an
    // open Peer to reach the broker, so resolution happens inside the
    // Peer's open handler, not before construction.
    expect(FakePeer.instances).toHaveLength(1);

    await driveOpen(FakePeer.instances[0]);

    expect(resolveHost).toHaveBeenCalledWith(
      "SHARE",
      expect.any(Object), // the station's open Peer is handed to the resolver
    );
    expect(FakePeer.instances[0]._lastConnectTarget).toBe("PEER-RESOLVED");
  });

  it("falls back to the typed value as a direct peer id when resolution returns null (relay/directory down or not-found)", async () => {
    const resolveHost = vi.fn(async (_code: string) => null);
    const svc = new PeerClientService({ resolveHost });

    svc.connect("DIRECT");
    await driveOpen(FakePeer.instances[0]);

    // No prior hostPeerId → the raw typed value is used directly.
    expect(FakePeer.instances[0]._lastConnectTarget).toBe("DIRECT");
  });

  it("with no resolver, connect stays synchronous and uses the typed value verbatim", () => {
    const svc = new PeerClientService();
    svc.connect("HOST");
    // Synchronous fast-path — Peer constructed in the same tick.
    expect(FakePeer.instances).toHaveLength(1);
    FakePeer.instances[0].emit("open");
    // No resolver → connect runs synchronously inside the open handler.
    expect(FakePeer.instances[0]._lastConnectTarget).toBe("HOST");
  });

  it("re-resolves the share-code on each reconnect (auto-follows host rotation)", async () => {
    let current = "PEER-A";
    const resolveHost = vi.fn(async (_code: string) => current);
    const svc = new PeerClientService({
      resolveHost,
      retryIntervalMs: 50,
      retryTimeoutMs: 60_000,
    });

    svc.connect("SHARE");
    await driveOpen(FakePeer.instances[0]);
    expect(FakePeer.instances[0]._lastConnectTarget).toBe("PEER-A");

    // Host rotates its peer id; the relay's directory now resolves the same
    // share-code to a fresh id. The station knows nothing yet — it just
    // sees its conn drop.
    current = "PEER-B";
    FakePeer.instances[0]._lastConn?.emit("close");

    // Retry timer fires → re-open Peer → re-resolve → connect to NEW id.
    await vi.waitFor(() => expect(FakePeer.instances).toHaveLength(2));
    await driveOpen(FakePeer.instances[1]);

    expect(resolveHost).toHaveBeenCalledTimes(2);
    expect(FakePeer.instances[1]._lastConnectTarget).toBe("PEER-B");
  });

  it("on reconnect, a failed re-resolve falls back to the last-known peer id (live-rotation fast path survives relay outage)", async () => {
    // First resolve succeeds; the reconnect resolve fails (relay went down).
    const resolveHost = vi
      .fn<(code: string) => Promise<string | null>>()
      .mockResolvedValueOnce("PEER-A")
      .mockResolvedValueOnce(null);
    const svc = new PeerClientService({
      resolveHost,
      retryIntervalMs: 50,
      retryTimeoutMs: 60_000,
    });

    svc.connect("SHARE");
    await driveOpen(FakePeer.instances[0]);
    expect(FakePeer.instances[0]._lastConnectTarget).toBe("PEER-A");

    FakePeer.instances[0]._lastConn?.emit("close");
    await vi.waitFor(() => expect(FakePeer.instances).toHaveLength(2));
    await driveOpen(FakePeer.instances[1]);

    // Relay couldn't resolve, but we still know PEER-A from last time —
    // retry against it rather than the raw share-code.
    expect(FakePeer.instances[1]._lastConnectTarget).toBe("PEER-A");
  });

  it("a host-id-rotation broadcast is honoured as the relay-down fallback target on the next reconnect", async () => {
    // Resolve succeeds initially, then fails on reconnect — but the host
    // had time to broadcast a rotation over the live channel first.
    const resolveHost = vi
      .fn<(code: string) => Promise<string | null>>()
      .mockResolvedValueOnce("PEER-A")
      .mockResolvedValue(null);
    const svc = new PeerClientService({
      resolveHost,
      retryIntervalMs: 50,
      retryTimeoutMs: 60_000,
    });

    svc.connect("SHARE");
    await driveOpen(FakePeer.instances[0]);

    // Host announces a graceful rotation over the live data channel.
    (svc as unknown as { handleMessage(msg: unknown): void }).handleMessage({
      type: "host-id-rotation",
      newPeerId: "PEER-ROTATED",
      reason: "unavailable-id-recovery",
    });

    // Channel then drops; relay resolve now fails → fall back to the
    // rotation target the broadcast set, not the raw share-code.
    FakePeer.instances[0]._lastConn?.emit("close");
    await vi.waitFor(() => expect(FakePeer.instances).toHaveLength(2));
    await driveOpen(FakePeer.instances[1]);
    expect(FakePeer.instances[1]._lastConnectTarget).toBe("PEER-ROTATED");
  });
});

describe("PeerClientService — rotation→re-resolve→reconnect integration", () => {
  beforeEach(() => {
    FakePeer.instances = [];
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // End-to-end of the feature's value: the share-code never changes, the
  // host's peer id rotates twice, and the station follows each rotation
  // purely by re-resolving the (unchanged) share-code on reconnect.
  it("follows two consecutive host rotations via the stable share-code", async () => {
    const ids = ["PEER-1", "PEER-2", "PEER-3"];
    let idx = 0;
    const resolveHost = vi.fn(async (code: string) => {
      expect(code).toBe("STABLE-CODE"); // share-code never changes
      return ids[idx];
    });
    const svc = new PeerClientService({
      resolveHost,
      retryIntervalMs: 50,
      retryTimeoutMs: 60_000,
    });

    svc.connect("STABLE-CODE");
    await driveOpen(FakePeer.instances[0]);
    expect(FakePeer.instances[0]._lastConnectTarget).toBe("PEER-1");

    for (const [i, expected] of ["PEER-2", "PEER-3"].entries()) {
      idx += 1;
      const expectedCount = i + 2; // started at 1, one more Peer per rotation
      FakePeer.instances.at(-1)?._lastConn?.emit("close");
      // Retry timer fires → a fresh Peer is constructed. Wait for it, then
      // drive its open (which re-resolves + reconnects).
      await vi.waitFor(() =>
        expect(FakePeer.instances).toHaveLength(expectedCount),
      );
      await driveOpen(
        FakePeer.instances.at(-1) as InstanceType<typeof FakePeer>,
      );
      expect(FakePeer.instances.at(-1)?._lastConnectTarget).toBe(expected);
    }

    expect(resolveHost).toHaveBeenCalledTimes(3);
  });
});

describe("resolveHostPeerId (broker directory resolver)", () => {
  // A minimal fake Peer whose connect() returns a controllable connection,
  // so we can drive the directory round-trip without a real broker.
  class FakeConn {
    private listeners = new Map<string, Array<(...a: unknown[]) => void>>();
    sent: unknown[] = [];
    closed = false;
    on(event: string, cb: (...a: unknown[]) => void) {
      const b = this.listeners.get(event) ?? [];
      b.push(cb);
      this.listeners.set(event, b);
    }
    emit(event: string, ...a: unknown[]) {
      this.listeners.get(event)?.forEach((cb) => {
        cb(...a);
      });
    }
    send(msg: unknown) {
      this.sent.push(msg);
    }
    close() {
      this.closed = true;
    }
  }
  class FakeStationPeer {
    lastConn: FakeConn | null = null;
    lastTarget: string | null = null;
    connectReturnsNull = false;
    connect(id: string) {
      this.lastTarget = id;
      if (this.connectReturnsNull) return undefined as never;
      this.lastConn = new FakeConn();
      return this.lastConn as never;
    }
  }

  it("opens a directory connection to gonogo-dir-<code>, sends resolve, returns the host peerId", async () => {
    const peer = new FakeStationPeer();
    const promise = resolveHostPeerId("SHARE", peer as never);
    expect(peer.lastTarget).toBe("gonogo-dir-SHARE");
    // Channel opens → station sends the resolve request.
    peer.lastConn?.emit("open");
    expect(peer.lastConn?.sent).toEqual([{ type: "resolve" }]);
    // Directory replies with the host id.
    peer.lastConn?.emit("data", { type: "host", peerId: "PEER-XYZ" });
    expect(await promise).toBe("PEER-XYZ");
    // One-shot — the lookup connection is closed after the reply.
    expect(peer.lastConn?.closed).toBe(true);
  });

  it("returns null when the directory replies not-found", async () => {
    const peer = new FakeStationPeer();
    const promise = resolveHostPeerId("UNKNOWN", peer as never);
    peer.lastConn?.emit("open");
    peer.lastConn?.emit("data", { type: "not-found" });
    expect(await promise).toBeNull();
  });

  it("returns null when the directory connection errors (peer not on broker)", async () => {
    const peer = new FakeStationPeer();
    const promise = resolveHostPeerId("SHARE", peer as never);
    peer.lastConn?.emit("error", new Error("peer-unavailable"));
    expect(await promise).toBeNull();
  });

  it("returns null when the directory connection closes before replying", async () => {
    const peer = new FakeStationPeer();
    const promise = resolveHostPeerId("SHARE", peer as never);
    peer.lastConn?.emit("close");
    expect(await promise).toBeNull();
  });

  it("returns null when peer.connect can't open a connection (broker session down)", async () => {
    const peer = new FakeStationPeer();
    peer.connectReturnsNull = true;
    expect(await resolveHostPeerId("SHARE", peer as never)).toBeNull();
  });
});
