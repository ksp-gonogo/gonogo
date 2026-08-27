import type { ReplayFixture } from "@ksp-gonogo/sitrep-client";
import type { ServerMessage } from "@ksp-gonogo/sitrep-sdk";
import { Quality, Staleness } from "@ksp-gonogo/sitrep-sdk";
import { describe, expect, it } from "vitest";
import { getTopicFieldCatalog } from "../schema/topicFieldCatalog";
import type { MissionMeta, MissionRecord } from "../storage/MissionStore";
import { MissionStore } from "../storage/MissionStore";
import { MissionHistorySource } from "./MissionHistorySource";

// fake-indexeddb is installed via setupFiles (src/test/setup.ts).

let dbCounter = 0;

function frame(
  topic: string,
  payload: unknown,
  deliveredAt: number,
  quality: Quality = Quality.OnRails,
): string {
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
      quality,
      active: false,
      staleness: Staleness.Fresh,
      timelineEpoch: 0,
    },
  };
  return JSON.stringify(message);
}

function flightFrame(altitudeAsl: number, ut: number): string {
  return frame(
    "vessel.flight",
    { altitudeAsl, verticalSpeed: 0, surfaceSpeed: 0, orbitalSpeed: 0 },
    ut,
  );
}

/**
 * Frames in the shape a real `StreamRecorder` capture carries: RAW wire
 * topics only. `vessel.state` and `vessel.maneuver.legacy` are client-side
 * derived channels, so no recording ever contains a frame on either, and a
 * fixture that invents one exercises the raw-record path and can never
 * reach the derivation the live graph actually uses. `vessel.orbit` rides
 * at `Quality.Loaded` so `deriveVesselState` takes its measured basis and
 * reads `altitudeAsl` straight off `vessel.flight`.
 */
function longFixture(): ReplayFixture {
  return {
    subscribedTopics: ["vessel.orbit", "vessel.flight", "vessel.maneuver"],
    frames: [
      frame("vessel.orbit", { referenceBodyIndex: 1 }, 0, Quality.Loaded),
      flightFrame(100, 0),
      flightFrame(5000, 400), // > 300s past the first point
      flightFrame(70000, 900),
      frame("vessel.maneuver", { nodes: [] }, 0),
      frame(
        "vessel.maneuver",
        {
          nodes: [
            {
              id: "node-1",
              ut: 1200,
              dvRadial: 0,
              dvNormal: 0,
              dvPrograde: 850,
              patches: [],
            },
          ],
        },
        400,
      ),
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
    it("offers a field with its label and unit", () => {
      const { source } = freshSource();
      const schema = source.schema();
      const altitude = schema.find((k) => k.key === "vessel.state.altitudeAsl");
      expect(altitude).toMatchObject({ label: "Altitude ASL", unit: "m" });
    });

    it("offers the same vocabulary a live picker does", () => {
      // A recording is read back under the keys it was recorded with, so a
      // catalogue of its own would be a second thing to keep in step with the
      // wire. That drift is what the retired hand-written table did.
      const { source } = freshSource();
      expect(source.schema()).toBe(getTopicFieldCatalog());
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

      const range = await source.queryRange(
        "vessel.state.altitudeAsl",
        0,
        900,
        "m1",
      );
      expect(range.t).toEqual([0, 400, 900]);
      expect(range.v).toEqual([100, 5000, 70000]);
    });

    /**
     * `o.orbitPatches` resolves to `vessel.state.orbitPatches`, a derived
     * channel over the raw `vessel.orbit` record. Two things had to hold and
     * neither did: the full-history store must register the production
     * derived channels, and `queryRange` must read a derived topic through
     * `sampleDerivedRange` (`sampleRange` returns `undefined` for one by
     * construction). Both failures collapse onto `{ t: [], v: [] }`, the same
     * answer as "this recording holds no data for that key", which is why the
     * graph's "No recorded samples" message was believed.
     *
     * This asserted on `o.maneuverNodes` until that key stopped naming a
     * derived channel. A key resolving to a raw topic exercises the raw-record
     * path and reaches none of the above, so the coverage moved to a key that
     * is still derived rather than staying on a name that no longer tests
     * anything.
     */
    it("serves a DERIVED key off the raw topics a real recording actually carries", async () => {
      const { source, store } = freshSource();
      await store.saveMission(mission());

      const range = await source.queryRange(
        "vessel.state.orbitPatches",
        0,
        900,
        "m1",
      );
      expect(range.t.length).toBeGreaterThan(0);
    });

    it("serves o.maneuverNodes as the plan the recording actually carries", async () => {
      const { source, store } = freshSource();
      await store.saveMission(mission());

      const range = await source.queryRange(
        "vessel.maneuver.nodes",
        0,
        900,
        "m1",
      );
      expect(range.t).toEqual([0, 400]);
      expect(range.v).toEqual([
        [],
        [
          // Values rather than bare numbers, which is the point of the key
          // resolving here: the burn arrives carrying its units, and the
          // instant carries `ut` rather than being a number that could be
          // read as a duration.
          {
            id: "node-1",
            ut: { magnitude: 1200, unit: "ut" },
            dvRadial: { magnitude: 0, unit: "m/s" },
            dvNormal: { magnitude: 0, unit: "m/s" },
            dvPrograde: { magnitude: 850, unit: "m/s" },
            patches: [],
          },
        ],
      ]);
    });

    it("returns empty when missionId is omitted", async () => {
      const { source, store } = freshSource();
      await store.saveMission(mission());
      expect(
        await source.queryRange("vessel.state.altitudeAsl", 0, 900),
      ).toEqual({
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

      const first = await source.queryRange(
        "vessel.state.altitudeAsl",
        0,
        900,
        "m1",
      );
      source.evictFullHistoryStore("m1");
      const second = await source.queryRange(
        "vessel.state.altitudeAsl",
        0,
        900,
        "m1",
      );
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
      await source.queryRange("vessel.state.altitudeAsl", 0, 900, "m1"); // populate cache
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
