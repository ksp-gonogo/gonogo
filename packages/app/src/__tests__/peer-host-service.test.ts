import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Listener = (...args: unknown[]) => void;

// ---------------------------------------------------------------------------
// Fake Peer / DataConnection
// ---------------------------------------------------------------------------

class FakePeer {
  private listeners = new Map<string, Listener[]>();
  static last: FakePeer | null = null;

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

  destroy() {}
}

class FakeDataConnection {
  private listeners = new Map<string, Listener[]>();
  peer = "remote-peer";
  sent: unknown[] = [];

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
    service.start();

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
    service.start();

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
    service.start();
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
    service.start();
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
