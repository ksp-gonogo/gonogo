import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Listener = (...args: unknown[]) => void;

// ---------------------------------------------------------------------------
// Fake Peer / DataConnection
// ---------------------------------------------------------------------------

class FakePeer {
  private listeners = new Map<string, Listener[]>();
  static last: FakePeer | null = null;
  reconnectCount = 0;
  disconnected = false;

  constructor(_id?: string) {
    FakePeer.last = this;
    // Simulate "open" firing asynchronously after construction
    queueMicrotask(() => this.emit("open", "FAKE-PEER-ID"));
  }

  on(event: string, cb: Listener) {
    const bucket = this.listeners.get(event) ?? [];
    bucket.push(cb);
    this.listeners.set(event, bucket);
  }

  emit(event: string, ...args: unknown[]) {
    this.listeners.get(event)?.forEach((cb) => {
      cb(...args);
    });
  }

  reconnect() {
    this.reconnectCount += 1;
  }

  destroy() {}
}

class FakeDataConnection {
  private listeners = new Map<string, Listener[]>();
  peer = "remote-peer";
  sent: unknown[] = [];
  closed = false;

  on(event: string, cb: Listener) {
    const bucket = this.listeners.get(event) ?? [];
    bucket.push(cb);
    this.listeners.set(event, bucket);
  }

  emit(event: string, ...args: unknown[]) {
    this.listeners.get(event)?.forEach((cb) => {
      cb(...args);
    });
  }

  send(msg: unknown) {
    this.sent.push(msg);
  }

  close() {
    this.closed = true;
    // Mirror peerjs: closing a conn synchronously fires its "close" event.
    this.emit("close");
  }
}

vi.mock("peerjs", () => ({
  default: FakePeer,
}));

// ---------------------------------------------------------------------------
// Fake WebSocket with manual event control
// ---------------------------------------------------------------------------

class FakeWebSocket {
  static instances: FakeWebSocket[] = [];
  static OPEN = 1;
  static CLOSED = 3;

  readyState = 0;
  url: string;
  private listeners = new Map<string, Listener[]>();

  constructor(url: string) {
    this.url = url;
    FakeWebSocket.instances.push(this);
  }

  addEventListener(event: string, cb: Listener) {
    const bucket = this.listeners.get(event) ?? [];
    bucket.push(cb);
    this.listeners.set(event, bucket);
  }

  fire(event: string, payload?: unknown) {
    this.listeners.get(event)?.forEach((cb) => {
      cb(payload);
    });
  }

  close() {
    this.readyState = FakeWebSocket.CLOSED;
    // Real close event is async — consumer explicitly calls fire("close")
  }

