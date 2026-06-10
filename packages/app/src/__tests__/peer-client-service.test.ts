import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// vi.mock is hoisted to the top of the file, so FakePeer / FakeDataConnection
// must be declared via vi.hoisted to be available when the factory runs.
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

  return { FakePeer, FakeDataConnection };
});

vi.mock("peerjs", () => ({ default: FakePeer }));

import type { ConnStatus } from "../peer/PeerClientService";
import { PeerClientService } from "../peer/PeerClientService";
import type { PeerMessage } from "../peer/protocol";

// The handleMessage logic is private. To drive it from the outside we reach in
// via a typed cast — these tests verify the observable contract (listeners fire
// with the right payload) not the internal shape.
interface PeerClientServiceInternal {
  handleMessage(msg: PeerMessage): void;
}

describe("PeerClientService", () => {
  it("onSchema unsub removes the listener", () => {
    const svc = new PeerClientService();
    const received: unknown[] = [];
    const unsub = svc.onSchema((sources) => {
      received.push(sources);
    });
    expect(svc._listenerCounts().schema).toBe(1);

    unsub();
    expect(svc._listenerCounts().schema).toBe(0);

    // After unsub, a schema message should not reach the callback
    (svc as unknown as PeerClientServiceInternal).handleMessage({
      type: "schema",
      sources: [
        {
          id: "telemachus",
          name: "T",
          keys: [{ key: "v.altitude", label: "Altitude" }],
        },
      ],
    });
    expect(received).toEqual([]);
  });

  it("onData unsub removes the listener", () => {
    const svc = new PeerClientService();
    const hits: Array<[string, string, unknown]> = [];
    const unsub = svc.onData((sourceId, key, value) => {
      hits.push([sourceId, key, value]);
    });

    (svc as unknown as PeerClientServiceInternal).handleMessage({
      type: "data",
      sourceId: "telemachus",
      key: "v.altitude",
      value: 42,
    });
    expect(hits).toEqual([["telemachus", "v.altitude", 42]]);

    unsub();
    (svc as unknown as PeerClientServiceInternal).handleMessage({
      type: "data",
      sourceId: "telemachus",
      key: "v.altitude",
      value: 99,
    });
    expect(hits).toHaveLength(1);
  });

  it("handleMessage dispatches each peer message type to the right listener set", () => {
    const svc = new PeerClientService();
    const calls: string[] = [];
    svc.onData(() => calls.push("data"));
    svc.onSourceStatus(() => calls.push("source-status"));
    svc.onSchema(() => calls.push("schema"));
    svc.onKosOpened(() => calls.push("kos-opened"));
    svc.onKosData(() => calls.push("kos-data"));
    svc.onKosClose(() => calls.push("kos-close"));

    const inner = svc as unknown as PeerClientServiceInternal;
    inner.handleMessage({
      type: "data",
      sourceId: "s",
      key: "k",
      value: 1,
    });
    inner.handleMessage({ type: "status", sourceId: "s", status: "connected" });
    inner.handleMessage({ type: "schema", sources: [] });
    inner.handleMessage({ type: "kos-opened", sessionId: "x" });
    inner.handleMessage({ type: "kos-data", sessionId: "x", data: "hi" });
    inner.handleMessage({ type: "kos-close", sessionId: "x" });

    expect(calls).toEqual([
      "data",
      "source-status",
      "schema",
      "kos-opened",
      "kos-data",
      "kos-close",
    ]);
  });

  it("captures hello and exposes it via getHostVersion + onHostHello", () => {
    const svc = new PeerClientService();
    const observed: Array<{ version: string; buildTime: string }> = [];
    svc.onHostHello((info) => observed.push(info));

    expect(svc.getHostVersion()).toBeNull();

    (svc as unknown as PeerClientServiceInternal).handleMessage({
      type: "hello",
      version: "1.2.3",
      buildTime: "2026-04-25T00:00:00.000Z",
    });

    expect(svc.getHostVersion()).toEqual({
      version: "1.2.3",
      buildTime: "2026-04-25T00:00:00.000Z",
    });
    expect(observed).toEqual([
      { version: "1.2.3", buildTime: "2026-04-25T00:00:00.000Z" },
    ]);
  });

  it("fires onHostRestart only when the host's sessionToken changes between hellos", () => {
    const svc = new PeerClientService();
    const inner = svc as unknown as PeerClientServiceInternal;
    const restarts: number[] = [];
    let restartCount = 0;
    svc.onHostRestart(() => {
      restartCount += 1;
      restarts.push(restartCount);
    });

    // First hello — establishes the baseline token. Should NOT fire
    // restart (there's nothing to compare against).
    inner.handleMessage({
      type: "hello",
      version: "1.0.0",
      buildTime: "2026-05-08T00:00:00.000Z",
      sessionToken: "session-A",
    });
    expect(restarts).toEqual([]);

    // Same token again (transient broker reconnect to the same host
    // process) — must NOT fire restart.
    inner.handleMessage({
      type: "hello",
      version: "1.0.0",
      buildTime: "2026-05-08T00:00:00.000Z",
      sessionToken: "session-A",
    });
    expect(restarts).toEqual([]);

    // Fresh token (host was refreshed) — restart fires.
    inner.handleMessage({
      type: "hello",
      version: "1.0.0",
      buildTime: "2026-05-08T00:00:00.000Z",
      sessionToken: "session-B",
    });
    expect(restarts).toEqual([1]);

    // Tokenless hello (legacy host) — must NOT fire restart, even though
    // the token "changed" to undefined.
    inner.handleMessage({
      type: "hello",
      version: "1.0.0",
      buildTime: "2026-05-08T00:00:00.000Z",
    });
    expect(restarts).toEqual([1]);
  });

  it("_listenerCounts reports per-event-type sizes", () => {
    const svc = new PeerClientService();
    svc.onData(() => {});
    svc.onData(() => {});
    svc.onSchema(() => {});
    svc.onKosData(() => {});
    expect(svc._listenerCounts()).toEqual({
      data: 2,
      sourceStatus: 0,
      connStatus: 0,
      schema: 1,
      kosOpened: 0,
      kosData: 1,
      kosClose: 0,
      fogSnapshot: 0,
    });
  });
});

