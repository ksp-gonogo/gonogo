import { setFlagsFromString } from "node:v8";
import { runInNewContext } from "node:vm";
import { wrapTopicPayload } from "@ksp-gonogo/sitrep-sdk";
import { describe, expect, it } from "vitest";
import landingSample from "./__fixtures__/vessel-landing.wire.json" with {
  type: "json",
};
import { makeMeta } from "./stub-transport";
import { TimelineStore } from "./timeline-store";
import { ViewClock } from "./view-clock";

setFlagsFromString("--expose-gc");
const exposedGc: unknown = runInNewContext("gc");
function gc(): void {
  if (typeof exposedGc !== "function") throw new Error("gc is not exposed");
  exposedGc();
}

/** One vessel.landing sample as the mod sent it on a descent, terrain included. */
const WIRE = JSON.stringify(landingSample);
const TERRAIN = [
  "siteHeights",
  "horizonAngles",
  "groundTrackDistances",
  "groundTrackElevations",
];
const RATE = 10;
/** 25 minutes at ten a second: the span the base bound keeps at one a second. */
const SAMPLES = 15_000;

/**
 * Feeds a descent's worth of vessel.landing at ten a second through a real
 * store the way the mod delivers it, each sample arriving `delaySeconds` after
 * it was true, and returns the heap the store then holds.
 */
function heldRun(delaySeconds: number) {
  let wall = 0;
  gc();
  const before = process.memoryUsage().heapUsed;
  const store = new TimelineStore(
    new ViewClock({
      delaySeconds: () => delaySeconds,
      warpRate: () => 1,
      nowWall: () => wall,
    }),
  );
  store.ingest("system.dataRates", {
    validAt: 999,
    epoch: 0,
    payload: {
      tiers: [
        { tier: "base", samplesPerSecond: 1 },
        { tier: "fast", samplesPerSecond: RATE },
      ],
      topics: [
        { topic: "vessel.landing", tier: "fast", samplesPerSecond: RATE },
      ],
    } as unknown,
    meta: makeMeta({ validAt: 999 }),
  });
  for (let i = 0; i < SAMPLES; i++) {
    const validAt = 1000 + i / RATE;
    wall = validAt + delaySeconds;
    store.ingest("vessel.landing", {
      validAt,
      epoch: 0,
      payload: wrapTopicPayload("vessel.landing", JSON.parse(WIRE)),
      meta: makeMeta({ validAt, deliveredAt: wall, seq: i }),
    });
  }
  gc();
  const megabytes = (process.memoryUsage().heapUsed - before) / 1e6;
  return { store, megabytes };
}

function hasTerrain(payload: unknown): boolean {
  return (
    typeof payload === "object" &&
    payload !== null &&
    TERRAIN.some((field) => field in payload)
  );
}

describe("vessel.landing history at ten a second", () => {
  it("holds about 45 MB over 25 minutes, terrain on the newest sample alone, the scalars over the whole span", () => {
    const { store, megabytes } = heldRun(0);

    const points = store.getTimeline("vessel.landing").range(0, 1e9);
    expect(points).toHaveLength(SAMPLES);
    expect((points.at(-1)?.validAt ?? 0) - points[0].validAt).toBeCloseTo(
      1499.9,
      6,
    );
    const carrying = points.filter((point) => hasTerrain(point.payload));
    expect(carrying).toEqual([points.at(-1)]);
    expect(points[0].payload).toHaveProperty("predictedLatitude");

    // A sample is about 61 KB with its terrain and 2.8 KB without, so keeping every sample whole would hold about 0.9 GB.
    expect(megabytes).toBeGreaterThan(30);
    expect(megabytes).toBeLessThan(60);
  }, 120_000);

  it("holds no more under a minute of signal delay, since the mod sends each sample once it is due", () => {
    const undelayed = heldRun(0).megabytes;
    const { store, megabytes } = heldRun(60);

    const points = store.getTimeline("vessel.landing").range(0, 1e9);
    expect(points.filter((point) => hasTerrain(point.payload))).toEqual([
      points.at(-1),
    ]);
    expect(Math.abs(megabytes - undelayed)).toBeLessThan(5);
  }, 120_000);
});
