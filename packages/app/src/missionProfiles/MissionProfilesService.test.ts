import type { Layout } from "react-grid-layout";
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
  { i: "b", componentId: "ground-track" },
];

const LAYOUT: Layout = [
  { i: "a", x: 0, y: 0, w: 8, h: 14, moved: false, static: false },
  { i: "b", x: 8, y: 0, w: 18, h: 14, moved: false, static: false },
];

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
    svc.save("Launch", ITEMS, LAYOUT);
    const list = svc.list();
    expect(list).toHaveLength(1);
    expect(list[0].name).toBe("Launch");
    expect(list[0].items).toEqual(ITEMS);
    expect(list[0].layout).toEqual(LAYOUT);
    expect(list[0].screen).toBe("main");
  });

  it("partitions profiles by screen", () => {
    const main = new MissionProfilesService("main", storage);
    const station = new MissionProfilesService("station", storage);
    main.save("Launch", ITEMS, LAYOUT);
    station.save("Probe", ITEMS, LAYOUT);
    expect(main.list().map((p) => p.name)).toEqual(["Launch"]);
    expect(station.list().map((p) => p.name)).toEqual(["Probe"]);
  });

  it("persists across service instances", () => {
    const a = new MissionProfilesService("main", storage);
    a.save("Launch", ITEMS, LAYOUT);
    const b = new MissionProfilesService("main", storage);
    expect(b.list().map((p) => p.name)).toEqual(["Launch"]);
  });

  it("updates name, items, layout via update()", () => {
    const svc = new MissionProfilesService("main", storage);
    const p = svc.save("Launch", ITEMS, LAYOUT);
    svc.update(p.id, { name: "Ascent" });
    const [next] = svc.list();
    expect(next.name).toBe("Ascent");
    expect(next.updatedAt).toBeGreaterThanOrEqual(p.updatedAt);
  });

  it("removes a profile", () => {
    const svc = new MissionProfilesService("main", storage);
    const p = svc.save("Launch", ITEMS, LAYOUT);
    svc.save("Orbit", ITEMS, LAYOUT);
    svc.remove(p.id);
    expect(svc.list().map((x) => x.name)).toEqual(["Orbit"]);
  });

  it("notifies subscribers on mutation", () => {
    const svc = new MissionProfilesService("main", storage);
    const cb = vi.fn();
    const unsub = svc.subscribe(cb);
    svc.save("Launch", ITEMS, LAYOUT);
    expect(cb).toHaveBeenCalledTimes(1);
    unsub();
    svc.save("Orbit", ITEMS, LAYOUT);
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it("falls back to an empty list when localStorage is corrupt", () => {
    storage.setItem("gonogo.missionProfiles.main", "{not json");
    const svc = new MissionProfilesService("main", storage);
    expect(svc.list()).toEqual([]);
    // Still writable afterwards.
    svc.save("Launch", ITEMS, LAYOUT);
    expect(svc.list()).toHaveLength(1);
  });

  describe("scene bindings", () => {
    it("persists sceneBindings on save() and surfaces them via findForScene()", () => {
      const svc = new MissionProfilesService("station", storage);
      svc.save("Mission Control", ITEMS, LAYOUT, ["Flight"]);
      expect(svc.findForScene("Flight")?.name).toBe("Mission Control");
      expect(svc.findForScene("Editor")).toBeUndefined();
    });

    it("normalises empty sceneBindings to undefined on save()", () => {
      const svc = new MissionProfilesService("main", storage);
      svc.save("Plain", ITEMS, LAYOUT, []);
      expect(svc.list()[0].sceneBindings).toBeUndefined();
    });

    it("can edit sceneBindings via update()", () => {
      const svc = new MissionProfilesService("main", storage);
      const p = svc.save("Launch", ITEMS, LAYOUT, ["SpaceCenter"]);
      svc.update(p.id, { sceneBindings: ["Flight", "Editor"] });
      expect(svc.findForScene("Flight")?.id).toBe(p.id);
      expect(svc.findForScene("Editor")?.id).toBe(p.id);
      expect(svc.findForScene("SpaceCenter")).toBeUndefined();
    });

    it("clearing sceneBindings via update() removes the binding", () => {
      const svc = new MissionProfilesService("main", storage);
      const p = svc.save("Launch", ITEMS, LAYOUT, ["Flight"]);
      svc.update(p.id, { sceneBindings: [] });
      expect(svc.findForScene("Flight")).toBeUndefined();
      expect(svc.list()[0].sceneBindings).toBeUndefined();
    });

    it("findForScene() returns the most recently updated profile when multiple are tagged", async () => {
      const svc = new MissionProfilesService("main", storage);
      const older = svc.save("Older", ITEMS, LAYOUT, ["Flight"]);
      // Force a strictly later updatedAt without sleeping.
      await new Promise((r) => setTimeout(r, 2));
      const newer = svc.save("Newer", ITEMS, LAYOUT, ["Flight"]);
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
            layout: LAYOUT,
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
      svc.save("AutoFlight", ITEMS, LAYOUT, ["Flight"], true);
      expect(svc.list()[0].autoSwitch).toBe(true);
    });

    it("normalises autoSwitch=false on save() to undefined", () => {
      const svc = new MissionProfilesService("main", storage);
      svc.save("Manual", ITEMS, LAYOUT, ["Flight"], false);
      expect(svc.list()[0].autoSwitch).toBeUndefined();
    });

    it("can toggle autoSwitch via update()", () => {
      const svc = new MissionProfilesService("main", storage);
      const p = svc.save("Mission", ITEMS, LAYOUT, ["Flight"]);
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
            layout: LAYOUT,
            sceneBindings: ["BogusOnly"],
            updatedAt: 1,
          },
        ]),
      );
      const svc = new MissionProfilesService("main", storage);
      expect(svc.list()[0].sceneBindings).toBeUndefined();
    });
  });

  describe("the current profile", () => {
    it("starts with none and remembers the one set across instances", () => {
      const a = new MissionProfilesService("main", storage);
      expect(a.getCurrentId()).toBeNull();
      const p = a.save("Launch", ITEMS, LAYOUT);
      a.setCurrent(p.id);
      expect(new MissionProfilesService("main", storage).getCurrentId()).toBe(
        p.id,
      );
    });

    it("keeps it per screen", () => {
      const main = new MissionProfilesService("main", storage);
      const station = new MissionProfilesService("station", storage);
      main.setCurrent(main.save("Launch", ITEMS, LAYOUT).id);
      expect(station.getCurrentId()).toBeNull();
    });

    it("has none after the current profile is deleted", () => {
      const svc = new MissionProfilesService("main", storage);
      const p = svc.save("Launch", ITEMS, LAYOUT);
      svc.setCurrent(p.id);
      svc.remove(p.id);
      expect(svc.getCurrentId()).toBeNull();
    });

    it("ignores a stored current id that names nothing", () => {
      storage.setItem("gonogo.missionProfiles.current.main", '"gone"');
      expect(new MissionProfilesService("main", storage).getCurrentId()).toBe(
        null,
      );
    });
  });

  describe("the unnamed layout", () => {
    it("is created current and flagged, and renaming makes it ordinary", () => {
      const svc = new MissionProfilesService("main", storage);
      const draft = svc.createDraft(ITEMS, LAYOUT);
      expect(svc.getCurrentId()).toBe(draft.id);
      expect(draft.name).toBe("Unsaved layout");
      expect(draft.draft).toBe(true);

      svc.update(draft.id, { name: "Docking" });
      expect(svc.get(draft.id)?.draft).toBeUndefined();
    });

    it("keeps its flag while the autosave writes into it", () => {
      const svc = new MissionProfilesService("main", storage);
      const draft = svc.createDraft(ITEMS, LAYOUT);
      svc.writeContent(draft.id, [], []);
      expect(svc.get(draft.id)?.draft).toBe(true);
    });

    it("is never joined by a second flagged layout", () => {
      const svc = new MissionProfilesService("main", storage);
      const first = svc.createDraft(ITEMS, LAYOUT);
      svc.setCurrent(null);
      const second = svc.createDraft(ITEMS, LAYOUT);
      expect(svc.list().filter((p) => p.draft)).toEqual([
        expect.objectContaining({ id: second.id }),
      ]);
      expect(svc.get(first.id)).toBeDefined();
    });
  });

  describe("migrating a store from before profiles held the working layout", () => {
    const stored = (items: DashboardItem[]) =>
      JSON.stringify({ items, layout: LAYOUT.slice(0, items.length) });
    const one = (i: string): DashboardItem[] => [
      { i, componentId: "fuel-status" },
    ];

    it("turns each scene slot into a profile named for the scene, bound to it and switching on its own", () => {
      storage.setItem("gonogo:dashboard:main:Flight", stored(one("a")));
      storage.setItem("gonogo:dashboard:main:SpaceCenter", stored(one("b")));

      const svc = new MissionProfilesService("main", storage);

      const flight = svc.list().find((p) => p.name === "Flight layout");
      expect(flight?.items).toEqual(one("a"));
      expect(flight?.sceneBindings).toEqual(["Flight"]);
      expect(flight?.autoSwitch).toBe(true);
      const centre = svc.list().find((p) => p.name === "Space Center layout");
      expect(centre?.sceneBindings).toEqual(["SpaceCenter"]);
      expect(svc.findForScene("Flight")?.id).toBe(flight?.id);
    });

    it("keeps a slot as a named profile when a profile is already bound to that scene", () => {
      const early = new MissionProfilesService("main", storage);
      const mine = early.save("Ascent", ITEMS, LAYOUT, ["Flight"]);
      storage.setItem("gonogo:dashboard:main:Flight", stored(one("a")));

      const svc = new MissionProfilesService("main", storage);

      const flight = svc.list().find((p) => p.name === "Flight layout");
      expect(flight?.items).toEqual(one("a"));
      expect(flight?.sceneBindings).toBeUndefined();
      expect(flight?.autoSwitch).toBeUndefined();
      expect(svc.findForScene("Flight")?.id).toBe(mine.id);
    });

    it("makes the screen's base slot the current profile, named Layout", () => {
      storage.setItem("gonogo:dashboard:main", stored(one("a")));

      const svc = new MissionProfilesService("main", storage);

      expect(svc.getCurrent()?.name).toBe("Layout");
      expect(svc.getCurrent()?.items).toEqual(one("a"));
      expect(svc.getCurrent()?.sceneBindings).toBeUndefined();
    });

    it("migrates the station's single slot the same way", () => {
      storage.setItem("gonogo:dashboard:station", stored(one("s")));

      const svc = new MissionProfilesService("station", storage);

      expect(svc.getCurrent()?.items).toEqual(one("s"));
    });

    it("leaves another screen's slots alone", () => {
      storage.setItem("gonogo:dashboard:pilot:Flight", stored(one("p")));

      const svc = new MissionProfilesService("main", storage);

      expect(svc.list()).toEqual([]);
      expect(storage.getItem("gonogo:dashboard:pilot:Flight")).not.toBeNull();
    });

    it("converts each slot once, and removes it", () => {
      storage.setItem("gonogo:dashboard:main:Flight", stored(one("a")));
      new MissionProfilesService("main", storage);

      const again = new MissionProfilesService("main", storage);

      expect(
        again.list().filter((p) => p.name === "Flight layout"),
      ).toHaveLength(1);
      expect(storage.getItem("gonogo:dashboard:main:Flight")).toBeNull();
    });

    it("does not convert a slot twice when removing it failed", () => {
      storage.setItem("gonogo:dashboard:main:Flight", stored(one("a")));
      const stuck = new Proxy(storage, {
        get(target, prop) {
          if (prop === "removeItem") {
            return () => {
              throw new DOMException("denied", "SecurityError");
            };
          }
          const value = Reflect.get(target, prop);
          return typeof value === "function" ? value.bind(target) : value;
        },
      });

      new MissionProfilesService("main", stuck);
      const again = new MissionProfilesService("main", storage);

      expect(
        again.list().filter((p) => p.name === "Flight layout"),
      ).toHaveLength(1);
      expect(storage.getItem("gonogo:dashboard:main:Flight")).toBeNull();
    });

    it("converts a slot a restored backup brings back with different contents", () => {
      storage.setItem("gonogo:dashboard:main:Flight", stored(one("a")));
      new MissionProfilesService("main", storage);
      storage.setItem("gonogo:dashboard:main:Flight", stored(one("z")));

      const again = new MissionProfilesService("main", storage);

      expect(
        again.list().filter((p) => p.name === "Flight layout"),
      ).toHaveLength(2);
    });

    it("keeps the unnamed layouts the old drafts left, as ordinary profiles", () => {
      storage.setItem(
        "gonogo.missionProfiles.main",
        JSON.stringify([
          {
            id: "d1",
            name: "Unsaved layout",
            screen: "main",
            items: ITEMS,
            layout: LAYOUT,
            draft: true,
            updatedAt: 5,
          },
          {
            id: "d2",
            name: "Unsaved layout",
            screen: "main",
            items: ITEMS,
            layout: LAYOUT,
            draft: true,
            updatedAt: 6,
          },
        ]),
      );

      const svc = new MissionProfilesService("main", storage);

      expect(
        svc
          .list()
          .map((p) => p.id)
          .sort(),
      ).toEqual(["d1", "d2"]);
      expect(svc.list().some((p) => p.draft)).toBe(false);
      expect(svc.getCurrentId()).toBeNull();
    });

    it("does not clear the flag of a layout created after migrating", () => {
      const first = new MissionProfilesService("main", storage);
      first.createDraft(ITEMS, LAYOUT);

      const again = new MissionProfilesService("main", storage);

      expect(again.list().filter((p) => p.draft)).toHaveLength(1);
    });
  });

  describe("two tabs of one screen", () => {
    function tellOtherTab(storage: Storage) {
      globalThis.dispatchEvent(
        Object.assign(new Event("storage"), {
          key: "gonogo.missionProfiles.main",
          storageArea: storage,
        }),
      );
    }

    it("keeps a layout saved in one tab when the other tab writes next", () => {
      const storage = memoryStorage();
      const tabA = new MissionProfilesService("main", storage);
      const tabB = new MissionProfilesService("main", storage);
      const mine = tabB.save("Docking", ITEMS, LAYOUT);
      const theirs = tabA.save("Launch", ITEMS, LAYOUT);
      tellOtherTab(storage);

      tabB.update(mine.id, { name: "Docking 2" });
      tellOtherTab(storage);

      for (const tab of [tabA, tabB]) {
        expect(
          tab
            .list()
            .map((p) => p.name)
            .sort(),
        ).toEqual(["Docking 2", "Launch"]);
      }
      expect(
        new MissionProfilesService("main", storage).get(theirs.id),
      ).toBeDefined();
      tabA.dispose();
      tabB.dispose();
    });

    it("keeps the newer copy of a profile edited in both tabs", () => {
      vi.useFakeTimers();
      const storage = memoryStorage();
      const tabA = new MissionProfilesService("main", storage);
      const profile = tabA.save("Orbit", ITEMS, LAYOUT);
      const tabB = new MissionProfilesService("main", storage);
      vi.setSystemTime(Date.now() + 1000);
      tabA.update(profile.id, { name: "Orbit A" });
      vi.setSystemTime(Date.now() + 1000);
      tabB.update(profile.id, { name: "Orbit B" });
      tellOtherTab(storage);

      expect(tabA.get(profile.id)?.name).toBe("Orbit B");
      expect(tabB.get(profile.id)?.name).toBe("Orbit B");
      tabA.dispose();
      tabB.dispose();
      vi.useRealTimers();
    });

    it("tells subscribers when the other tab's layout arrives", () => {
      const storage = memoryStorage();
      const tabA = new MissionProfilesService("main", storage);
      const tabB = new MissionProfilesService("main", storage);
      const listener = vi.fn();
      tabA.subscribe(listener);
      tabB.save("Launch", ITEMS, LAYOUT);
      tellOtherTab(storage);

      expect(listener).toHaveBeenCalled();
      expect(tabA.list().map((p) => p.name)).toEqual(["Launch"]);
      tabA.dispose();
      tabB.dispose();
    });
  });
});
