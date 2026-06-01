import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mirror the hoisted FakePeer pattern from peer-client-service.test.ts so
// these tests can drive the broker handshake + read the connect target.
const { FakePeer } = vi.hoisted(() => {
  class FakeDataConnection {
    private listeners = new Map<string, Array<(...args: unknown[]) => void>>();
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
    send(_msg: unknown) {}
  }

  class FakePeer {
    static instances: FakePeer[] = [];
    private listeners = new Map<string, Array<(...args: unknown[]) => void>>();
    _lastConn: FakeDataConnection | null = null;
    _lastConnectTarget: string | null = null;

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
      const conn = new FakeDataConnection();
      this._lastConn = conn;
      this._lastConnectTarget = id;
      return conn;
    }
    destroy() {}
  }

  return { FakePeer };
});

vi.mock("peerjs", () => ({ default: FakePeer }));

import { resolveHostPeerId } from "../peer/iceServers";
import { PeerClientService } from "../peer/PeerClientService";

// Drive the broker handshake on a freshly-constructed FakePeer.
function driveOpen(peer: InstanceType<typeof FakePeer>) {
  peer.emit("open");
  peer._lastConn?.emit("open");
}

describe("PeerClientService — relay share-code resolution", () => {
  beforeEach(() => {
    FakePeer.instances = [];
  });

  it("resolves the share-code to a peer id before connecting", async () => {
    const resolveHost = vi.fn(async (_code: string) => "PEER-RESOLVED");
    const svc = new PeerClientService({ resolveHost });

    svc.connect("SHARE");

    // The Peer isn't constructed until the async resolve lands.
    expect(FakePeer.instances).toHaveLength(0);
    await vi.waitFor(() => expect(FakePeer.instances).toHaveLength(1));

    expect(resolveHost).toHaveBeenCalledWith("SHARE");
    driveOpen(FakePeer.instances[0]);
    expect(FakePeer.instances[0]._lastConnectTarget).toBe("PEER-RESOLVED");
  });

  it("falls back to the typed value as a direct peer id when resolution returns null (relay down / 404)", async () => {
    const resolveHost = vi.fn(async (_code: string) => null);
    const svc = new PeerClientService({ resolveHost });

    svc.connect("DIRECT");
    await vi.waitFor(() => expect(FakePeer.instances).toHaveLength(1));

    driveOpen(FakePeer.instances[0]);
    // No prior hostPeerId → the raw typed value is used directly.
    expect(FakePeer.instances[0]._lastConnectTarget).toBe("DIRECT");
  });

  it("with no resolver, connect stays synchronous and uses the typed value verbatim", () => {
    const svc = new PeerClientService();
    svc.connect("HOST");
    // Synchronous fast-path — Peer constructed in the same tick.
    expect(FakePeer.instances).toHaveLength(1);
    driveOpen(FakePeer.instances[0]);
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
    await vi.waitFor(() => expect(FakePeer.instances).toHaveLength(1));
    driveOpen(FakePeer.instances[0]);
    expect(FakePeer.instances[0]._lastConnectTarget).toBe("PEER-A");

    // Host rotates its peer id; the relay now resolves the same share-code
    // to a fresh id. The station knows nothing yet — it just sees its conn
    // drop.
    current = "PEER-B";
    FakePeer.instances[0]._lastConn?.emit("close");

    // Retry timer fires → re-resolve → reconnect to the NEW peer id.
    await vi.waitFor(() => expect(FakePeer.instances).toHaveLength(2));
    driveOpen(FakePeer.instances[1]);

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
    await vi.waitFor(() => expect(FakePeer.instances).toHaveLength(1));
    driveOpen(FakePeer.instances[0]);
    expect(FakePeer.instances[0]._lastConnectTarget).toBe("PEER-A");

    FakePeer.instances[0]._lastConn?.emit("close");
    await vi.waitFor(() => expect(FakePeer.instances).toHaveLength(2));
    driveOpen(FakePeer.instances[1]);

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
    await vi.waitFor(() => expect(FakePeer.instances).toHaveLength(1));
    driveOpen(FakePeer.instances[0]);

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
    driveOpen(FakePeer.instances[1]);
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
    await vi.waitFor(() => expect(FakePeer.instances).toHaveLength(1));
    driveOpen(FakePeer.instances[0]);
    expect(FakePeer.instances[0]._lastConnectTarget).toBe("PEER-1");

    for (const [i, expected] of ["PEER-2", "PEER-3"].entries()) {
      idx += 1;
      const expectedCount = i + 2; // started at 1, one more Peer per rotation
      FakePeer.instances.at(-1)?._lastConn?.emit("close");
      // Retry timer fires → re-resolve → a fresh Peer is constructed. Wait
      // for it, drive its handshake, *then* assert the connect target (the
      // target is only set once the open handler runs peer.connect()).
      await vi.waitFor(() =>
        expect(FakePeer.instances).toHaveLength(expectedCount),
      );
      driveOpen(FakePeer.instances.at(-1) as InstanceType<typeof FakePeer>);
      expect(FakePeer.instances.at(-1)?._lastConnectTarget).toBe(expected);
    }

    expect(resolveHost).toHaveBeenCalledTimes(3);
  });
});

describe("resolveHostPeerId (production relay resolver)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns the peer id from a 200 /host/:code response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ peerId: "PEER-XYZ" }), { status: 200 }),
      ),
    );
    expect(await resolveHostPeerId("SHARE")).toBe("PEER-XYZ");
  });

  it("returns null on a 404 (relay doesn't know the code)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("not found", { status: 404 })),
    );
    expect(await resolveHostPeerId("UNKNOWN")).toBeNull();
  });

  it("returns null when the relay is unreachable (fetch rejects)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("ECONNREFUSED");
      }),
    );
    expect(await resolveHostPeerId("SHARE")).toBeNull();
  });
});
