import type { Layouts } from "react-grid-layout";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DashboardItem } from "../components/Dashboard";
import { MissionProfilesService } from "./MissionProfilesService";

function memoryStorage(): Storage {
  const map = new Map<string, string>();
  return {
    length: 0,
    clear: () => map.clear(),
    key: () => null,
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => {
      map.set(k, String(v));
    },
    removeItem: (k) => {
      map.delete(k);
    },
  } as Storage;
}

const ITEMS: DashboardItem[] = [
  { i: "a", componentId: "fuel-status" },
  { i: "b", componentId: "map-view" },
];

const LAYOUTS: Layouts = {
  lg: [
    { i: "a", x: 0, y: 0, w: 8, h: 14, moved: false, static: false },
    { i: "b", x: 8, y: 0, w: 18, h: 14, moved: false, static: false },
  ],
};

describe("MissionProfilesService", () => {
  let storage: Storage;

  beforeEach(() => {
    storage = memoryStorage();
  });

  it("starts empty for a fresh screen", () => {
    const svc = new MissionProfilesService("main", storage);
    expect(svc.list()).toEqual([]);
  });

  it("saves and lists a named snapshot", () => {
    const svc = new MissionProfilesService("main", storage);
    svc.save("Launch", ITEMS, LAYOUTS);
    const list = svc.list();
    expect(list).toHaveLength(1);
    expect(list[0].name).toBe("Launch");
    expect(list[0].items).toEqual(ITEMS);
    expect(list[0].layouts).toEqual(LAYOUTS);
    expect(list[0].screen).toBe("main");
  });

  it("partitions profiles by screen", () => {
    const main = new MissionProfilesService("main", storage);
    const station = new MissionProfilesService("station", storage);
    main.save("Launch", ITEMS, LAYOUTS);
    station.save("Probe", ITEMS, LAYOUTS);
    expect(main.list().map((p) => p.name)).toEqual(["Launch"]);
    expect(station.list().map((p) => p.name)).toEqual(["Probe"]);
  });

  it("persists across service instances", () => {
    const a = new MissionProfilesService("main", storage);
    a.save("Launch", ITEMS, LAYOUTS);
    const b = new MissionProfilesService("main", storage);
    expect(b.list().map((p) => p.name)).toEqual(["Launch"]);
  });

  it("updates name, items, layouts via update()", () => {
    const svc = new MissionProfilesService("main", storage);
    const p = svc.save("Launch", ITEMS, LAYOUTS);
    svc.update(p.id, { name: "Ascent" });
    const [next] = svc.list();
    expect(next.name).toBe("Ascent");
    expect(next.updatedAt).toBeGreaterThanOrEqual(p.updatedAt);
  });

  it("removes a profile", () => {
    const svc = new MissionProfilesService("main", storage);
    const p = svc.save("Launch", ITEMS, LAYOUTS);
    svc.save("Orbit", ITEMS, LAYOUTS);
    svc.remove(p.id);
    expect(svc.list().map((x) => x.name)).toEqual(["Orbit"]);
  });

  it("notifies subscribers on mutation", () => {
    const svc = new MissionProfilesService("main", storage);
    const cb = vi.fn();
    const unsub = svc.subscribe(cb);
    svc.save("Launch", ITEMS, LAYOUTS);
    expect(cb).toHaveBeenCalledTimes(1);
    unsub();
    svc.save("Orbit", ITEMS, LAYOUTS);
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it("falls back to an empty list when localStorage is corrupt", () => {
    storage.setItem("gonogo.missionProfiles.main", "{not json");
    const svc = new MissionProfilesService("main", storage);
    expect(svc.list()).toEqual([]);
    // Still writable afterwards.
    svc.save("Launch", ITEMS, LAYOUTS);
    expect(svc.list()).toHaveLength(1);
  });

  describe("scene bindings", () => {
    it("persists sceneBindings on save() and surfaces them via findForScene()", () => {
      const svc = new MissionProfilesService("station", storage);
      svc.save("Mission Control", ITEMS, LAYOUTS, ["Flight"]);
      expect(svc.findForScene("Flight")?.name).toBe("Mission Control");
      expect(svc.findForScene("Editor")).toBeUndefined();
    });

    it("normalises empty sceneBindings to undefined on save()", () => {
      const svc = new MissionProfilesService("main", storage);
      svc.save("Plain", ITEMS, LAYOUTS, []);
      expect(svc.list()[0].sceneBindings).toBeUndefined();
    });

    it("can edit sceneBindings via update()", () => {
      const svc = new MissionProfilesService("main", storage);
      const p = svc.save("Launch", ITEMS, LAYOUTS, ["SpaceCenter"]);
      svc.update(p.id, { sceneBindings: ["Flight", "Editor"] });
      expect(svc.findForScene("Flight")?.id).toBe(p.id);
      expect(svc.findForScene("Editor")?.id).toBe(p.id);
      expect(svc.findForScene("SpaceCenter")).toBeUndefined();
    });

    it("clearing sceneBindings via update() removes the binding", () => {
      const svc = new MissionProfilesService("main", storage);
      const p = svc.save("Launch", ITEMS, LAYOUTS, ["Flight"]);
      svc.update(p.id, { sceneBindings: [] });
      expect(svc.findForScene("Flight")).toBeUndefined();
      expect(svc.list()[0].sceneBindings).toBeUndefined();
    });

    it("findForScene() returns the most recently updated profile when multiple are tagged", async () => {
      const svc = new MissionProfilesService("main", storage);
      const older = svc.save("Older", ITEMS, LAYOUTS, ["Flight"]);
      // Force a strictly later updatedAt without sleeping.
      await new Promise((r) => setTimeout(r, 2));
      const newer = svc.save("Newer", ITEMS, LAYOUTS, ["Flight"]);
      expect(svc.findForScene("Flight")?.id).toBe(newer.id);
      expect(svc.findForScene("Flight")?.id).not.toBe(older.id);
    });

    it("drops unknown scene names quietly on load()", () => {
      // Pretend an old save wrote a scene we no longer recognise.
      storage.setItem(
        "gonogo.missionProfiles.main",
        JSON.stringify([
          {
            id: "p1",
            name: "Legacy",
            screen: "main",
            items: ITEMS,
            layouts: LAYOUTS,
            sceneBindings: ["Flight", "BogusScene", "Editor"],
            updatedAt: 1,
          },
        ]),
      );
      const svc = new MissionProfilesService("main", storage);
      expect(svc.list()[0].sceneBindings).toEqual(["Flight", "Editor"]);
    });

    it("persists autoSwitch when set via save() and surfaces it via list()", () => {
      const svc = new MissionProfilesService("main", storage);
      svc.save("AutoFlight", ITEMS, LAYOUTS, ["Flight"], true);
      expect(svc.list()[0].autoSwitch).toBe(true);
    });

    it("normalises autoSwitch=false on save() to undefined", () => {
      const svc = new MissionProfilesService("main", storage);
      svc.save("Manual", ITEMS, LAYOUTS, ["Flight"], false);
      expect(svc.list()[0].autoSwitch).toBeUndefined();
    });

    it("can toggle autoSwitch via update()", () => {
      const svc = new MissionProfilesService("main", storage);
      const p = svc.save("Mission", ITEMS, LAYOUTS, ["Flight"]);
      svc.update(p.id, { autoSwitch: true });
      expect(svc.list()[0].autoSwitch).toBe(true);
      svc.update(p.id, { autoSwitch: false });
      expect(svc.list()[0].autoSwitch).toBeUndefined();
    });

    it("normalises an all-bogus sceneBindings to undefined on load()", () => {
      storage.setItem(
        "gonogo.missionProfiles.main",
        JSON.stringify([
          {
            id: "p1",
            name: "Legacy",
            screen: "main",
            items: ITEMS,
            layouts: LAYOUTS,
            sceneBindings: ["BogusOnly"],
            updatedAt: 1,
          },
        ]),
      );
      const svc = new MissionProfilesService("main", storage);
      expect(svc.list()[0].sceneBindings).toBeUndefined();
    });
  });
});
