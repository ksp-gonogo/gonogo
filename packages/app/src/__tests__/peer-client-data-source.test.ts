import { describe, expect, it, vi } from "vitest";
import { PeerClientDataSource } from "../peer/PeerClientDataSource";
import type { PeerClientService } from "../peer/PeerClientService";

interface FakeClient {
  emitData: (sourceId: string, key: string, value: unknown, t: number) => void;
  emitStatus: (sourceId: string, status: string) => void;
  lastQuery: {
    sourceId: string;
    key: string;
    tStart: number;
    tEnd: number;
    flightId?: string;
  } | null;
  service: PeerClientService;
}

function makeFakeClient(
  queryImpl?: () => Promise<{ t: number[]; v: unknown[] }>,
): FakeClient {
  let dataCb:
    | ((sourceId: string, key: string, value: unknown, t: number) => void)
    | null = null;
  let statusCb: ((sourceId: string, status: string) => void) | null = null;
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
    lastQuery: null,
  };
  return {
    service: fake as unknown as PeerClientService,
    emitData: (sourceId, key, value, t) => dataCb?.(sourceId, key, value, t),
    emitStatus: (sourceId, status) => statusCb?.(sourceId, status),
    get lastQuery() {
      return fake.lastQuery;
    },
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

    // Nothing seen yet — readers that snapshot synchronously (useKosWidget
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
});
