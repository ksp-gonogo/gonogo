import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mirror the hoisted FakePeer pattern from peer-client-service.test.ts so
// these tests can drive the broker handshake + read the connect target.
// The FakePeer echoes the *constructed* id on open so we can assert which
// derived host id the station targets.
const { FakePeer } = vi.hoisted(() => {
  class FakeDataConnection {
    private listeners = new Map<string, Array<(...args: unknown[]) => void>>();
    sent: unknown[] = [];
    target: string;
    peerConnection?: unknown;
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
    id: string;
    private listeners = new Map<string, Array<(...args: unknown[]) => void>>();
    _lastConn: FakeDataConnection | null = null;
    _lastConnectTarget: string | null = null;
    _conns: FakeDataConnection[] = [];

    constructor(id?: string) {
      this.id = id ?? "";
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
    destroyed = false;
    destroy() {
      this.destroyed = true;
    }
  }

  return { FakePeer };
});

vi.mock("peerjs", () => ({ default: FakePeer }));

import { deriveHostPeerIds } from "../peer/hostPeerId";
import { PeerClientService } from "../peer/PeerClientService";

// Drive the broker handshake on a freshly-constructed FakePeer: open the
// Peer (which connects straight to every id of the host's ring), then open
// the data connection of one slot.
async function driveOpen(peer: InstanceType<typeof FakePeer>, slot = 0) {
  peer.emit("open", peer.id);
  await vi.waitFor(() => expect(peer._conns).toHaveLength(4));
  peer._conns[slot]?.emit("open");
}

describe("PeerClientService: stable host id (derived connect target)", () => {
  beforeEach(() => {
    FakePeer.instances = [];
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("connects directly to every gonogo-host-<code>-<slot> id of the ring", async () => {
    const svc = new PeerClientService();
    svc.connect("SHARE");

    // The Peer is constructed up front; the host targets are known synchronously from the code: no resolve hop.
    expect(FakePeer.instances).toHaveLength(1);

    await driveOpen(FakePeer.instances[0]);

    expect(FakePeer.instances[0]._conns.map((c) => c.target)).toEqual(
      deriveHostPeerIds("SHARE"),
    );
    expect(FakePeer.instances[0]._conns.map((c) => c.target)).toEqual([
      "gonogo-host-SHARE-0",
      "gonogo-host-SHARE-1",
      "gonogo-host-SHARE-2",
      "gonogo-host-SHARE-3",
    ]);
  });

  it("uppercases the operator code before deriving the targets", async () => {
    const svc = new PeerClientService();
    svc.connect("ab3k");
    await driveOpen(FakePeer.instances[0]);
    // Host codes are uppercase + prefix is lowercase; both ends must derive the same ids, so the code is normalised to uppercase first.
    expect(FakePeer.instances[0]._conns[0].target).toBe("gonogo-host-AB3K-0");
  });

  it("re-derives the SAME ring on each reconnect (a replacement host takes one of its slots)", async () => {
    const svc = new PeerClientService({
      retryIntervalMs: 50,
      retryTimeoutMs: 60_000,
    });

    svc.connect("STABLE");
    await driveOpen(FakePeer.instances[0], 2);
    expect(FakePeer.instances[0]._conns[2].target).toBe("gonogo-host-STABLE-2");

    // Host refreshes; its conn drops. The station's retry loop re-opens a
    // fresh Peer and re-derives the same targets, no rotation, no resolve.
    FakePeer.instances[0]._conns[2]?.emit("close");
    await vi.waitFor(() => expect(FakePeer.instances).toHaveLength(2));
    await driveOpen(FakePeer.instances[1], 3);

    expect(FakePeer.instances[1]._conns.map((c) => c.target)).toEqual(
      deriveHostPeerIds("STABLE"),
    );
  });
});

describe("PeerClientService: page unload", () => {
  beforeEach(() => {
    FakePeer.instances = [];
  });

  it("destroys the Peer on pagehide so its relay allocations are released", async () => {
    const svc = new PeerClientService();
    svc.connect("SHARE");
    await driveOpen(FakePeer.instances[0]);

    window.dispatchEvent(new Event("pagehide"));

    expect(FakePeer.instances[0].destroyed).toBe(true);
    svc.disconnect();
  });

  it("stops listening for pagehide once disconnected", async () => {
    const svc = new PeerClientService();
    svc.connect("SHARE");
    svc.disconnect();
    FakePeer.instances[0].destroyed = false;

    window.dispatchEvent(new Event("pagehide"));

    expect(FakePeer.instances[0].destroyed).toBe(false);
  });
});
