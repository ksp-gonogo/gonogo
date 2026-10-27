import {
  type ClientMessage,
  fieldsSentOnChange,
  type ServerMessage,
} from "@ksp-gonogo/sitrep-sdk";
import { describe, expect, it, vi } from "vitest";
import { TelemetryClient } from "./client";
import { makeMeta, StubTransport } from "./stub-transport";
import { TimelineStore } from "./timeline-store";
import { ViewClock } from "./view-clock";

function recording() {
  const transport = new StubTransport();
  const sent: ClientMessage[] = [];
  vi.spyOn(transport, "send").mockImplementation((message) => {
    sent.push(message);
  });
  const rates = () =>
    sent.filter(
      (message): message is Extract<ClientMessage, { type: "set-rate" }> =>
        message.type === "set-rate",
    );
  return { transport, sent, rates };
}

describe("TelemetryClient.requestRate", () => {
  it("asks for the fast tier only once the topic is subscribed, after the subscribe", () => {
    const { transport, sent, rates } = recording();
    const client = new TelemetryClient(transport);

    const release = client.requestRate("vessel.flight", "fast");
    expect(rates()).toEqual([]);

    client.subscribe("vessel.flight", () => {});
    const subscribeAt = sent.findIndex(
      (m) => m.type === "subscribe" && m.topic === "vessel.flight",
    );
    const rateAt = sent.findIndex((m) => m.type === "set-rate");
    expect(rateAt).toBeGreaterThan(subscribeAt);
    expect(rates()).toEqual([
      { type: "set-rate", topic: "vessel.flight", tier: "fast" },
    ]);

    release();
    expect(rates().at(-1)).toEqual({
      type: "set-rate",
      topic: "vessel.flight",
      tier: "base",
    });
  });

  it("holds the fast tier until the last claim on the topic is released", () => {
    const { transport, rates } = recording();
    const client = new TelemetryClient(transport);
    client.subscribe("vessel.landing", () => {});

    const first = client.requestRate("vessel.landing", "fast");
    const second = client.requestRate("vessel.landing", "fast");
    expect(rates()).toHaveLength(1);

    first();
    first();
    expect(rates()).toHaveLength(1);
    expect(client.claimedTier("vessel.landing")).toBe("fast");

    second();
    expect(rates()).toHaveLength(2);
    expect(client.claimedTier("vessel.landing")).toBe("base");
  });

  it("asks again when the topic is subscribed again, since the mod forgets the tier on unsubscribe", () => {
    const { transport, rates } = recording();
    const client = new TelemetryClient(transport);
    client.requestRate("vessel.flight", "fast");

    const off = client.subscribe("vessel.flight", () => {});
    off();
    client.subscribe("vessel.flight", () => {});

    expect(rates()).toEqual([
      { type: "set-rate", topic: "vessel.flight", tier: "fast" },
      { type: "set-rate", topic: "vessel.flight", tier: "fast" },
    ]);
  });

  it("follows the rate report while any claim is live", () => {
    const { transport, sent } = recording();
    const client = new TelemetryClient(transport);

    const release = client.requestRate("vessel.flight", "fast");
    expect(sent).toContainEqual({
      type: "subscribe",
      topic: "system.dataRates",
    });

    release();
    expect(sent).toContainEqual({
      type: "unsubscribe",
      topic: "system.dataRates",
    });
  });

  it("a base claim asks for nothing", () => {
    const { transport, sent } = recording();
    const client = new TelemetryClient(transport);
    client.subscribe("vessel.flight", () => {});
    const before = sent.length;

    client.requestRate("vessel.flight", "base")();

    expect(sent).toHaveLength(before);
  });
});

