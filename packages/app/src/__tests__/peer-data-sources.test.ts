import type { DataSource, DataSourceStatus } from "@gonogo/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PeerBroadcastingDataSource } from "../peer/PeerBroadcastingDataSource";
import { PeerClientDataSource } from "../peer/PeerClientDataSource";
import type { PeerMessage } from "../peer/protocol";

// ---------------------------------------------------------------------------
// Minimal fake DataSource for PeerBroadcastingDataSource tests
// ---------------------------------------------------------------------------

function makeRealSource(
  id = "test-source",
  schemaKeys: string[] = [],
): DataSource & {
  _emit: (key: string, value: unknown) => void;
  _emitStatus: (status: DataSourceStatus) => void;
} {
  const subscribers = new Map<string, Set<(v: unknown) => void>>();
  const statusListeners = new Set<(s: DataSourceStatus) => void>();

  return {
    id,
    name: "Test Source",
    status: "connected" as DataSourceStatus,
    connect: vi.fn().mockResolvedValue(undefined),
    disconnect: vi.fn(),
    schema: vi.fn().mockReturnValue(schemaKeys.map((key) => ({ key }))),
    configSchema: vi.fn().mockReturnValue([]),
    configure: vi.fn(),
    getConfig: vi.fn().mockReturnValue({}),
    setupInstructions: vi.fn().mockReturnValue(null),
    subscribe(key, cb) {
      if (!subscribers.has(key)) subscribers.set(key, new Set());
      subscribers.get(key)?.add(cb);
      return () => subscribers.get(key)?.delete(cb);
    },
    onStatusChange(cb) {
      statusListeners.add(cb);
      return () => statusListeners.delete(cb);
    },
    execute: vi.fn().mockResolvedValue(undefined),
    _emit(key, value) {
      subscribers.get(key)?.forEach((cb) => {
        cb(value);
      });
    },
    _emitStatus(status) {
      statusListeners.forEach((cb) => {
        cb(status);
      });
    },
  };
}

// ---------------------------------------------------------------------------
// Minimal fake PeerHostService
// ---------------------------------------------------------------------------

function makeFakeHost() {
  const broadcasts: PeerMessage[] = [];
  return {
    broadcast: vi.fn((msg: PeerMessage) => broadcasts.push(msg)),
    broadcasts,
  };
}

// ---------------------------------------------------------------------------
// Minimal fake PeerClientService
// ---------------------------------------------------------------------------

function makeFakeClient() {
  const dataListeners = new Set<
    (sourceId: string, key: string, value: unknown) => void
  >();
  const statusListeners = new Set<(sourceId: string, status: string) => void>();
  const executes: Array<{ sourceId: string; action: string }> = [];

  return {
    onData(cb: (sourceId: string, key: string, value: unknown) => void) {
      dataListeners.add(cb);
      return () => dataListeners.delete(cb);
    },
    onSourceStatus(cb: (sourceId: string, status: string) => void) {
      statusListeners.add(cb);
      return () => statusListeners.delete(cb);
    },
    onConnectionStatus: vi.fn().mockReturnValue(() => {}),
    onSchema: vi.fn().mockReturnValue(() => {}),
    sendExecute: vi.fn((sourceId: string, action: string) =>
      executes.push({ sourceId, action }),
    ),
    connect: vi.fn(),
    disconnect: vi.fn(),
    _emitData(sourceId: string, key: string, value: unknown) {
      dataListeners.forEach((cb) => {
        cb(sourceId, key, value);
      });
    },
    _emitStatus(sourceId: string, status: string) {
      statusListeners.forEach((cb) => {
        cb(sourceId, status);
      });
    },
    executes,
  };
}

// ---------------------------------------------------------------------------
// PeerBroadcastingDataSource
// ---------------------------------------------------------------------------

