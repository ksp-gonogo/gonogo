import type { FlightRecord } from "@ksp-gonogo/data";
import { describe, expect, it, vi } from "vitest";
import { PeerClientDataSource } from "../peer/PeerClientDataSource";
import type { PeerClientService } from "../peer/PeerClientService";
import type { FlightRpcOp } from "../peer/protocol";

interface FakeClient {
  emitData: (sourceId: string, key: string, value: unknown, t: number) => void;
  emitStatus: (sourceId: string, status: string) => void;
  emitFlightChange: (flight: FlightRecord | null) => void;
  setCurrentFlight: (flight: FlightRecord | null) => void;
  lastQuery: {
    sourceId: string;
    key: string;
    tStart: number;
    tEnd: number;
    flightId?: string;
  } | null;
  flightOps: FlightRpcOp[];
  service: PeerClientService;
}

function makeFakeClient(
  queryImpl?: () => Promise<{ t: number[]; v: unknown[] }>,
  flightRpcImpl?: (op: FlightRpcOp) => Promise<unknown>,
): FakeClient {
  let dataCb:
    | ((sourceId: string, key: string, value: unknown, t: number) => void)
    | null = null;
  let statusCb: ((sourceId: string, status: string) => void) | null = null;
  const flightChangeListeners = new Set<
    (flight: FlightRecord | null) => void
  >();
  let currentFlight: FlightRecord | null = null;
  const flightOps: FlightRpcOp[] = [];
  const fake: Partial<PeerClientService> & {
    lastQuery: FakeClient["lastQuery"];
  } = {
    onData: (cb) => {
      dataCb = cb;
      return () => {
        dataCb = null;
        return true;
      };
    },
    onSourceStatus: (cb) => {
      statusCb = cb;
      return () => {
        statusCb = null;
        return true;
      };
    },
    sendExecute: vi.fn(),
    sendQueryRange: vi.fn(async (sourceId, key, tStart, tEnd, flightId) => {
      fake.lastQuery = { sourceId, key, tStart, tEnd, flightId };
      return queryImpl
        ? queryImpl()
        : ({ t: [], v: [] } as { t: number[]; v: unknown[] });
    }),
    sendFlightRpc: vi.fn(async (op: FlightRpcOp) => {
      flightOps.push(op);
      return (flightRpcImpl ? await flightRpcImpl(op) : null) as never;
    }),
    getCurrentFlight: () => currentFlight,
    onFlightChange: (cb) => {
      flightChangeListeners.add(cb);
      cb(currentFlight);
      return () => {
        flightChangeListeners.delete(cb);
        return true;
      };
    },
    lastQuery: null,
  };
  return {
    service: fake as unknown as PeerClientService,
    emitData: (sourceId, key, value, t) => dataCb?.(sourceId, key, value, t),
    emitStatus: (sourceId, status) => statusCb?.(sourceId, status),
    emitFlightChange: (flight) => {
      currentFlight = flight;
      flightChangeListeners.forEach((cb) => {
        cb(flight);
      });
    },
    setCurrentFlight: (flight) => {
      currentFlight = flight;
    },
    get lastQuery() {
      return fake.lastQuery;
    },
    flightOps,
  } as FakeClient;
}

