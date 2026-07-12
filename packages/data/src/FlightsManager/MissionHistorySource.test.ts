import type { ReplayFixture } from "@ksp-gonogo/sitrep-client";
import type { ServerMessage } from "@ksp-gonogo/sitrep-sdk";
import { Quality, Staleness } from "@ksp-gonogo/sitrep-sdk";
import { describe, expect, it } from "vitest";
import type { MissionMeta, MissionRecord } from "../storage/MissionStore";
import { MissionStore } from "../storage/MissionStore";
import { MissionHistorySource } from "./MissionHistorySource";

// fake-indexeddb is installed via setupFiles (src/test/setup.ts).

let dbCounter = 0;

function frame(topic: string, payload: unknown, deliveredAt: number): string {
  const message: ServerMessage = {
    type: "stream-data",
    topic,
    payload,
    meta: {
      source: "stub",
      validAt: deliveredAt,
      seq: 0,
      deliveredAt,
      vantage: "stub",
      quality: Quality.OnRails,
      active: false,
      staleness: Staleness.Fresh,
      timelineEpoch: 0,
    },
  };
  return JSON.stringify(message);
}

function longFixture(): ReplayFixture {
  return {
    subscribedTopics: ["vessel.state"],
    frames: [
      frame("vessel.state", { altitudeAsl: 100 }, 0),
      frame("vessel.state", { altitudeAsl: 5000 }, 400), // > 300s past the first point
      frame("vessel.state", { altitudeAsl: 70000 }, 900),
    ],
  };
}

function mission(overrides: Partial<MissionMeta> = {}): MissionRecord {
  const meta: MissionMeta = {
    id: "m1",
    vesselName: "Kerbal X",
    launchedAt: 1_000_000,
    firstFrameUt: 0,
    lastFrameUt: 900,
    frameCount: 3,
    ...overrides,
  };
  return { meta, fixture: longFixture() };
}

function freshSource(): {
  source: MissionHistorySource;
  store: MissionStore;
} {
  dbCounter += 1;
  const store = new MissionStore({
    dbName: `gonogo-missions-history-test-${dbCounter}`,
  });
  return { source: new MissionHistorySource(store), store };
}

