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

import { deriveHostPeerId } from "../peer/hostPeerId";
import { PeerClientService } from "../peer/PeerClientService";

// Drive the broker handshake on a freshly-constructed FakePeer: open the
// Peer (which connects straight to the derived host id), then open the
// resulting host data connection.
async function driveOpen(peer: InstanceType<typeof FakePeer>) {
  peer.emit("open", peer.id);
  await vi.waitFor(() => expect(peer._lastConn).not.toBeNull());
  peer._lastConn?.emit("open");
}

describe("PeerClientService: stable host id (derived connect target)", () => {
  beforeEach(() => {
    FakePeer.instances = [];
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("connects directly to the derived gonogo-host-<code> id", async () => {
    const svc = new PeerClientService();
    svc.connect("SHARE");

    // The Peer is constructed up front; the host target is known synchronously from the code: no resolve hop.
    expect(FakePeer.instances).toHaveLength(1);

    await driveOpen(FakePeer.instances[0]);

    expect(FakePeer.instances[0]._lastConnectTarget).toBe(
      deriveHostPeerId("SHARE"),
    );
    expect(FakePeer.instances[0]._lastConnectTarget).toBe("gonogo-host-SHARE");
  });

  it("uppercases the operator code before deriving the target", async () => {
    const svc = new PeerClientService();
    svc.connect("ab3k");
    await driveOpen(FakePeer.instances[0]);
    // Host codes are uppercase + prefix is lowercase; both ends must derive the same id, so the code is normalised to uppercase first.
    expect(FakePeer.instances[0]._lastConnectTarget).toBe("gonogo-host-AB3K");
  });

  it("passes through a value that already carries the prefix (idempotent derive)", async () => {
    // A ?host= URL minted by an older build (or a test harness) may carry the full derived id: it must not get double-prefixed.
    const svc = new PeerClientService();
    svc.connect("gonogo-host-XK3F");
    await driveOpen(FakePeer.instances[0]);
    expect(FakePeer.instances[0]._lastConnectTarget).toBe("gonogo-host-XK3F");
  });

  it("re-derives the SAME id on each reconnect (host refresh re-claims it)", async () => {
    const svc = new PeerClientService({
      retryIntervalMs: 50,
      retryTimeoutMs: 60_000,
    });

    svc.connect("STABLE");
    await driveOpen(FakePeer.instances[0]);
    expect(FakePeer.instances[0]._lastConnectTarget).toBe("gonogo-host-STABLE");

    // Host refreshes; its conn drops. The station's retry loop re-opens a
    // fresh Peer and re-derives the same target, no rotation, no resolve.
    FakePeer.instances[0]._lastConn?.emit("close");
    await vi.waitFor(() => expect(FakePeer.instances).toHaveLength(2));
    await driveOpen(FakePeer.instances[1]);

    expect(FakePeer.instances[1]._lastConnectTarget).toBe("gonogo-host-STABLE");
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

describe("PeerClientService: relay servers for media connections", () => {
  const relay = [
    {
      urls: ["turn:203.0.113.1:3478?transport=udp"],
      username: "u",
      credential: "c",
    },
  ];

  function pairStats(local: string, remote: string) {
    const entries: Array<Record<string, unknown>> = [
      { id: "T", type: "transport", selectedCandidatePairId: "P" },
      {
        id: "P",
        type: "candidate-pair",
        localCandidateId: "L",
        remoteCandidateId: "R",
      },
      { id: "L", type: "local-candidate", candidateType: local },
      { id: "R", type: "remote-candidate", candidateType: remote },
    ];
    return {
      getStats: async () => ({
        forEach: (cb: (s: Record<string, unknown>) => void) =>
          entries.forEach(cb),
      }),
    };
  }

  async function station(local: string, remote: string) {
    FakePeer.instances = [];
    const svc = new PeerClientService();
    svc.connect("SHARE");
    const peer = FakePeer.instances[0];
    peer.emit("open", peer.id);
    await vi.waitFor(() => expect(peer._lastConn).not.toBeNull());
    const conn = peer._lastConn;
    if (!conn) throw new Error("no host connection");
    conn.peerConnection = pairStats(local, remote);
    conn.emit("open");
    conn.emit("data", { type: "relay-ice-servers", iceServers: relay });
    return svc;
  }

  it("withholds them from a station connected directly, so its cameras allocate no relay port", async () => {
    const svc = await station("host", "host");
    await new Promise((r) => setTimeout(r, 0));
    expect(svc.getRelayIceServers()).toEqual([]);
    svc.disconnect();
  });

  it("hands them over once the station's own connection is carried by the relay", async () => {
    const svc = await station("relay", "srflx");
    await vi.waitFor(() => expect(svc.getRelayIceServers()).toEqual(relay));
    svc.disconnect();
  });
});