describe("PeerBroadcastingDataSource", () => {
  it("broadcasts schema keys independently of UI subscriptions", () => {
    const real = makeRealSource("test-source", ["v.altitude", "v.speed"]);
    const host = makeFakeHost();
    new PeerBroadcastingDataSource(real, host as never);

    // No UI component has subscribed — broadcast still fires
    real._emit("v.altitude", 12345);

    expect(host.broadcasts).toContainEqual(
      expect.objectContaining({
        type: "data",
        sourceId: "test-source",
        key: "v.altitude",
        value: 12345,
      }),
    );
  });

  it("broadcasts all schema keys, not just subscribed ones", () => {
    const real = makeRealSource("test-source", ["v.altitude", "v.speed"]);
    const host = makeFakeHost();
    new PeerBroadcastingDataSource(real, host as never);

    // Only one key emits — both should be set up but only one fires
    real._emit("v.speed", 999);

    const speedBroadcasts = host.broadcasts.filter(
      (m) => m.type === "data" && m.key === "v.speed",
    );
    expect(speedBroadcasts).toHaveLength(1);
  });

  it("subscribe is a clean pass-through — local cb gets value, no double broadcast", () => {
    const real = makeRealSource("test-source", ["v.altitude"]);
    const host = makeFakeHost();
    const wrapper = new PeerBroadcastingDataSource(real, host as never);

    const received: unknown[] = [];
    wrapper.subscribe("v.altitude", (v) => received.push(v));

    real._emit("v.altitude", 500);

    // Local subscriber receives value
    expect(received).toEqual([500]);
    // Exactly one broadcast (from the schema subscription, not from subscribe())
    const altBroadcasts = host.broadcasts.filter(
      (m) => m.type === "data" && m.key === "v.altitude",
    );
    expect(altBroadcasts).toHaveLength(1);
  });

  it("unsubscribing local cb stops local delivery but broadcast continues", () => {
    const real = makeRealSource("test-source", ["v.altitude"]);
    const host = makeFakeHost();
    const wrapper = new PeerBroadcastingDataSource(real, host as never);

    const received: unknown[] = [];
    const unsub = wrapper.subscribe("v.altitude", (v) => received.push(v));

    real._emit("v.altitude", 1);
    unsub();
    real._emit("v.altitude", 2); // broadcast still fires, local cb does not

    expect(received).toEqual([1]);
    const altBroadcasts = host.broadcasts.filter(
      (m) => m.type === "data" && m.key === "v.altitude",
    );
    expect(altBroadcasts).toHaveLength(2); // both emits broadcast
  });

  it("broadcasts status changes from the real source", () => {
    const real = makeRealSource("test-source", []);
    const host = makeFakeHost();
    new PeerBroadcastingDataSource(real, host as never);

    real._emitStatus("disconnected");

    expect(host.broadcasts).toContainEqual({
      type: "status",
      sourceId: "test-source",
      status: "disconnected",
    });
  });

  it("keeps broadcasting across disconnect/connect cycles (StrictMode survives)", async () => {
    const real = makeRealSource("test-source", ["v.altitude"]);
    const host = makeFakeHost();
    const wrapper = new PeerBroadcastingDataSource(real, host as never);

    // Simulate MainScreen StrictMode: mount → unmount → mount
    await wrapper.connect();
    wrapper.disconnect();
    await wrapper.connect();

    // After reconnect, a value should still broadcast. Prior implementation
    // detached broadcast subs in disconnect() and never rehooked them.
    real._emit("v.altitude", 1234);

    const altBroadcasts = host.broadcasts.filter(
      (m) => m.type === "data" && m.key === "v.altitude",
    );
    expect(altBroadcasts).toHaveLength(1);
    expect(altBroadcasts[0]).toEqual(
      expect.objectContaining({
        type: "data",
        sourceId: "test-source",
        key: "v.altitude",
        value: 1234,
      }),
    );
  });

  it("delegates id, name, status, schema, execute to the real source", async () => {
    const real = makeRealSource("my-id", ["v.altitude"]);
    const host = makeFakeHost();
    const wrapper = new PeerBroadcastingDataSource(real, host as never);

    expect(wrapper.id).toBe("my-id");
    expect(wrapper.name).toBe("Test Source");
    expect(wrapper.status).toBe("connected");
    expect(wrapper.schema()).toEqual([{ key: "v.altitude" }]);

    await wrapper.execute("toggle");
    expect(real.execute).toHaveBeenCalledWith("toggle");
  });

  it("forwards queryRange + subscribeSamples to the real source when present", async () => {
    const real = makeRealSource("buf", ["v.altitude"]) as ReturnType<
      typeof makeRealSource
    > & {
      queryRange: ReturnType<typeof vi.fn>;
      subscribeSamples: ReturnType<typeof vi.fn>;
    };
    real.queryRange = vi.fn().mockResolvedValue({ t: [1, 2], v: [10, 20] });
    const sampleSubs = new Set<(s: { t: number; v: unknown }) => void>();
    real.subscribeSamples = vi.fn(
      (_key: string, cb: (s: { t: number; v: unknown }) => void) => {
        sampleSubs.add(cb);
        return () => sampleSubs.delete(cb);
      },
    );
    const host = makeFakeHost();
    const wrapper = new PeerBroadcastingDataSource(real, host as never);

    const range = await wrapper.queryRange("v.altitude", 0, 100);
    expect(real.queryRange).toHaveBeenCalledWith(
      "v.altitude",
      0,
      100,
      undefined,
    );
    expect(range).toEqual({ t: [1, 2], v: [10, 20] });

    // flightId must round-trip — without it, FlightGraph falls back to the
    // detector's "current" flight and silently returns empty for any
    // historical flight that isn't currently live.
    await wrapper.queryRange("v.altitude", 0, 100, "flight-42");
    expect(real.queryRange).toHaveBeenLastCalledWith(
      "v.altitude",
      0,
      100,
      "flight-42",
    );

    const received: Array<{ t: number; v: unknown }> = [];
    wrapper.subscribeSamples("v.altitude", (s) => received.push(s));
    sampleSubs.forEach((cb) => {
      cb({ t: 42, v: 99 });
    });
    expect(received).toEqual([{ t: 42, v: 99 }]);
  });

  it("returns empty range + falls back to subscribe when the real source lacks the extensions", async () => {
    const real = makeRealSource("raw", ["v.altitude"]);
    const host = makeFakeHost();
    const wrapper = new PeerBroadcastingDataSource(real, host as never);

    const range = await wrapper.queryRange("v.altitude", 0, 100);
    expect(range).toEqual({ t: [], v: [] });

    const received: Array<{ t: number; v: unknown }> = [];
    wrapper.subscribeSamples("v.altitude", (s) => received.push(s));
    real._emit("v.altitude", 500);
    expect(received).toHaveLength(1);
    expect(received[0].v).toBe(500);
  });
});