describe("MissionHistorySource", () => {
  describe("schema", () => {
    it("includes a known Telemachus key with its enriched label/unit", () => {
      const { source } = freshSource();
      const schema = source.schema();
      const altitude = schema.find((k) => k.key === "v.altitude");
      expect(altitude).toMatchObject({ label: "Altitude", unit: "m" });
    });

    it("excludes known-gap keys that have no stream equivalent", () => {
      const { source } = freshSource();
      const schema = source.schema();
      expect(schema.some((k) => k.key === "t.universalTime")).toBe(false);
    });
  });

  describe("listFlights", () => {
    it("maps MissionMeta onto a FlightRecord-shaped record", async () => {
      const { source, store } = freshSource();
      await store.saveMission(
        mission({
          starred: true,
          chapters: [{ id: "c1", label: "Ascent", startMs: 0, endMs: 30_000 }],
        }),
      );

      const [flight] = await source.listFlights();
      expect(flight.id).toBe("m1");
      expect(flight.vesselName).toBe("Kerbal X");
      expect(flight.starred).toBe(true);
      expect(flight.chapters).toEqual([
        { id: "c1", label: "Ascent", startMs: 0, endMs: 30_000 },
      ]);
      expect(flight.lastSampleAt).toBe(1_000_000 + 900_000);
      expect(flight.firstFrameUt).toBe(0);
      expect(flight.lastFrameUt).toBe(900);
      expect(flight.outcome).toBeUndefined();
    });
  });

  describe("queryRange", () => {
    it("returns every point across a span exceeding the 300s live-store retention window", async () => {
      const { source, store } = freshSource();
      await store.saveMission(mission());

      const range = await source.queryRange("v.altitude", 0, 900, "m1");
      expect(range.t).toEqual([0, 400, 900]);
      expect(range.v).toEqual([100, 5000, 70000]);
    });

    it("returns empty when missionId is omitted", async () => {
      const { source, store } = freshSource();
      await store.saveMission(mission());
      expect(await source.queryRange("v.altitude", 0, 900)).toEqual({
        t: [],
        v: [],
      });
    });

    it("returns empty for a key with no stream mapping", async () => {
      const { source, store } = freshSource();
      await store.saveMission(mission());
      expect(await source.queryRange("not.a.real.key", 0, 900, "m1")).toEqual({
        t: [],
        v: [],
      });
    });

    it("memoizes the full-history store per missionId, still correct after eviction", async () => {
      const { source, store } = freshSource();
      await store.saveMission(mission());

      const first = await source.queryRange("v.altitude", 0, 900, "m1");
      source.evictFullHistoryStore("m1");
      const second = await source.queryRange("v.altitude", 0, 900, "m1");
      expect(second).toEqual(first);
    });
  });

  describe("saveMission", () => {
    it("persists the mission and fires onFlightListChange", async () => {
      const { source } = freshSource();
      const changes: number[] = [];
      source.onFlightListChange(() => changes.push(1));

      await source.saveMission(mission());

      expect(changes.length).toBe(1);
      const [flight] = await source.listFlights();
      expect(flight.id).toBe("m1");
    });
  });

  describe("star / chapters / delete", () => {
    it("setFlightStarred persists and fires onFlightListChange", async () => {
      const { source, store } = freshSource();
      await store.saveMission(mission());
      const changes: number[] = [];
      source.onFlightListChange(() => changes.push(1));

      await source.setFlightStarred("m1", true);
      expect(changes.length).toBe(1);
      const [flight] = await source.listFlights();
      expect(flight.starred).toBe(true);
    });

    it("addChapter / updateChapter / removeChapter round-trip", async () => {
      const { source, store } = freshSource();
      await store.saveMission(mission());

      const added = await source.addChapter("m1", {
        label: "Ascent",
        startMs: 0,
        endMs: 30_000,
      });
      expect(added?.chapters).toHaveLength(1);
      const chapterId = added?.chapters?.[0]?.id;
      expect(chapterId).toBeTruthy();

      const updated = await source.updateChapter("m1", chapterId as string, {
        label: "Ascent phase",
      });
      expect(updated?.chapters?.[0]?.label).toBe("Ascent phase");

      const removed = await source.removeChapter("m1", chapterId as string);
      expect(removed?.chapters).toEqual([]);
    });

    it("addChapter returns null for an unknown mission", async () => {
      const { source } = freshSource();
      const result = await source.addChapter("nope", {
        label: "x",
        startMs: 0,
        endMs: 1,
      });
      expect(result).toBeNull();
    });

    it("deleteFlight removes the mission and evicts its history cache entry", async () => {
      const { source, store } = freshSource();
      await store.saveMission(mission());
      await source.queryRange("v.altitude", 0, 900, "m1"); // populate cache
      await source.deleteFlight("m1");
      expect(await source.listFlights()).toEqual([]);
    });

    it("clearAllFlights empties the store", async () => {
      const { source, store } = freshSource();
      await store.saveMission(mission({ id: "a" }));
      await store.saveMission(mission({ id: "b" }));
      await source.clearAllFlights();
      expect(await source.listFlights()).toEqual([]);
    });
  });

  describe("pruneFlightsKeepLatest", () => {
    it("delegates to MissionStore.pruneMissionsKeepLatest", async () => {
      const { source, store } = freshSource();
      await store.saveMission(mission({ id: "a", launchedAt: 100 }));
      await store.saveMission(mission({ id: "b", launchedAt: 200 }));

      const removed = await source.pruneFlightsKeepLatest({ keepCount: 1 });
      expect(removed).toEqual(["a"]);
      const remaining = (await source.listFlights()).map((f) => f.id);
      expect(remaining).toEqual(["b"]);
    });
  });

  it("is registered with a fresh id, distinct from the legacy 'data' source", () => {
    const { source } = freshSource();
    expect(source.id).toBe("missionHistory");
  });
});