describe("TimelineStore point bound under a faster rate", () => {
  const report = (flightRate: number) => ({
    tiers: [
      { tier: "base" as const, samplesPerSecond: 1 },
      { tier: "fast" as const, samplesPerSecond: flightRate },
    ],
    topics:
      flightRate > 1
        ? [
            {
              topic: "vessel.flight",
              tier: "fast" as const,
              samplesPerSecond: flightRate,
            },
          ]
        : [],
  });

  function ingestRun(store: TimelineStore, count: number, rate: number) {
    for (let i = 0; i < count; i++) {
      store.ingest("vessel.flight", {
        validAt: 1000 + i / rate,
        epoch: 0,
        payload: { altitude: i } as unknown,
        meta: makeMeta({ validAt: 1000 + i / rate }),
      });
    }
  }

  it("keeps the same span of game time when a Topic arrives ten times faster", () => {
    const store = new TimelineStore(
      new ViewClock({ delaySeconds: () => 0, warpRate: () => 1 }),
      { timelineOptions: { maxPoints: 100 } },
    );
    store.ingest("system.dataRates", {
      validAt: 999,
      epoch: 0,
      payload: report(10),
      meta: makeMeta({ validAt: 999 }),
    });

    ingestRun(store, 1500, 10);

    const points = store.getTimeline("vessel.flight").range(0, 1e9);
    expect(points).toHaveLength(1000);
    expect((points.at(-1)?.validAt ?? 0) - points[0].validAt).toBeCloseTo(
      99.9,
      6,
    );
  });

  it("shrinks back to the base bound when the Topic drops to the base rate", () => {
    const store = new TimelineStore(
      new ViewClock({ delaySeconds: () => 0, warpRate: () => 1 }),
      { timelineOptions: { maxPoints: 100 } },
    );
    store.ingest("system.dataRates", {
      validAt: 999,
      epoch: 0,
      payload: report(10),
      meta: makeMeta({ validAt: 999 }),
    });
    ingestRun(store, 500, 10);

    store.ingest("system.dataRates", {
      validAt: 1100,
      epoch: 0,
      payload: report(1),
      meta: makeMeta({ validAt: 1100 }),
    });

    expect(store.getTimeline("vessel.flight").range(0, 1e9)).toHaveLength(100);
  });
});

describe("a frame that leaves fields out as unchanged", () => {
  function landing(payload: object, validAt: number, unchanged?: string[]) {
    return {
      type: "stream-data",
      topic: "vessel.landing",
      payload,
      meta: makeMeta({ validAt, deliveredAt: validAt }),
      ...(unchanged ? { unchanged } : {}),
    } satisfies ServerMessage;
  }

  it("names the terrain grid and skyline as the fields vessel.landing sends on change", () => {
    expect(fieldsSentOnChange("vessel.landing")).toEqual([
      "siteHeights",
      "horizonAngles",
    ]);
    expect(fieldsSentOnChange("vessel.flight")).toEqual([]);
  });

  it("reads with the fields the last frame of its Topic carried, raw listeners included", () => {
    const transport = new StubTransport();
    const client = new TelemetryClient(transport);
    const read: unknown[] = [];
    const raw: unknown[] = [];
    client.subscribe("vessel.landing", (payload) => read.push(payload));
    client.onRawMessage((message) => {
      if (message.type === "stream-data") raw.push(message);
    });
    const grid = [1, 2, 3];
    const skyline = [4, 5];

    transport.emitRaw(
      landing({ outcome: "a", siteHeights: grid, horizonAngles: skyline }, 1),
    );
    transport.emitRaw(
      landing({ outcome: "b" }, 2, ["siteHeights", "horizonAngles"]),
    );

    expect(read[1]).toEqual({
      outcome: "b",
      siteHeights: grid,
      horizonAngles: skyline,
    });
    expect(raw[1]).not.toHaveProperty("unchanged", expect.anything());
    expect(raw[1]).toHaveProperty("payload.siteHeights", grid);
  });

  it("leaves a field absent, not empty, when no earlier frame carried it", () => {
    const transport = new StubTransport();
    const client = new TelemetryClient(transport);
    const read: unknown[] = [];
    client.subscribe("vessel.landing", (payload) => read.push(payload));

    transport.emitRaw(landing({ outcome: "b" }, 2, ["siteHeights"]));

    expect(read[0]).toEqual({ outcome: "b" });
  });
});