// ---------------------------------------------------------------------------
// PeerClientDataSource
// ---------------------------------------------------------------------------

describe("PeerClientDataSource", () => {
  let client: ReturnType<typeof makeFakeClient>;
  let source: PeerClientDataSource;

  beforeEach(() => {
    client = makeFakeClient();
    source = new PeerClientDataSource("tel", "Telemachus", client as never);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("routes incoming data to subscribers for matching sourceId", () => {
    const received: unknown[] = [];
    source.subscribe("v.altitude", (v) => received.push(v));

    client._emitData("tel", "v.altitude", 500);

    expect(received).toEqual([500]);
  });

  it("ignores data for a different sourceId", () => {
    const received: unknown[] = [];
    source.subscribe("v.altitude", (v) => received.push(v));

    client._emitData("other", "v.altitude", 999);

    expect(received).toEqual([]);
  });

  it("routes incoming status to onStatusChange listeners", () => {
    const statuses: DataSourceStatus[] = [];
    source.onStatusChange((s) => statuses.push(s));

    client._emitStatus("tel", "reconnecting");

    expect(statuses).toEqual(["reconnecting"]);
    expect(source.status).toBe("reconnecting");
  });

  it("ignores status for a different sourceId", () => {
    const statuses: string[] = [];
    source.onStatusChange((s) => statuses.push(s));

    client._emitStatus("other", "disconnected");

    expect(statuses).toEqual([]);
  });

  it("sets status to connected on connect()", async () => {
    const statuses: DataSourceStatus[] = [];
    source.onStatusChange((s) => statuses.push(s));

    await source.connect();

    expect(source.status).toBe("connected");
    expect(statuses).toEqual(["connected"]);
  });

  it("forwards execute to client.sendExecute with the correct sourceId", async () => {
    await source.execute("toggleSAS");

    expect(client.sendExecute).toHaveBeenCalledWith("tel", "toggleSAS");
  });

  it("unsubscribing stops delivery", () => {
    const received: unknown[] = [];
    const unsub = source.subscribe("v.altitude", (v) => received.push(v));

    client._emitData("tel", "v.altitude", 1);
    unsub();
    client._emitData("tel", "v.altitude", 2);

    expect(received).toEqual([1]);
  });
});
