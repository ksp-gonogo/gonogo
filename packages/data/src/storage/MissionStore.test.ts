import type { ReplayFixture } from "@ksp-gonogo/sitrep-client";
import { describe, expect, it } from "vitest";
import {
  type MissionMeta,
  type MissionRecord,
  MissionStore,
} from "./MissionStore";

// fake-indexeddb is installed via setupFiles (src/test/setup.ts). Each test
// uses a fresh database name so state doesn't leak between tests.

let dbCounter = 0;

function freshStore(): MissionStore {
  dbCounter += 1;
  return new MissionStore({ dbName: `gonogo-missions-test-${dbCounter}` });
}

function mission(overrides: Partial<MissionMeta> = {}): MissionRecord {
  const meta: MissionMeta = {
    id: "m1",
    vesselName: "Kerbal X",
    launchedAt: 1000,
    firstFrameUt: 0,
    lastFrameUt: 120,
    frameCount: 42,
    ...overrides,
  };
  const fixture: ReplayFixture = {
    subscribedTopics: ["vessel.orbit"],
    frames: ['{"type":"stream-data","topic":"vessel.orbit"}'],
  };
  return { meta, fixture };
}

describe("MissionStore", () => {
  it("round-trips a saved mission's metadata through listMissions", async () => {
    const store = freshStore();
    await store.saveMission(mission());
    const list = await store.listMissions();
    expect(list).toHaveLength(1);
    expect(list[0]).toEqual(mission().meta);
  });

  it("listMissions sorts newest-launched first", async () => {
    const store = freshStore();
    await store.saveMission(mission({ id: "older", launchedAt: 100 }));
    await store.saveMission(mission({ id: "newer", launchedAt: 200 }));
    const list = await store.listMissions();
    expect(list.map((m) => m.id)).toEqual(["newer", "older"]);
  });

  it("getMissionFixture returns the fixture payload for a known id, null otherwise", async () => {
    const store = freshStore();
    const record = mission();
    await store.saveMission(record);

    const loaded = await store.getMissionFixture("m1");
    expect(loaded?.fixture).toEqual(record.fixture);
    expect(loaded?.video).toBeUndefined();

    expect(await store.getMissionFixture("nope")).toBeNull();
  });

  it("deleteMission removes both the meta and fixture rows", async () => {
    const store = freshStore();
    await store.saveMission(mission());
    await store.deleteMission("m1");
    expect(await store.listMissions()).toEqual([]);
    expect(await store.getMissionFixture("m1")).toBeNull();
  });

  it("clearAllMissions empties the store", async () => {
    const store = freshStore();
    await store.saveMission(mission({ id: "a" }));
    await store.saveMission(mission({ id: "b" }));
    await store.clearAllMissions();
    expect(await store.listMissions()).toEqual([]);
  });

  it("persists a video ref alongside the fixture when present", async () => {
    const store = freshStore();
    const record = mission();
    record.video = { blobKey: "blob-1", startUt: 5 };
    await store.saveMission(record);
    const loaded = await store.getMissionFixture("m1");
    expect(loaded?.video).toEqual({ blobKey: "blob-1", startUt: 5 });
  });

  describe("updateMissionMeta", () => {
    it("patches starred/chapters on the meta row without touching the fixture", async () => {
      const store = freshStore();
      const record = mission();
      await store.saveMission(record);

      await store.updateMissionMeta("m1", {
        starred: true,
        chapters: [{ id: "c1", label: "Ascent", startMs: 0, endMs: 30_000 }],
      });

      const [meta] = await store.listMissions();
      expect(meta.starred).toBe(true);
      expect(meta.chapters).toEqual([
        { id: "c1", label: "Ascent", startMs: 0, endMs: 30_000 },
      ]);
      // Fixture untouched.
      expect((await store.getMissionFixture("m1"))?.fixture).toEqual(
        record.fixture,
      );
    });

    it("is a no-op for an unknown mission id", async () => {
      const store = freshStore();
      await expect(
        store.updateMissionMeta("nope", { starred: true }),
      ).resolves.toBeUndefined();
      expect(await store.listMissions()).toEqual([]);
    });
  });

  describe("pruneMissionsKeepLatest", () => {
    it("deletes everything past keepCount, newest-launched first", async () => {
      const store = freshStore();
      await store.saveMission(mission({ id: "a", launchedAt: 100 }));
      await store.saveMission(mission({ id: "b", launchedAt: 200 }));
      await store.saveMission(mission({ id: "c", launchedAt: 300 }));

      const removed = await store.pruneMissionsKeepLatest({ keepCount: 2 });

      expect(removed.sort()).toEqual(["a"]);
      const remaining = (await store.listMissions()).map((m) => m.id);
      expect(remaining.sort()).toEqual(["b", "c"]);
    });

    it("exempts starred missions from both the cap and eviction", async () => {
      const store = freshStore();
      await store.saveMission(
        mission({ id: "old-starred", launchedAt: 100, starred: true }),
      );
      await store.saveMission(mission({ id: "b", launchedAt: 200 }));
      await store.saveMission(mission({ id: "c", launchedAt: 300 }));

      const removed = await store.pruneMissionsKeepLatest({ keepCount: 1 });

      expect(removed).toEqual(["b"]);
      const remaining = (await store.listMissions()).map((m) => m.id);
      expect(remaining.sort()).toEqual(["c", "old-starred"]);
    });

    it("does nothing when keepCount is 0 or negative", async () => {
      const store = freshStore();
      await store.saveMission(mission({ id: "a" }));
      expect(await store.pruneMissionsKeepLatest({ keepCount: 0 })).toEqual([]);
      expect(await store.listMissions()).toHaveLength(1);
    });
  });
});