describe("PeerClientDataSource", () => {
  it("fires subscribe callbacks with the raw value", () => {
    const fake = makeFakeClient();
    const source = new PeerClientDataSource("data", "Data", fake.service);
    const received: unknown[] = [];
    source.subscribe("v.altitude", (v) => received.push(v));

    fake.emitData("data", "v.altitude", 1234, 5000);
    expect(received).toEqual([1234]);
  });

  it("ignores samples from other sources", () => {
    const fake = makeFakeClient();
    const source = new PeerClientDataSource("data", "Data", fake.service);
    const received: unknown[] = [];
    source.subscribe("v.altitude", (v) => received.push(v));

    fake.emitData("telemachus", "v.altitude", 99, 5000);
    expect(received).toEqual([]);
  });

  it("subscribeSamples fires with host timestamp from the broadcast", () => {
    const fake = makeFakeClient();
    const source = new PeerClientDataSource("data", "Data", fake.service);
    const samples: Array<{ t: number; v: unknown }> = [];
    source.subscribeSamples("v.altitude", (s) => samples.push(s));

    fake.emitData("data", "v.altitude", 100, 5000);
    fake.emitData("data", "v.altitude", 200, 5500);
    expect(samples).toEqual([
      { t: 5000, v: 100 },
      { t: 5500, v: 200 },
    ]);
  });

  it("subscribeSamples unsubscribe stops further deliveries", () => {
    const fake = makeFakeClient();
    const source = new PeerClientDataSource("data", "Data", fake.service);
    const samples: Array<{ t: number; v: unknown }> = [];
    const unsub = source.subscribeSamples("v.altitude", (s) => samples.push(s));

    fake.emitData("data", "v.altitude", 1, 1000);
    unsub();
    fake.emitData("data", "v.altitude", 2, 2000);
    expect(samples).toEqual([{ t: 1000, v: 1 }]);
  });

  it("queryRange delegates to client.sendQueryRange and passes all args through", async () => {
    const fake = makeFakeClient(async () => ({
      t: [100, 200],
      v: [1, 2],
    }));
    const source = new PeerClientDataSource("data", "Data", fake.service);

    const range = await source.queryRange("v.altitude", 0, 999, "flight-7");

    expect(range).toEqual({ t: [100, 200], v: [1, 2] });
    expect(fake.lastQuery).toEqual({
      sourceId: "data",
      key: "v.altitude",
      tStart: 0,
      tEnd: 999,
      flightId: "flight-7",
    });
  });

  it("queryRange propagates the client's rejection", async () => {
    const fake = makeFakeClient(async () => {
      throw new Error("queryRange timeout");
    });
    const source = new PeerClientDataSource("data", "Data", fake.service);

    await expect(source.queryRange("v.altitude", 0, 1)).rejects.toThrow(
      /queryRange timeout/,
    );
  });

  it("setSchema caches the host's enriched schema and returns it from schema()", () => {
    const fake = makeFakeClient();
    const source = new PeerClientDataSource("data", "Data", fake.service);

    // Before the schema message arrives, station-side config UIs see nothing.
    expect(source.schema()).toEqual([]);

    source.setSchema([
      { key: "v.altitude", label: "Altitude", unit: "m", group: "Position" },
      { key: "v.lat", label: "Latitude", unit: "°", group: "Position" },
    ]);

    const schema = source.schema();
    expect(schema).toHaveLength(2);
    // Critically, the label/unit/group are preserved — this is what drives
    // the MapView config's grouped, searchable key picker on a station.
    expect(schema[0]).toMatchObject({
      key: "v.altitude",
      label: "Altitude",
      unit: "m",
      group: "Position",
    });
  });

  it("getLatestValue returns undefined before any data, then the most recent value", () => {
    const fake = makeFakeClient();
    const source = new PeerClientDataSource("data", "Data", fake.service);

    // Nothing seen yet — readers that snapshot synchronously (a widget
    // resolving a telemetry arg at dispatch time) get undefined.
    expect(source.getLatestValue("v.altitude")).toBeUndefined();

    fake.emitData("data", "v.altitude", 1000, 5000);
    expect(source.getLatestValue("v.altitude")).toBe(1000);

    fake.emitData("data", "v.altitude", 2500, 5500);
    expect(source.getLatestValue("v.altitude")).toBe(2500);

    // Unrelated key isn't polluted.
    expect(source.getLatestValue("v.lat")).toBeUndefined();
  });

  it("ignores samples from a different sourceId when caching latest values", () => {
    const fake = makeFakeClient();
    const source = new PeerClientDataSource("data", "Data", fake.service);

    fake.emitData("other-source", "v.altitude", 999, 5000);
    expect(source.getLatestValue("v.altitude")).toBeUndefined();
  });

  it("subscribeCollection sends ONE batched peer-data-subscribe per call", () => {
    const fake = makeFakeClient();
    // biome-ignore lint/suspicious/noExplicitAny: extend the fake on the fly
    (fake.service as any).sendDataSubscribe = vi.fn();
    // biome-ignore lint/suspicious/noExplicitAny: extend the fake on the fly
    (fake.service as any).sendDataUnsubscribe = vi.fn();

    const source = new PeerClientDataSource("data", "Data", fake.service);
    const unsub = source.subscribeCollection(
      ["v.altitude", "v.surfaceVelocity", "v.verticalSpeed"],
      () => {},
    );

    // Three keys, one wire message — not three.
    // biome-ignore lint/suspicious/noExplicitAny: same as above
    expect((fake.service as any).sendDataSubscribe).toHaveBeenCalledTimes(1);
    // biome-ignore lint/suspicious/noExplicitAny: same as above
    expect((fake.service as any).sendDataSubscribe).toHaveBeenCalledWith(
      "data",
      ["v.altitude", "v.surfaceVelocity", "v.verticalSpeed"],
    );

    unsub();
    // Tear-down also batches into one peer-data-unsubscribe.
    // biome-ignore lint/suspicious/noExplicitAny: same as above
    expect((fake.service as any).sendDataUnsubscribe).toHaveBeenCalledTimes(1);
    // biome-ignore lint/suspicious/noExplicitAny: same as above
    expect((fake.service as any).sendDataUnsubscribe).toHaveBeenCalledWith(
      "data",
      ["v.altitude", "v.surfaceVelocity", "v.verticalSpeed"],
    );
  });

  it("subscribe + subscribeCollection share refcount — overlapping keys don't double-emit", () => {
    const fake = makeFakeClient();
    // biome-ignore lint/suspicious/noExplicitAny: extend the fake on the fly
    (fake.service as any).sendDataSubscribe = vi.fn();
    // biome-ignore lint/suspicious/noExplicitAny: extend the fake on the fly
    (fake.service as any).sendDataUnsubscribe = vi.fn();

    const source = new PeerClientDataSource("data", "Data", fake.service);
    const unsubA = source.subscribe("v.altitude", () => {});
    const unsubGroup = source.subscribeCollection(
      ["v.altitude", "v.surfaceVelocity"],
      () => {},
    );

    // First subscribe sends ["v.altitude"]; the collection picks up the
    // already-subscribed altitude (no new wire message for it) and only
    // sends ["v.surfaceVelocity"].
    // biome-ignore lint/suspicious/noExplicitAny: same as above
    expect((fake.service as any).sendDataSubscribe).toHaveBeenCalledTimes(2);
    // biome-ignore lint/suspicious/noExplicitAny: same as above
    expect((fake.service as any).sendDataSubscribe).toHaveBeenNthCalledWith(
      1,
      "data",
      ["v.altitude"],
    );
    // biome-ignore lint/suspicious/noExplicitAny: same as above
    expect((fake.service as any).sendDataSubscribe).toHaveBeenNthCalledWith(
      2,
      "data",
      ["v.surfaceVelocity"],
    );

    // Tear down the collection — only v.surfaceVelocity hits zero refs.
    unsubGroup();
    // biome-ignore lint/suspicious/noExplicitAny: same as above
    expect((fake.service as any).sendDataUnsubscribe).toHaveBeenCalledWith(
      "data",
      ["v.surfaceVelocity"],
    );

    // Tearing down the individual subscribe drops altitude.
    unsubA();
    // biome-ignore lint/suspicious/noExplicitAny: same as above
    expect((fake.service as any).sendDataUnsubscribe).toHaveBeenLastCalledWith(
      "data",
      ["v.altitude"],
    );
  });

  // ── Flight history surface (proxied to host BufferedDataSource) ───────────

  it("getCurrentFlight + onFlightChange mirror the host's pushed snapshot", () => {
    const fake = makeFakeClient();
    const source = new PeerClientDataSource("data", "Data", fake.service);

    expect(source.getCurrentFlight()).toBeNull();

    const seen: Array<FlightRecord | null> = [];
    source.onFlightChange((f) => seen.push(f));
    // Subscribers fire immediately with the cached snapshot — null right now.
    expect(seen).toEqual([null]);

    const flight: FlightRecord = {
      id: "f1",
      vesselName: "Hopper",
      launchedAt: 1000,
      lastSampleAt: 1100,
      lastMissionTime: 100,
      sampleCount: 50,
    };
    fake.emitFlightChange(flight);

    expect(seen).toEqual([null, flight]);
    expect(source.getCurrentFlight()).toEqual(flight);

    fake.emitFlightChange(null);
    expect(seen[2]).toBeNull();
    expect(source.getCurrentFlight()).toBeNull();
  });

  it("listFlights / deleteFlight / setFlightStarred forward as flight-rpc ops", async () => {
    const flight: FlightRecord = {
      id: "f1",
      vesselName: "Hopper",
      launchedAt: 0,
      lastSampleAt: 1,
      lastMissionTime: 0,
      sampleCount: 1,
    };
    const fake = makeFakeClient(undefined, async (op) => {
      if (op.op === "list") return [flight];
      if (op.op === "delete") return null;
      if (op.op === "setStarred") return null;
      return null;
    });
    const source = new PeerClientDataSource("data", "Data", fake.service);

    await expect(source.listFlights()).resolves.toEqual([flight]);
    await expect(source.deleteFlight("f1")).resolves.toBeUndefined();
    await expect(source.setFlightStarred("f1", true)).resolves.toBeUndefined();

    expect(fake.flightOps).toEqual([
      { op: "list" },
      { op: "delete", id: "f1" },
      { op: "setStarred", id: "f1", starred: true },
    ]);
  });

  it("addChapter / updateChapter / removeChapter round-trip through flight-rpc", async () => {
    const flight: FlightRecord = {
      id: "f1",
      vesselName: "Hopper",
      launchedAt: 0,
      lastSampleAt: 1,
      lastMissionTime: 0,
      sampleCount: 1,
      chapters: [{ id: "c1", label: "Burn", startMs: 100, endMs: 200 }],
    };
    const fake = makeFakeClient(undefined, async () => flight);
    const source = new PeerClientDataSource("data", "Data", fake.service);

    await source.addChapter("f1", { label: "Burn", startMs: 100, endMs: 200 });
    await source.updateChapter("f1", "c1", { label: "Burn 2" });
    await source.removeChapter("f1", "c1");

    expect(fake.flightOps).toMatchObject([
      { op: "addChapter", flightId: "f1" },
      { op: "updateChapter", flightId: "f1", chapterId: "c1" },
      { op: "removeChapter", flightId: "f1", chapterId: "c1" },
    ]);
  });
});