  send(_data: string) {}
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("PeerHostService — kOS session handling", () => {
  beforeEach(() => {
    FakeWebSocket.instances = [];
    FakePeer.last = null;
    vi.stubGlobal("WebSocket", FakeWebSocket);
    // Register a minimal kos data source so handleKosOpen can read config
    // without hitting localStorage or defaults
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("does not fire kos-close when a replaced ws later emits close", async () => {
    const { PeerHostService } = await import("../peer/PeerHostService");
    const service = new PeerHostService();
    await service.start();

    // Wait for FakePeer "open" microtask
    await Promise.resolve();

    const conn = new FakeDataConnection();
    if (!FakePeer.last) throw new Error("FakePeer not instantiated");
    FakePeer.last.emit("connection", conn);
    conn.emit("open");
    // Flush the dynamic import in sendSchema
    await new Promise((r) => setTimeout(r, 0));

    const sessionId = "session-A";

    // First kos-open for sessionId
    conn.emit("data", {
      type: "kos-open",
      sessionId,
      kosHost: "localhost",
      kosPort: 5410,
      cols: 80,
      rows: 24,
    });
    // Wait for the dynamic import in handleKosOpen
    await new Promise((r) => setTimeout(r, 0));
    const wsA = FakeWebSocket.instances.at(-1);
    if (!wsA) throw new Error("ws A not created");

    // Second kos-open for the SAME sessionId — triggers replacement
    conn.emit("data", {
      type: "kos-open",
      sessionId,
      kosHost: "localhost",
      kosPort: 5410,
      cols: 80,
      rows: 24,
    });
    await new Promise((r) => setTimeout(r, 0));
    const wsB = FakeWebSocket.instances.at(-1);
    if (!wsB) throw new Error("ws B not created");
    expect(wsB).not.toBe(wsA);

    // Simulate the old ws's close event firing AFTER the replacement
    const sentBefore = conn.sent.length;
    wsA.fire("close");

    // The kos-close for the replaced session should NOT be forwarded to the
    // station — otherwise the station sees [connection closed] for its live
    // session.
    const kosCloseMessages = conn.sent
      .slice(sentBefore)
      .filter(
        (m): m is { type: string } =>
          typeof m === "object" &&
          m !== null &&
          "type" in m &&
          (m as { type: string }).type === "kos-close",
      );
    expect(kosCloseMessages).toHaveLength(0);
  });

  it("does fire kos-close when the current (non-replaced) ws emits close", async () => {
    const { PeerHostService } = await import("../peer/PeerHostService");
    const service = new PeerHostService();
    await service.start();

    await Promise.resolve();

    const conn = new FakeDataConnection();
    if (!FakePeer.last) throw new Error("FakePeer not instantiated");
    FakePeer.last.emit("connection", conn);
    conn.emit("open");
    await new Promise((r) => setTimeout(r, 0));

    const sessionId = "session-B";
    conn.emit("data", {
      type: "kos-open",
      sessionId,
      kosHost: "localhost",
      kosPort: 5410,
      cols: 80,
      rows: 24,
    });
    await new Promise((r) => setTimeout(r, 0));
    const ws = FakeWebSocket.instances.at(-1);
    if (!ws) throw new Error("ws not created");

    // Proxy-side close — should propagate kos-close to the station
    ws.fire("close");

    const kosCloseMessages = conn.sent.filter(
      (m): m is { type: string; sessionId: string } =>
        typeof m === "object" &&
        m !== null &&
        "type" in m &&
        (m as { type: string }).type === "kos-close",
    );
    expect(kosCloseMessages).toHaveLength(1);
    expect(kosCloseMessages[0].sessionId).toBe(sessionId);
  });
});

describe("PeerHostService — hello", () => {
  beforeEach(() => {
    FakePeer.last = null;
  });

  it("sends hello as the first message on a new connection, before schema", async () => {
    const { clearRegistry } = await import("@gonogo/core");
    const { PeerHostService } = await import("../peer/PeerHostService");

    clearRegistry();

    const service = new PeerHostService();
    await service.start();
    await Promise.resolve();

    const conn = new FakeDataConnection();
    if (!FakePeer.last) throw new Error("FakePeer not instantiated");
    FakePeer.last.emit("connection", conn);
    conn.emit("open");
    // Flush the dynamic import inside sendSchema
    await new Promise((r) => setTimeout(r, 0));

    expect(conn.sent.length).toBeGreaterThan(0);
    const first = conn.sent[0] as { type: string; version?: string };
    expect(first.type).toBe("hello");
    expect(typeof first.version).toBe("string");

    const helloIdx = conn.sent.findIndex(
      (m): m is { type: string } =>
        typeof m === "object" &&
        m !== null &&
        (m as { type: string }).type === "hello",
    );
    const schemaIdx = conn.sent.findIndex(
      (m): m is { type: string } =>
        typeof m === "object" &&
        m !== null &&
        (m as { type: string }).type === "schema",
    );
    expect(helloIdx).toBeLessThan(schemaIdx);

    clearRegistry();
  });
});

describe("PeerHostService — stationKey ghost eviction", () => {
  beforeEach(() => {
    FakePeer.last = null;
  });

  it("closes the previous peerId when a new station-info arrives with the same stationKey", async () => {
    const { clearRegistry } = await import("@gonogo/core");
    const { PeerHostService } = await import("../peer/PeerHostService");
    clearRegistry();

    const service = new PeerHostService();
    await service.start();
    await Promise.resolve();
    if (!FakePeer.last) throw new Error("FakePeer not instantiated");

    // Original session.
    const ghost = new FakeDataConnection();
    ghost.peer = "station-KEY-old-session";
    FakePeer.last.emit("connection", ghost);
    ghost.emit("open");
    ghost.emit("data", {
      type: "station-info",
      name: "Joe",
      stationKey: "KEY",
    });
    expect(ghost.closed).toBe(false);

    // Refreshed session — same stationKey, different peerId.
    const fresh = new FakeDataConnection();
    fresh.peer = "station-KEY-new-session";
    FakePeer.last.emit("connection", fresh);
    fresh.emit("open");
    fresh.emit("data", {
      type: "station-info",
      name: "Joe",
      stationKey: "KEY",
    });

    expect(ghost.closed).toBe(true);
    expect(fresh.closed).toBe(false);

    clearRegistry();
  });

  it("does not evict on station-info from the same peerId (rename case)", async () => {
    const { clearRegistry } = await import("@gonogo/core");
    const { PeerHostService } = await import("../peer/PeerHostService");
    clearRegistry();

    const service = new PeerHostService();
    await service.start();
    await Promise.resolve();
    if (!FakePeer.last) throw new Error("FakePeer not instantiated");

    const conn = new FakeDataConnection();
    conn.peer = "station-KEY-session";
    FakePeer.last.emit("connection", conn);
    conn.emit("open");
    conn.emit("data", { type: "station-info", name: "Joe", stationKey: "KEY" });
    conn.emit("data", {
      type: "station-info",
      name: "Joe Renamed",
      stationKey: "KEY",
    });

    expect(conn.closed).toBe(false);

    clearRegistry();
  });
});

describe("PeerHostService — selective subscription", () => {
  beforeEach(() => {
    FakePeer.last = null;
  });

  // Regression guard: a peer that switches to "selective" mode must only
  // receive `data` messages whose (sourceId, key) it has subscribed to,
  // while a peer that stays on the default broadcast-all path keeps
  // receiving everything. Catches a refactor that loses the per-conn
  // WeakMap mutation in the data-mode / data-subscribe handlers.
  it("filters data broadcasts per-peer based on mode + subs", async () => {
    const { clearRegistry } = await import("@gonogo/core");
    const { PeerHostService } = await import("../peer/PeerHostService");
    clearRegistry();

    const service = new PeerHostService();
    await service.start();
    await Promise.resolve();
    if (!FakePeer.last) throw new Error("FakePeer not instantiated");

    const broadcastAllConn = new FakeDataConnection();
    broadcastAllConn.peer = "broadcast-all-peer";
    FakePeer.last.emit("connection", broadcastAllConn);
    broadcastAllConn.emit("open");

    const selectiveConn = new FakeDataConnection();
    selectiveConn.peer = "selective-peer";
    FakePeer.last.emit("connection", selectiveConn);
    selectiveConn.emit("open");
    await new Promise((r) => setTimeout(r, 0));

    // Selective peer opts in and subscribes to a single key.
    selectiveConn.emit("data", { type: "peer-data-mode", mode: "selective" });
    selectiveConn.emit("data", {
      type: "peer-data-subscribe",
      sourceId: "telemachus",
      keys: ["v.altitude"],
    });

    const baseAll = broadcastAllConn.sent.length;
    const baseSelective = selectiveConn.sent.length;

    service.broadcast({
      type: "data",
      sourceId: "telemachus",
      key: "v.altitude",
      value: 100,
      t: 1,
    });
    service.broadcast({
      type: "data",
      sourceId: "telemachus",
      key: "v.lat",
      value: 0.5,
      t: 2,
    });

    const allNew = broadcastAllConn.sent.slice(baseAll) as Array<{
      type: string;
      key?: string;
    }>;
    const selectiveNew = selectiveConn.sent.slice(baseSelective) as Array<{
      type: string;
      key?: string;
    }>;

    // broadcast-all peer sees both
    expect(allNew.filter((m) => m.type === "data")).toHaveLength(2);
    // selective peer sees only the subscribed key
    const selectiveData = selectiveNew.filter((m) => m.type === "data");
    expect(selectiveData).toHaveLength(1);
    expect(selectiveData[0].key).toBe("v.altitude");

    // Now unsubscribe the selective peer and confirm it stops getting it.
    selectiveConn.emit("data", {
      type: "peer-data-unsubscribe",
      sourceId: "telemachus",
      keys: ["v.altitude"],
    });

    const baseSelective2 = selectiveConn.sent.length;
    service.broadcast({
      type: "data",
      sourceId: "telemachus",
      key: "v.altitude",
      value: 200,
      t: 3,
    });
    const after = selectiveConn.sent.slice(baseSelective2) as Array<{
      type: string;
    }>;
    expect(after.filter((m) => m.type === "data")).toHaveLength(0);

    clearRegistry();
  });
});

describe("PeerHostService — peer-driven subscribe forwarding", () => {
  beforeEach(() => {
    FakePeer.last = null;
  });

  // 2026-05-18 — root cause of the "ship map sluggish on stations" bug.
  // Demand-only keys (`v.topology`, `v.topologySeq`, indexed keys like
  // `b.name[1]`, `v.partState[<flightId>]`) aren't in any source's
  // static schema, so PeerBroadcastingDataSource never subscribes to
  // them at construction time. Before this fix, a station that called
  // `peer-data-subscribe` for those keys got exactly one back-fill of
  // whatever was cached and then went silent. Stations needed a full
  // page-reload to see a fresh topology after staging.
  //
  // The fix: `peer-data-subscribe` on a non-schema key triggers an
  // upstream subscribe via the registered back-fill source's
  // `subscribe()` method, refcounted across all interested peers. Each
  // upstream sample broadcasts via the standard per-peer filter, so
  // only subscribed peers receive it.
  it("forwards demand-only keys to subscribed peers", async () => {
    const { PeerHostService } = await import("../peer/PeerHostService");
    const service = new PeerHostService();
    await service.start();
    if (!FakePeer.last) throw new Error("FakePeer not instantiated");

    // Register a fake "data" source that owns `v.topology` (demand-only —
    // not in its schema). The host should subscribe through this source
    // when a peer asks for the key.
    //
    // Holder object so TS doesn't narrow the callback ref to its initial
    // `null` value — it can't flow-analyse through the subscribe closure.
    const upstreamCb: { value: ((v: unknown) => void) | null } = {
      value: null,
    };
    let unsubCalls = 0;
    service.registerSourceForBackfill("data", {
      getLatestValue: () => undefined,
      schema: () => [{ key: "v.altitude" }], // intentionally excludes v.topology
      subscribe: (key, cb) => {
        if (key === "v.topology") upstreamCb.value = cb;
        return () => {
          if (key === "v.topology") {
            upstreamCb.value = null;
            unsubCalls += 1;
          }
        };
      },
    });

    const conn = new FakeDataConnection();
    conn.peer = "station-1";
    FakePeer.last.emit("connection", conn);
    conn.emit("open");
    await new Promise((r) => setTimeout(r, 0));

    conn.emit("data", { type: "peer-data-mode", mode: "selective" });
    conn.emit("data", {
      type: "peer-data-subscribe",
      sourceId: "data",
      keys: ["v.topology"],
    });

    // Subscribe should have triggered an upstream subscribe.
    expect(upstreamCb.value).not.toBeNull();

    const base = conn.sent.length;
    if (!upstreamCb.value)
      throw new Error("upstreamCb was not assigned by subscribe");
    upstreamCb.value({ parts: [{ flightId: 1 }], topologySeq: 7 });

    const dataMsgs = (
      conn.sent.slice(base) as Array<{ type: string; key: string }>
    ).filter((m) => m.type === "data");
    expect(dataMsgs).toHaveLength(1);
    expect(dataMsgs[0].key).toBe("v.topology");

    // Unsubscribe — the upstream sub should tear down (only peer was this one).
    conn.emit("data", {
      type: "peer-data-unsubscribe",
      sourceId: "data",
      keys: ["v.topology"],
    });
    expect(unsubCalls).toBe(1);
    expect(upstreamCb.value).toBeNull();
  });

  it("refcounts demand-only subs across multiple peers", async () => {
    const { PeerHostService } = await import("../peer/PeerHostService");
    const service = new PeerHostService();
    await service.start();
    if (!FakePeer.last) throw new Error("FakePeer not instantiated");

    let subscribeCalls = 0;
    let unsubCalls = 0;
    service.registerSourceForBackfill("data", {
      schema: () => [],
      subscribe: (_key, _cb) => {
        subscribeCalls += 1;
        return () => {
          unsubCalls += 1;
        };
      },
    });

    const connA = new FakeDataConnection();
    connA.peer = "station-A";
    FakePeer.last.emit("connection", connA);
    connA.emit("open");
    const connB = new FakeDataConnection();
    connB.peer = "station-B";
    FakePeer.last.emit("connection", connB);
    connB.emit("open");
    await new Promise((r) => setTimeout(r, 0));

    connA.emit("data", { type: "peer-data-mode", mode: "selective" });
    connB.emit("data", { type: "peer-data-mode", mode: "selective" });
    connA.emit("data", {
      type: "peer-data-subscribe",
      sourceId: "data",
      keys: ["v.topology"],
    });
    connB.emit("data", {
      type: "peer-data-subscribe",
      sourceId: "data",
      keys: ["v.topology"],
    });

    // Only one upstream subscribe even with two subscribers.
    expect(subscribeCalls).toBe(1);
    expect(unsubCalls).toBe(0);

    // One peer drops out — the other still holds.
    connA.emit("data", {
      type: "peer-data-unsubscribe",
      sourceId: "data",
      keys: ["v.topology"],
    });
    expect(unsubCalls).toBe(0);

    // Last peer drops — upstream tears down.
    connB.emit("data", {
      type: "peer-data-unsubscribe",
      sourceId: "data",
      keys: ["v.topology"],
    });
    expect(unsubCalls).toBe(1);
  });

  it("skips peer-driven subs for keys already in the schema (no double-broadcast)", async () => {
    const { PeerHostService } = await import("../peer/PeerHostService");
    const service = new PeerHostService();
    await service.start();
    if (!FakePeer.last) throw new Error("FakePeer not instantiated");

    // Schema includes `v.altitude` — PBDS already subscribes to it at
    // construction, so a peer-driven sub would double every broadcast.
    let subscribeCalls = 0;
    service.registerSourceForBackfill("data", {
      schema: () => [{ key: "v.altitude" }],
      subscribe: () => {
        subscribeCalls += 1;
        return () => {};
      },
    });

    const conn = new FakeDataConnection();
    conn.peer = "station-1";
    FakePeer.last.emit("connection", conn);
    conn.emit("open");
    await new Promise((r) => setTimeout(r, 0));

    conn.emit("data", { type: "peer-data-mode", mode: "selective" });
    conn.emit("data", {
      type: "peer-data-subscribe",
      sourceId: "data",
      keys: ["v.altitude"],
    });

    expect(subscribeCalls).toBe(0);
  });

  it("releases peer-driven subs when a station's conn closes", async () => {
    const { PeerHostService } = await import("../peer/PeerHostService");
    const service = new PeerHostService();
    await service.start();
    if (!FakePeer.last) throw new Error("FakePeer not instantiated");

    let unsubCalls = 0;
    service.registerSourceForBackfill("data", {
      schema: () => [],
      subscribe: () => () => {
        unsubCalls += 1;
      },
    });

    const conn = new FakeDataConnection();
    conn.peer = "station-1";
    FakePeer.last.emit("connection", conn);
    conn.emit("open");
    await new Promise((r) => setTimeout(r, 0));

    conn.emit("data", { type: "peer-data-mode", mode: "selective" });
    conn.emit("data", {
      type: "peer-data-subscribe",
      sourceId: "data",
      keys: ["v.topology", "v.partState[1]"],
    });

    // Station refresh / network drop — conn closes without an explicit
    // peer-data-unsubscribe. The host must still release the upstream subs
    // or we leak forever.
    conn.emit("close");
    expect(unsubCalls).toBe(2);
  });
});

describe("PeerHostService — schema broadcast", () => {
  beforeEach(() => {
    FakePeer.last = null;
  });

  // Regression: the "schema" message originally carried only key names, so
  // station-side config UIs (e.g. MapView telemetry picker) rendered an empty
  // list because they needed label/unit/group. Host must forward the full
  // DataKeyMeta shape.
  it("sends the fully enriched DataKeyMeta[] to a connecting station", async () => {
    const { registerDataSource, clearRegistry } = await import("@gonogo/core");
    const { PeerHostService } = await import("../peer/PeerHostService");

    clearRegistry();
    registerDataSource({
      id: "data",
      name: "Data",
      status: "connected",
      affectedBySignalLoss: false,
      connect: async () => {},
      disconnect: () => {},
      schema: () => [
        {
          key: "v.altitude",
          label: "Altitude",
          unit: "m",
          group: "Position",
        },
        { key: "v.lat", label: "Latitude", unit: "°", group: "Position" },
      ],
      subscribe: () => () => {},
      onStatusChange: () => () => {},
      execute: async () => {},
      configSchema: () => [],
      configure: () => {},
      getConfig: () => ({}),
    } as unknown as Parameters<typeof registerDataSource>[0]);

    const service = new PeerHostService();
    await service.start();
    await Promise.resolve();

    const conn = new FakeDataConnection();
    if (!FakePeer.last) throw new Error("FakePeer not instantiated");
    FakePeer.last.emit("connection", conn);
    conn.emit("open");
    // Flush the dynamic import inside sendSchema
    await new Promise((r) => setTimeout(r, 0));

    const schemaMsg = conn.sent.find(
      (m): m is { type: string; sources: Array<Record<string, unknown>> } =>
        typeof m === "object" &&
        m !== null &&
        "type" in m &&
        (m as { type: string }).type === "schema",
    );
    expect(schemaMsg).toBeDefined();
    expect(schemaMsg?.sources).toHaveLength(1);
    const source = schemaMsg?.sources[0] as {
      id: string;
      name: string;
      keys: Array<{
        key: string;
        label?: string;
        unit?: string;
        group?: string;
      }>;
    };
    expect(source.id).toBe("data");
    expect(source.keys).toHaveLength(2);
    expect(source.keys[0]).toMatchObject({
      key: "v.altitude",
      label: "Altitude",
      unit: "m",
      group: "Position",
    });

    clearRegistry();
  });
});

describe("PeerHostService — broker reconnect backoff", () => {
  beforeEach(() => {
    FakePeer.last = null;
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("schedules peer.reconnect with exponential backoff instead of looping", async () => {
    const { PeerHostService } = await import("../peer/PeerHostService");
    const service = new PeerHostService();
    void service.start();
    await vi.advanceTimersByTimeAsync(0);
    const peer = FakePeer.last;
    if (!peer) throw new Error("FakePeer not instantiated");

    // First disconnect — backoff scheduled, reconnect NOT yet called.
    peer.emit("disconnected");
    expect(peer.reconnectCount).toBe(0);

    // Advance ~500ms: first attempt fires.
    await vi.advanceTimersByTimeAsync(500);
    expect(peer.reconnectCount).toBe(1);

    // Synchronous re-fire (PeerJS does this when the WS immediately
    // re-closes) must NOT collapse into another instant reconnect.
    peer.emit("disconnected");
    expect(peer.reconnectCount).toBe(1);

    // Second backoff doubles to ~1000ms.
    await vi.advanceTimersByTimeAsync(999);
    expect(peer.reconnectCount).toBe(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(peer.reconnectCount).toBe(2);

    // Third disconnect → ~2000ms.
    peer.emit("disconnected");
    await vi.advanceTimersByTimeAsync(1999);
    expect(peer.reconnectCount).toBe(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(peer.reconnectCount).toBe(3);
  });

  it("resets the backoff after a successful open", async () => {
    const { PeerHostService } = await import("../peer/PeerHostService");
    const service = new PeerHostService();
    void service.start();
    await vi.advanceTimersByTimeAsync(0);
    const peer = FakePeer.last;
    if (!peer) throw new Error("FakePeer not instantiated");

    // Three failed cycles climb to attempt 3 (~2000ms).
    peer.emit("disconnected");
    await vi.advanceTimersByTimeAsync(500);
    peer.emit("disconnected");
    await vi.advanceTimersByTimeAsync(1000);
    peer.emit("disconnected");
    await vi.advanceTimersByTimeAsync(2000);
    expect(peer.reconnectCount).toBe(3);

    // Broker comes back — open fires.
    peer.emit("open", "FAKE-PEER-ID");

    // Next disconnect should be back to attempt 1 (~500ms), not 4000ms.
    peer.emit("disconnected");
    await vi.advanceTimersByTimeAsync(499);
    expect(peer.reconnectCount).toBe(3);
    await vi.advanceTimersByTimeAsync(1);
    expect(peer.reconnectCount).toBe(4);
  });
});

// ---------------------------------------------------------------------------
// relay-peer-id broadcast carries iceServers — regression for the
// 2026-05-17 evening session where every station→relay camera
// negotiation died with `type: "negotiation-failed"` because the
// station's Peer had no TURN config and couldn't reach the relay's
// container-bridge ICE candidates. Fix shipped 2026-05-18 (commit
// 10d8698): bundle the host's iceServers into the relay-peer-id
// message so the station can apply them to its own Peer before
// calling the relay.
// ---------------------------------------------------------------------------

describe("PeerHostService — relay-peer-id iceServers propagation", () => {
  beforeEach(() => {
    FakePeer.last = null;
  });

  // Drain pending microtasks + macrotasks. PeerHostService.start() awaits
  // `fetchHostIceServers()` inside; the FakePeer "open" microtask fires
  // first, then schema dispatch (which awaits a dynamic import). The
  // helper flushes both so the test interacts with a settled service.
  async function flush(): Promise<void> {
    await Promise.resolve();
    await new Promise((r) => setTimeout(r, 0));
  }

  it("includes the host's iceServers in the broadcast relay-peer-id message", async () => {
    const { PeerHostService } = await import("../peer/PeerHostService");
    const service = new PeerHostService();
    void service.start();
    await flush();

    // Connect a station so there's somebody for `broadcast()` to send to.
    const conn = new FakeDataConnection();
    if (!FakePeer.last) throw new Error("FakePeer not instantiated");
    FakePeer.last.emit("connection", conn);
    conn.emit("open");
    await flush();

    // Pre-existing connection messages (hello, schema, etc.) cleared so
    // the assertion below only looks at the relay-peer-id we trigger.
    conn.sent.length = 0;

    const turnConfig: RTCIceServer[] = [
      {
        urls: ["turn:relay.example.com:3478?transport=udp"],
        username: "test-user",
        credential: "test-secret",
      },
    ];
    // PeerHostService.iceServers is a public field assigned by
    // `refreshIceConfig()` in production. Setting it directly skips the
    // network fetch; what we want to test is the broadcast carrying it,
    // not the fetch.
    (service as unknown as { iceServers: RTCIceServer[] }).iceServers =
      turnConfig;

    service.setRelayPeerId("relay-peer-123");

    const relayMessages = conn.sent.filter(
      (
        m,
      ): m is {
        type: string;
        peerId: string;
        iceServers?: RTCIceServer[];
      } =>
        typeof m === "object" &&
        m !== null &&
        "type" in m &&
        (m as { type: string }).type === "relay-peer-id",
    );
    expect(relayMessages).toHaveLength(1);
    expect(relayMessages[0].peerId).toBe("relay-peer-123");
    expect(relayMessages[0].iceServers).toEqual(turnConfig);
  });

  it("omits iceServers when the host hasn't fetched any TURN credentials yet", async () => {
    const { PeerHostService } = await import("../peer/PeerHostService");
    const service = new PeerHostService();
    void service.start();
    await flush();

    const conn = new FakeDataConnection();
    if (!FakePeer.last) throw new Error("FakePeer not instantiated");
    FakePeer.last.emit("connection", conn);
    conn.emit("open");
    await flush();
    conn.sent.length = 0;

    // Default state: iceServers is `[]` (host's /ice-config fetch
    // hasn't returned creds yet, or relay's coturn is down). The
    // broadcast should leave the field undefined so older stations
    // don't blow up on an empty-array config and so the wire stays
    // compact in the no-TURN case.
    service.setRelayPeerId("relay-peer-456");
    const relayMessages = conn.sent.filter(
      (m): m is { type: string; iceServers?: unknown } =>
        typeof m === "object" &&
        m !== null &&
        "type" in m &&
        (m as { type: string }).type === "relay-peer-id",
    );
    expect(relayMessages).toHaveLength(1);
    expect(relayMessages[0].iceServers).toBeUndefined();
  });

  it("includes iceServers in the latecomer-station send on a fresh connection", async () => {
    const { PeerHostService } = await import("../peer/PeerHostService");
    const service = new PeerHostService();
    void service.start();
    await flush();

    // Set up the relay state BEFORE the station connects — simulates
    // a station refresh mid-flight.
    const turnConfig: RTCIceServer[] = [
      {
        urls: "turn:relay.example.com:3478",
        username: "u",
        credential: "p",
      },
    ];
    (service as unknown as { iceServers: RTCIceServer[] }).iceServers =
      turnConfig;
    service.setRelayPeerId("relay-peer-789");

    // Now a fresh station connects. PeerHostService should send the
    // current relay-peer-id (with iceServers) as part of the
    // latecomer-bootstrap sequence.
    const conn = new FakeDataConnection();
    if (!FakePeer.last) throw new Error("FakePeer not instantiated");
    FakePeer.last.emit("connection", conn);
    conn.emit("open");
    await flush();

    const relayMessages = conn.sent.filter(
      (
        m,
      ): m is {
        type: string;
        peerId: string;
        iceServers?: RTCIceServer[];
      } =>
        typeof m === "object" &&
        m !== null &&
        "type" in m &&
        (m as { type: string }).type === "relay-peer-id",
    );
    expect(relayMessages.length).toBeGreaterThanOrEqual(1);
    const latecomer = relayMessages.at(-1);
    expect(latecomer?.peerId).toBe("relay-peer-789");
    expect(latecomer?.iceServers).toEqual(turnConfig);
  });
});

describe("PeerHostService — TURN-on-demand escalation", () => {
  beforeEach(() => {
    FakePeer.last = null;
  });

  async function flush(): Promise<void> {
    await Promise.resolve();
    await new Promise((r) => setTimeout(r, 0));
  }

  type ServiceInternal = {
    turnEscalated: boolean;
    iceServers: RTCIceServer[];
    turnEscalationTimers: Map<unknown, ReturnType<typeof setTimeout>>;
    escalateTurn: (peerId: string) => void;
    destroyPeer: () => void;
    openPeer: () => void;
  };

  // An incoming connection that opens in time should cancel its escalation timer.
  // We verify that:
  //   (a) a timer is added to the map when the connection arrives (iceServers non-empty)
  //   (b) after "open" fires, the map entry is removed (timer was cancelled)
  //   (c) turnEscalated stays false
  it("cancels the escalation timer when a station connection opens normally", async () => {
    const { PeerHostService } = await import("../peer/PeerHostService");
    const service = new PeerHostService();
    await service.start();
    await flush();

    const internal = service as unknown as ServiceInternal;
    const turnConfig: RTCIceServer[] = [
      { urls: "turn:relay.example.com:3478", username: "u", credential: "p" },
    ];
    internal.iceServers = turnConfig;

    if (!FakePeer.last) throw new Error("FakePeer not instantiated");
    const conn = new FakeDataConnection();
    FakePeer.last.emit("connection", conn);

    // Timer should have been registered (conn is in the map).
    expect(internal.turnEscalationTimers.has(conn)).toBe(true);

    // Connection opens — timer should be cancelled and removed.
    conn.emit("open");
    await flush();

    expect(internal.turnEscalationTimers.has(conn)).toBe(false);
    expect(internal.turnEscalated).toBe(false);
  });

  // No timer should be started when iceServers is empty (nothing to escalate to).
  it("does not start an escalation timer when iceServers is empty", async () => {
    const { PeerHostService } = await import("../peer/PeerHostService");
    const service = new PeerHostService();
    await service.start();
    await flush();

    const internal = service as unknown as ServiceInternal;
    internal.iceServers = [];

    if (!FakePeer.last) throw new Error("FakePeer not instantiated");
    const conn = new FakeDataConnection();
    FakePeer.last.emit("connection", conn);

    // No timer registered — iceServers was empty.
    expect(internal.turnEscalationTimers.has(conn)).toBe(false);
    expect(internal.turnEscalated).toBe(false);
  });

  // escalateTurn() sets turnEscalated to true when iceServers is non-empty.
  it("escalateTurn sets turnEscalated to true", async () => {
    const { PeerHostService } = await import("../peer/PeerHostService");
    const service = new PeerHostService();
    await service.start();
    await flush();

    const internal = service as unknown as ServiceInternal;
    internal.iceServers = [
      { urls: "turn:relay.example.com:3478", username: "u", credential: "p" },
    ];

    expect(internal.turnEscalated).toBe(false);
    internal.escalateTurn("some-peer");
    expect(internal.turnEscalated).toBe(true);
  });

  // escalateTurn() is a no-op if iceServers is empty.
  it("escalateTurn does not set turnEscalated when iceServers is empty", async () => {
    const { PeerHostService } = await import("../peer/PeerHostService");
    const service = new PeerHostService();
    await service.start();
    await flush();

    const internal = service as unknown as ServiceInternal;
    internal.iceServers = [];
    internal.escalateTurn("some-peer");
    expect(internal.turnEscalated).toBe(false);
  });

  // escalateTurn() is idempotent.
  it("escalateTurn is idempotent when already escalated", async () => {
    const { PeerHostService } = await import("../peer/PeerHostService");
    const service = new PeerHostService();
    await service.start();
    await flush();

    const internal = service as unknown as ServiceInternal;
    internal.iceServers = [
      { urls: "turn:relay.example.com:3478", username: "u", credential: "p" },
    ];
    internal.escalateTurn("peer-1");
    internal.escalateTurn("peer-2"); // second call should not throw
    expect(internal.turnEscalated).toBe(true);
  });

  // stop() must reset turnEscalated so a fresh start() begins STUN-only.
  it("resets turnEscalated on stop()", async () => {
    const { PeerHostService } = await import("../peer/PeerHostService");
    const service = new PeerHostService();
    await service.start();
    await flush();

    const internal = service as unknown as ServiceInternal;
    internal.turnEscalated = true;
    service.stop();

    expect(internal.turnEscalated).toBe(false);
  });

  // stop() clears any pending escalation timers.
  it("clears all pending escalation timers on stop()", async () => {
    const { PeerHostService } = await import("../peer/PeerHostService");
    const service = new PeerHostService();
    await service.start();
    await flush();

    const internal = service as unknown as ServiceInternal;
    internal.iceServers = [
      { urls: "turn:relay.example.com:3478", username: "u", credential: "p" },
    ];

    if (!FakePeer.last) throw new Error("FakePeer not instantiated");
    // Connection without "open" — registers an escalation timer.
    const conn = new FakeDataConnection();
    FakePeer.last.emit("connection", conn);
    expect(internal.turnEscalationTimers.size).toBeGreaterThan(0);

    service.stop();
    expect(internal.turnEscalationTimers.size).toBe(0);
  });

  // A connection that closes before "open" must clear its escalation timer.
  it("clears the escalation timer when a connection closes before opening", async () => {
    const { PeerHostService } = await import("../peer/PeerHostService");
    const service = new PeerHostService();
    await service.start();
    await flush();

    const internal = service as unknown as ServiceInternal;
    internal.iceServers = [
      { urls: "turn:relay.example.com:3478", username: "u", credential: "p" },
    ];

    if (!FakePeer.last) throw new Error("FakePeer not instantiated");
    const conn = new FakeDataConnection();
    FakePeer.last.emit("connection", conn);
    expect(internal.turnEscalationTimers.has(conn)).toBe(true);

    // Close before open — timer should be cleared.
    conn.emit("close");
    expect(internal.turnEscalationTimers.has(conn)).toBe(false);
  });

  // When already escalated, no new timer is started for subsequent connections.
  it("does not start new escalation timers when already escalated", async () => {
    const { PeerHostService } = await import("../peer/PeerHostService");
    const service = new PeerHostService();
    await service.start();
    await flush();

    const internal = service as unknown as ServiceInternal;
    internal.iceServers = [
      { urls: "turn:relay.example.com:3478", username: "u", credential: "p" },
    ];
    // Simulate already-escalated state.
    internal.turnEscalated = true;

    if (!FakePeer.last) throw new Error("FakePeer not instantiated");
    const conn = new FakeDataConnection();
    FakePeer.last.emit("connection", conn);

    // No timer started because `!this.turnEscalated` guard is false.
    expect(internal.turnEscalationTimers.has(conn)).toBe(false);
  });
});

describe("PeerHostService — kerbcast negotiate broker", () => {
  beforeEach(() => {
    FakePeer.last = null;
  });

  async function flush(): Promise<void> {
    await new Promise((r) => setTimeout(r, 0));
  }

  function kerbcastResponses(conn: FakeDataConnection): Array<{
    type: string;
    requestId: string;
    answer?: { sdp: string; cameras: number[] };
    error?: string;
  }> {
    return conn.sent.filter(
      (
        m,
      ): m is {
        type: string;
        requestId: string;
        answer?: { sdp: string; cameras: number[] };
        error?: string;
      } =>
        typeof m === "object" &&
        m !== null &&
        "type" in m &&
        (m as { type: string }).type === "kerbcast-negotiate-response",
    );
  }

  it("relays a station offer to the host kerbcast source and returns its answer", async () => {
    const { registerDataSource, clearRegistry } = await import("@gonogo/core");
    const { PeerHostService } = await import("../peer/PeerHostService");
    clearRegistry();

    const relayOffer = vi.fn(
      async (offer: { sdp: string; cameras: number[]; slots?: number }) => ({
        sdp: "answer-from-sidecar",
        cameras: offer.cameras,
      }),
    );
    registerDataSource({
      id: "kerbcast",
      name: "Kerbcast",
      status: "connected",
      affectedBySignalLoss: false,
      connect: async () => {},
      disconnect: () => {},
      schema: () => [],
      subscribe: () => () => {},
      onStatusChange: () => () => {},
      execute: async () => {},
      configSchema: () => [],
      configure: () => {},
      getConfig: () => ({}),
      relayOffer,
    } as unknown as Parameters<typeof registerDataSource>[0]);

    const service = new PeerHostService();
    await service.start();
    await Promise.resolve();
    const conn = new FakeDataConnection();
    if (!FakePeer.last) throw new Error("FakePeer not instantiated");
    FakePeer.last.emit("connection", conn);
    conn.emit("open");
    await flush();

    conn.emit("data", {
      type: "kerbcast-negotiate-request",
      requestId: "req-1",
      offer: { sdp: "offer-from-station", cameras: [42, 43], slots: 6 },
    });
    await flush();

    expect(relayOffer).toHaveBeenCalledWith({
      sdp: "offer-from-station",
      cameras: [42, 43],
      slots: 6,
    });
    const responses = kerbcastResponses(conn);
    expect(responses).toHaveLength(1);
    expect(responses[0].requestId).toBe("req-1");
    expect(responses[0].answer).toEqual({
      sdp: "answer-from-sidecar",
      cameras: [42, 43],
    });
    expect(responses[0].error).toBeUndefined();

    clearRegistry();
  });

  it("responds with an error when the host has no kerbcast source", async () => {
    const { clearRegistry } = await import("@gonogo/core");
    const { PeerHostService } = await import("../peer/PeerHostService");
    clearRegistry(); // no kerbcast registered

    const service = new PeerHostService();
    await service.start();
    await Promise.resolve();
    const conn = new FakeDataConnection();
    if (!FakePeer.last) throw new Error("FakePeer not instantiated");
    FakePeer.last.emit("connection", conn);
    conn.emit("open");
    await flush();

    conn.emit("data", {
      type: "kerbcast-negotiate-request",
      requestId: "req-2",
      offer: { sdp: "offer", cameras: [], slots: 6 },
    });
    await flush();

    const responses = kerbcastResponses(conn);
    expect(responses).toHaveLength(1);
    expect(responses[0].answer).toBeUndefined();
    expect(responses[0].error).toMatch(/unavailable/);

    clearRegistry();
  });
});