// ---------------------------------------------------------------------------
// Reconnect loop — drives lifecycle via the hoisted FakePeer / FakeDataConnection.
// ---------------------------------------------------------------------------

describe("PeerClientService reconnect loop", () => {
  beforeEach(() => {
    FakePeer.instances = [];
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function driveOpen(peer: InstanceType<typeof FakePeer>) {
    peer.emit("open");
    peer._lastConn?.emit("open");
  }

  it("fires reconnecting → connected when the conn drops and peer is recreated", () => {
    const svc = new PeerClientService({
      retryIntervalMs: 50,
      retryTimeoutMs: 60_000,
    });
    const statuses: ConnStatus[] = [];
    svc.onConnectionStatus((s) => statuses.push(s));

    svc.connect("HOST");
    expect(FakePeer.instances).toHaveLength(1);
    driveOpen(FakePeer.instances[0]);

    // Drop the conn — should schedule a retry
    FakePeer.instances[0]._lastConn?.emit("close");
    expect(statuses).toContain("reconnecting");
    expect(FakePeer.instances).toHaveLength(1); // retry hasn't fired yet

    vi.advanceTimersByTime(50);
    expect(FakePeer.instances).toHaveLength(2);

    driveOpen(FakePeer.instances[1]);
    // Final status sequence should contain the full cycle
    expect(statuses.filter((s) => s === "connected")).toHaveLength(2);
  });

  it("gives up with disconnected after exceeding the retry timeout", () => {
    const svc = new PeerClientService({
      retryIntervalMs: 10,
      retryTimeoutMs: 100,
    });
    const statuses: ConnStatus[] = [];
    svc.onConnectionStatus((s) => statuses.push(s));

    svc.connect("HOST");
    driveOpen(FakePeer.instances[0]);

    // Simulate repeated failed reconnects by firing close on each new peer's
    // conn (or peer error) after the retry timer fires.
    for (let i = 0; i < 20; i++) {
      FakePeer.instances[FakePeer.instances.length - 1]?.emit(
        "error",
        new Error("fail"),
      );
      vi.advanceTimersByTime(11);
      if (statuses.includes("disconnected")) break;
    }

    expect(statuses).toContain("disconnected");
  });

  it("ignores peer-unavailable for an auxiliary peer (e.g. OCISLY) without tearing down host conn", () => {
    const svc = new PeerClientService({
      retryIntervalMs: 50,
      retryTimeoutMs: 60_000,
    });
    const statuses: ConnStatus[] = [];
    svc.onConnectionStatus((s) => statuses.push(s));

    svc.connect("Z6HK");
    driveOpen(FakePeer.instances[0]);
    expect(statuses).toContain("connected");

    // Auxiliary peer.connect() to a missing peer fires peer-unavailable on
    // the shared Peer with the missing peer id in the message — must not
    // tear down the host conn.
    const err = Object.assign(
      new Error("Could not connect to peer ocisly-relay-xyz"),
      { type: "peer-unavailable" },
    );
    FakePeer.instances[0].emit("error", err);

    expect(statuses).not.toContain("reconnecting");
    expect(FakePeer.instances).toHaveLength(1);
  });

  it("does not false-positive when the host id is a substring of the missing peer id", () => {
    const svc = new PeerClientService({
      retryIntervalMs: 50,
      retryTimeoutMs: 60_000,
    });
    const statuses: ConnStatus[] = [];
    svc.onConnectionStatus((s) => statuses.push(s));

    svc.connect("Z6HK");
    driveOpen(FakePeer.instances[0]);

    const err = Object.assign(
      new Error("Could not connect to peer station-Z6HK-foo"),
      { type: "peer-unavailable" },
    );
    FakePeer.instances[0].emit("error", err);

    expect(statuses).not.toContain("reconnecting");
    expect(FakePeer.instances).toHaveLength(1);
  });

  it("treats peer-unavailable for the exact host id as a real outage and retries", () => {
    const svc = new PeerClientService({
      retryIntervalMs: 50,
      retryTimeoutMs: 60_000,
    });
    const statuses: ConnStatus[] = [];
    svc.onConnectionStatus((s) => statuses.push(s));

    svc.connect("Z6HK");
    // Don't open — simulate a fresh attempt where the host id isn't on the
    // broker. The connect target is the DERIVED id (`gonogo-host-Z6HK`), so
    // that's what peerjs reports as missing.
    const err = Object.assign(
      new Error("Could not connect to peer gonogo-host-Z6HK"),
      { type: "peer-unavailable" },
    );
    FakePeer.instances[0].emit("error", err);

    expect(statuses).toContain("reconnecting");
    vi.advanceTimersByTime(50);
    expect(FakePeer.instances).toHaveLength(2);
  });

  it("disconnect() stops any pending retry", () => {
    const svc = new PeerClientService({
      retryIntervalMs: 50,
      retryTimeoutMs: 60_000,
    });
    svc.connect("HOST");
    driveOpen(FakePeer.instances[0]);

    FakePeer.instances[0]._lastConn?.emit("close");
    // Retry is scheduled but not yet fired
    svc.disconnect();

    vi.advanceTimersByTime(1000);
    // No new FakePeer should be constructed after disconnect
    expect(FakePeer.instances).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// queryRange — request/response round-trip + lifetime cleanup
// ---------------------------------------------------------------------------

describe("PeerClientService.sendQueryRange", () => {
  beforeEach(() => {
    FakePeer.instances = [];
  });

  function connectedSvc() {
    const svc = new PeerClientService();
    svc.connect("HOST");
    const peer = FakePeer.instances[0];
    peer.emit("open");
    peer._lastConn?.emit("open");
    return { svc, peer };
  }

  it("rejects if called before the conn is open", async () => {
    const svc = new PeerClientService();
    await expect(
      svc.sendQueryRange("data", "v.altitude", 0, 1_000),
    ).rejects.toThrow(/not connected/);
  });

  it("resolves when a matching query-range-response arrives", async () => {
    const { svc, peer } = connectedSvc();
    if (!peer._lastConn) throw new Error("expected an active peer connection");
    const conn = peer._lastConn;
    const sent: PeerMessage[] = [];
    conn.send = (msg: PeerMessage) => {
      sent.push(msg);
    };

    const pending = svc.sendQueryRange("data", "v.altitude", 0, 1_000);
    const first = sent[0];
    if (!first || first.type !== "query-range-request") {
      throw new Error("expected query-range-request");
    }

    (svc as unknown as PeerClientServiceInternal).handleMessage({
      type: "query-range-response",
      requestId: first.requestId,
      t: [100, 200],
      v: [1, 2],
    });

    await expect(pending).resolves.toEqual({ t: [100, 200], v: [1, 2] });
  });

  it("rejects when the host responds with an error", async () => {
    const { svc, peer } = connectedSvc();
    if (!peer._lastConn) throw new Error("expected an active peer connection");
    const conn = peer._lastConn;
    const sent: PeerMessage[] = [];
    conn.send = (msg: PeerMessage) => {
      sent.push(msg);
    };

    const pending = svc.sendQueryRange("data", "v.altitude", 0, 1_000);
    const first = sent[0];
    if (!first || first.type !== "query-range-request") {
      throw new Error("expected query-range-request");
    }

    (svc as unknown as PeerClientServiceInternal).handleMessage({
      type: "query-range-response",
      requestId: first.requestId,
      t: [],
      v: [],
      error: "source data has no queryRange",
    });

    await expect(pending).rejects.toThrow(/no queryRange/);
  });

  it("rejects pending queries when the connection drops", async () => {
    const { svc, peer } = connectedSvc();
    if (!peer._lastConn) throw new Error("expected an active peer connection");
    const conn = peer._lastConn;
    conn.send = () => {};

    const pending = svc.sendQueryRange("data", "v.altitude", 0, 1_000);
    conn.emit("close");

    await expect(pending).rejects.toThrow(/closed|disconnected/);
  });

  it("rejects pending queries on explicit disconnect()", async () => {
    const { svc, peer } = connectedSvc();
    if (!peer._lastConn) throw new Error("expected an active peer connection");
    const conn = peer._lastConn;
    conn.send = () => {};

    const pending = svc.sendQueryRange("data", "v.altitude", 0, 1_000);
    svc.disconnect();

    await expect(pending).rejects.toThrow(/disconnected/);
  });

  it("rejects with timeout when no response arrives within timeoutMs", async () => {
    vi.useFakeTimers();
    try {
      const svc = new PeerClientService();
      svc.connect("HOST");
      const peer = FakePeer.instances[0];
      peer.emit("open");
      peer._lastConn?.emit("open");
      if (!peer._lastConn)
        throw new Error("expected an active peer connection");
      peer._lastConn.send = () => {};

      const pending = svc
        .sendQueryRange("data", "v.altitude", 0, 1_000, undefined, 250)
        .catch((e: Error) => e);

      vi.advanceTimersByTime(250);
      const result = await pending;
      expect(result).toBeInstanceOf(Error);
      expect((result as Error).message).toMatch(/queryRange timeout/);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("PeerClientService.sendKerbcamNegotiate", () => {
  beforeEach(() => {
    FakePeer.instances = [];
  });

  function connectedSvc() {
    const svc = new PeerClientService();
    svc.connect("HOST");
    const peer = FakePeer.instances[0];
    peer.emit("open");
    peer._lastConn?.emit("open");
    return { svc, peer };
  }

  const OFFER = { sdp: "offer-sdp", cameras: [42], slots: 6 };

  it("rejects if called before the conn is open", async () => {
    const svc = new PeerClientService();
    await expect(svc.sendKerbcamNegotiate(OFFER)).rejects.toThrow(
      /not connected/,
    );
  });

  it("resolves with the answer when the host responds", async () => {
    const { svc, peer } = connectedSvc();
    if (!peer._lastConn) throw new Error("expected an active peer connection");
    const conn = peer._lastConn;
    const sent: PeerMessage[] = [];
    conn.send = (msg: PeerMessage) => {
      sent.push(msg);
    };

    const pending = svc.sendKerbcamNegotiate(OFFER);
    const first = sent[0];
    if (!first || first.type !== "kerbcam-negotiate-request") {
      throw new Error("expected kerbcam-negotiate-request");
    }
    expect(first.offer).toEqual(OFFER);

    (svc as unknown as PeerClientServiceInternal).handleMessage({
      type: "kerbcam-negotiate-response",
      requestId: first.requestId,
      answer: { sdp: "answer-sdp", cameras: [42] },
    });

    await expect(pending).resolves.toEqual({
      sdp: "answer-sdp",
      cameras: [42],
    });
  });

  it("rejects when the host returns an error", async () => {
    const { svc, peer } = connectedSvc();
    if (!peer._lastConn) throw new Error("expected an active peer connection");
    const conn = peer._lastConn;
    const sent: PeerMessage[] = [];
    conn.send = (msg: PeerMessage) => {
      sent.push(msg);
    };

    const pending = svc.sendKerbcamNegotiate(OFFER);
    const first = sent[0];
    if (!first || first.type !== "kerbcam-negotiate-request") {
      throw new Error("expected kerbcam-negotiate-request");
    }

    (svc as unknown as PeerClientServiceInternal).handleMessage({
      type: "kerbcam-negotiate-response",
      requestId: first.requestId,
      error: "kerbcam source unavailable on host",
    });

    await expect(pending).rejects.toThrow(/unavailable on host/);
  });
});

describe("PeerClientService.sendFlightRpc", () => {
  beforeEach(() => {
    FakePeer.instances = [];
  });

  function connectedSvc() {
    const svc = new PeerClientService();
    svc.connect("HOST");
    const peer = FakePeer.instances[0];
    peer.emit("open");
    peer._lastConn?.emit("open");
    return { svc, peer };
  }

  it("resolves with the host's result on a matching response", async () => {
    const { svc, peer } = connectedSvc();
    if (!peer._lastConn) throw new Error("expected an active peer connection");
    const conn = peer._lastConn;
    const sent: PeerMessage[] = [];
    conn.send = (msg: PeerMessage) => {
      sent.push(msg);
    };

    const pending = svc.sendFlightRpc({ op: "list" });
    const first = sent[0];
    if (!first || first.type !== "flight-rpc-request") {
      throw new Error("expected flight-rpc-request");
    }

    const result = [{ id: "f1", vesselName: "Hopper" }];
    (svc as unknown as PeerClientServiceInternal).handleMessage({
      type: "flight-rpc-response",
      requestId: first.requestId,
      result,
    });

    await expect(pending).resolves.toEqual(result);
  });

  it("rejects when the host returns an error", async () => {
    const { svc, peer } = connectedSvc();
    if (!peer._lastConn) throw new Error("expected an active peer connection");
    const conn = peer._lastConn;
    const sent: PeerMessage[] = [];
    conn.send = (msg: PeerMessage) => {
      sent.push(msg);
    };

    const pending = svc.sendFlightRpc({ op: "delete", id: "missing" });
    const first = sent[0];
    if (!first || first.type !== "flight-rpc-request") {
      throw new Error("expected flight-rpc-request");
    }

    (svc as unknown as PeerClientServiceInternal).handleMessage({
      type: "flight-rpc-response",
      requestId: first.requestId,
      error: "buffered data source not registered",
    });

    await expect(pending).rejects.toThrow(/buffered data source/);
  });

  it("rejects pending RPCs when the connection drops", async () => {
    const { svc, peer } = connectedSvc();
    if (!peer._lastConn) throw new Error("expected an active peer connection");
    peer._lastConn.send = () => {};

    const pending = svc.sendFlightRpc({ op: "list" });
    peer._lastConn.emit("close");

    await expect(pending).rejects.toThrow(/closed|disconnected/);
  });

  it("waits for connection if called before the conn is open, then sends", async () => {
    const svc = new PeerClientService();
    svc.connect("HOST");
    const peer = FakePeer.instances[0];

    // Kick off the RPC BEFORE peer.open / conn.open fire — this is the
    // FlightsManager-on-mount race that previously surfaced "not connected"
    // as an uncaught rejection.
    const pending = svc.sendFlightRpc({ op: "list" });

    // Flush any synchronous resolution paths.
    await Promise.resolve();

    // Now finish the handshake. sendFlightRpc should send + resolve.
    peer.emit("open");
    peer._lastConn?.emit("open");
    if (!peer._lastConn) throw new Error("expected an active peer connection");

    const sent: PeerMessage[] = [];
    peer._lastConn.send = (msg: PeerMessage) => {
      sent.push(msg);
    };

    // Wait for the queued send to flush, then locate the flight RPC.
    await new Promise((r) => setTimeout(r, 0));
    const req = sent.find((m) => m.type === "flight-rpc-request");
    if (!req || req.type !== "flight-rpc-request") {
      throw new Error("expected flight-rpc-request after connect");
    }

    (svc as unknown as PeerClientServiceInternal).handleMessage({
      type: "flight-rpc-response",
      requestId: req.requestId,
      result: [],
    });

    await expect(pending).resolves.toEqual([]);
  });

  it("flight-change pushes update getCurrentFlight + fire onFlightChange", () => {
    const { svc } = connectedSvc();
    const seen: Array<unknown> = [];
    svc.onFlightChange((f) => seen.push(f));
    expect(svc.getCurrentFlight()).toBeNull();

    const flight = {
      id: "f1",
      vesselName: "Hopper",
      launchedAt: 0,
      lastSampleAt: 1,
      lastMissionTime: 0,
      sampleCount: 1,
    };
    (svc as unknown as PeerClientServiceInternal).handleMessage({
      type: "flight-change",
      flight,
    });

    expect(svc.getCurrentFlight()).toEqual(flight);
    // onFlightChange fires once on subscribe with the cached snapshot, then
    // again on every push.
    expect(seen).toEqual([null, flight]);
  });
});

describe("PeerClientService.sendKosExecute", () => {
  beforeEach(() => {
    FakePeer.instances = [];
  });

  it("rejects with timeout when no response arrives within timeoutMs", async () => {
    vi.useFakeTimers();
    try {
      const svc = new PeerClientService();
      svc.connect("HOST");
      const peer = FakePeer.instances[0];
      peer.emit("open");
      peer._lastConn?.emit("open");
      if (!peer._lastConn)
        throw new Error("expected an active peer connection");
      // FakeDataConnection has no `open` field; force-set so sendKosExecute's
      // `conn.open === false` guard doesn't preempt the timeout path.
      (peer._lastConn as unknown as { open: boolean }).open = true;
      peer._lastConn.send = () => {};

      const pending = svc
        .sendKosExecute("cpu", "script", [], undefined, 100)
        .catch((e: Error) => e);

      vi.advanceTimersByTime(100);
      const result = await pending;
      expect(result).toBeInstanceOf(Error);
      expect((result as Error).message).toMatch(/kos execute timeout/);
    } finally {
      vi.useRealTimers();
    }
  });

  it("rejects pending kos executes when the connection drops", async () => {
    const svc = new PeerClientService();
    svc.connect("HOST");
    const peer = FakePeer.instances[0];
    peer.emit("open");
    peer._lastConn?.emit("open");
    if (!peer._lastConn) throw new Error("expected an active peer connection");
    (peer._lastConn as unknown as { open: boolean }).open = true;
    peer._lastConn.send = () => {};

    const pending = svc.sendKosExecute("cpu", "script", []);
    peer._lastConn.emit("close");

    await expect(pending).rejects.toThrow(/closed|disconnected/);
  });
});

// ---------------------------------------------------------------------------
// relay-peer-id: applying iceServers to the station's Peer — the
// 2026-05-17 evening session showed 200+ negotiation-failed events
// on station→relay because the station's Peer had empty iceServers
// (deliberate, see iceServers.ts) and couldn't reach the relay's
// container-bridge ICE candidates. The fix shipped 2026-05-18 has
// the host bundle its iceServers into the relay-peer-id message,
// and the station mutates its Peer's _options.config so a fresh
// peer.connect() for the camera channel uses them.
// ---------------------------------------------------------------------------

describe("PeerClientService — relay-peer-id iceServers application", () => {
  it("fires the relay-peer-id listener with the new peer id", () => {
    const svc = new PeerClientService();
    const received: Array<string | null> = [];
    svc.onRelayPeerIdChange((peerId) => {
      received.push(peerId);
    });

    (svc as unknown as PeerClientServiceInternal).handleMessage({
      type: "relay-peer-id",
      peerId: "relay-abc",
      iceServers: [
        { urls: "turn:relay.example.com:3478", username: "u", credential: "p" },
      ],
    });
    expect(received).toEqual(["relay-abc"]);
  });

  it("mutates the Peer's _options.config.iceServers when the message carries them", () => {
    const svc = new PeerClientService();
    // Inject a fake Peer with the same _options shape PeerJS exposes
    // internally. Skipping the real openPeer() / broker handshake keeps
    // the test focused on the apply path; the listener test above
    // covers the dispatch entry.
    const fakeOptions: { config?: { iceServers: RTCIceServer[] } } = {};
    const fakePeer = { _options: fakeOptions };
    (svc as unknown as { peer: typeof fakePeer }).peer = fakePeer;

    const turn: RTCIceServer[] = [
      {
        urls: ["turn:relay.example.com:3478?transport=udp"],
        username: "test-user",
        credential: "test-secret",
      },
    ];

    (svc as unknown as PeerClientServiceInternal).handleMessage({
      type: "relay-peer-id",
      peerId: "relay-abc",
      iceServers: turn,
    });

    expect(fakeOptions.config).toBeDefined();
    expect(fakeOptions.config?.iceServers).toEqual(turn);
  });

  it("does not touch the Peer when iceServers is absent (older host bundle)", () => {
    const svc = new PeerClientService();
    const fakeOptions: { config?: { iceServers: RTCIceServer[] } } = {
      // Pre-existing config — if our code mistakenly overwrote with an
      // empty array, the station would lose any local TURN config it
      // had set elsewhere. Assert we leave it alone.
      config: {
        iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
      },
    };
    const fakePeer = { _options: fakeOptions };
    (svc as unknown as { peer: typeof fakePeer }).peer = fakePeer;

    (svc as unknown as PeerClientServiceInternal).handleMessage({
      type: "relay-peer-id",
      peerId: "relay-abc",
      // iceServers omitted — older host bundle that doesn't ship this.
    });

    expect(fakeOptions.config?.iceServers).toEqual([
      { urls: "stun:stun.l.google.com:19302" },
    ]);
  });

  it("does not throw when iceServers arrives before the station's Peer is constructed", () => {
    const svc = new PeerClientService();
    // No peer assigned — applyRelayIceServers should silently no-op.
    expect(() =>
      (svc as unknown as PeerClientServiceInternal).handleMessage({
        type: "relay-peer-id",
        peerId: "relay-abc",
        iceServers: [{ urls: "turn:r" }],
      }),
    ).not.toThrow();
  });

  describe("countdown sticky replay", () => {
    // gonogo-countdown-start is a fire-and-forget broadcast. A GoNoGo widget
    // that subscribes after the message landed (page mounting, layout switch,
    // remount) used to miss the running countdown entirely and show nothing
    // until T-0 — the 2026-05-08 "Joel saw only T-0" bug.
    it("replays a running countdown to a late subscriber", async () => {
      const svc = new PeerClientService();
      const t0Ms = Date.now() + 8_000;
      (svc as unknown as PeerClientServiceInternal).handleMessage({
        type: "gonogo-countdown-start",
        t0Ms,
      });

      const received: number[] = [];
      svc.onGonogoCountdownStart((t) => received.push(t));
      // Replay is deferred a microtask so subscribe-then-replay can't
      // re-enter React render.
      await Promise.resolve();
      expect(received).toEqual([t0Ms]);
    });

    it("does not replay after the countdown was cancelled", async () => {
      const svc = new PeerClientService();
      (svc as unknown as PeerClientServiceInternal).handleMessage({
        type: "gonogo-countdown-start",
        t0Ms: Date.now() + 8_000,
      });
      (svc as unknown as PeerClientServiceInternal).handleMessage({
        type: "gonogo-countdown-cancel",
        reason: "no-go",
      });

      const received: number[] = [];
      svc.onGonogoCountdownStart((t) => received.push(t));
      await Promise.resolve();
      expect(received).toEqual([]);
    });

    it("does not replay a countdown whose t0 already passed", async () => {
      const svc = new PeerClientService();
      (svc as unknown as PeerClientServiceInternal).handleMessage({
        type: "gonogo-countdown-start",
        t0Ms: Date.now() - 1_000,
      });

      const received: number[] = [];
      svc.onGonogoCountdownStart((t) => received.push(t));
      await Promise.resolve();
      expect(received).toEqual([]);
    });

    it("still delivers live countdown events to existing subscribers exactly once", async () => {
      const svc = new PeerClientService();
      const received: number[] = [];
      svc.onGonogoCountdownStart((t) => received.push(t));

      const t0Ms = Date.now() + 8_000;
      (svc as unknown as PeerClientServiceInternal).handleMessage({
        type: "gonogo-countdown-start",
        t0Ms,
      });
      await Promise.resolve();
      expect(received).toEqual([t0Ms]);
    });
  });
});
