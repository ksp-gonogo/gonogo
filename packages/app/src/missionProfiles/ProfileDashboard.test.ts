import "@ksp-gonogo/components";
import { getComponent } from "@ksp-gonogo/core";
import type { Layout } from "react-grid-layout";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DashboardItem } from "../components/Dashboard";
import { DEFAULT_TEMPLATES, snapshotOf } from "./layoutTemplates";
import { MissionProfilesService } from "./MissionProfilesService";
import {
  AUTOSAVE_DELAY_MS,
  type DashboardSnapshot,
  ProfileDashboard,
  UNDO_DEPTH,
} from "./ProfileDashboard";

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

const widget = (i: string): DashboardItem => ({
  i,
  componentId: "fuel-status",
});
const tile = (i: string, x = 0): Layout[number] => ({
  i,
  x,
  y: 0,
  w: 4,
  h: 4,
  moved: false,
  static: false,
});
const snap = (...ids: string[]): DashboardSnapshot => ({
  items: ids.map(widget),
  layout: ids.map((id, n) => tile(id, n * 4)),
});
const ids = (s: DashboardSnapshot) => s.items.map((it) => it.i);

function setup(initial: DashboardSnapshot = snap()) {
  const svc = new MissionProfilesService("main", memoryStorage());
  let shown = initial;
  const dashboard = new ProfileDashboard(svc, (s) => (shown = s), initial);
  const stop = dashboard.attach();
  /** What the screen does when the operator edits: state changes, then the hook reports it. */
  const edit = (next: DashboardSnapshot) => {
    shown = next;
    dashboard.recordChange(next.items, next.layout);
  };
  return { svc, dashboard, edit, shown: () => shown, stop };
}

describe("ProfileDashboard autosave", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(1_700_000_000_000);
    vi.advanceTimersByTime(1000);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("creates the one unnamed layout on the first change and keeps saving into it", () => {
    const { svc, dashboard, edit } = setup();
    expect(svc.list()).toHaveLength(0);

    edit(snap("a"));
    vi.advanceTimersByTime(AUTOSAVE_DELAY_MS);
    expect(svc.list()).toHaveLength(1);
    const [draft] = svc.list();
    expect(draft.name).toBe("Unsaved layout");
    expect(draft.draft).toBe(true);
    expect(svc.getCurrentId()).toBe(draft.id);

    edit(snap("a", "b"));
    dashboard.flush();
    expect(svc.list()).toHaveLength(1);
    expect(svc.get(draft.id)?.items.map((it) => it.i)).toEqual(["a", "b"]);
  });

  it("does not make a layout the scene's choice by showing it and letting the grid settle", () => {
    const { svc, dashboard, shown } = setup(snap("a"));
    const chosen = svc.save(
      "Flight A",
      snap("a").items,
      snap("a").layout,
      ["Flight"],
      true,
    );
    vi.advanceTimersByTime(1000);
    const other = svc.save(
      "Flight B",
      snap("b").items,
      snap("b").layout,
      ["Flight"],
      true,
    );
    vi.advanceTimersByTime(1000);
    svc.writeContent(chosen.id, chosen.items, chosen.layout);
    expect(svc.findForScene("Flight")?.id).toBe(chosen.id);

    dashboard.switchTo(other.id);
    vi.advanceTimersByTime(50);
    const reshaped = { items: shown().items, layout: [tile("b", 3)] };
    dashboard.recordChange(reshaped.items, reshaped.layout);

    expect(svc.findForScene("Flight")?.id).toBe(chosen.id);
  });

  it("writes straight into the current profile, never forking it", () => {
    const { svc, dashboard, edit } = setup(snap("a"));
    const p = svc.save("Launch", snap("a").items, snap("a").layout);
    svc.setCurrent(p.id);

    edit(snap("a", "b"));
    dashboard.flush();

    expect(svc.list()).toHaveLength(1);
    expect(svc.get(p.id)?.name).toBe("Launch");
    expect(svc.get(p.id)?.draft).toBeUndefined();
    expect(svc.get(p.id)?.items).toHaveLength(2);
  });

  it("keeps every widget where it was put when it saves a move", () => {
    const { svc, dashboard, edit } = setup(snap("a", "b"));
    const p = svc.save("Launch", snap("a", "b").items, snap("a", "b").layout);
    svc.setCurrent(p.id);

    const moved = { ...snap("a", "b"), layout: [tile("a", 10), tile("b", 20)] };
    vi.advanceTimersByTime(1000);
    edit(moved);
    dashboard.flush();

    expect(svc.get(p.id)?.layout).toEqual(moved.layout);
  });

  it("flushes a pending change before a switch", () => {
    const { svc, dashboard, edit } = setup(snap("a"));
    const a = svc.save("A", snap("a").items, snap("a").layout);
    const b = svc.save("B", snap("z").items, snap("z").layout);
    svc.setCurrent(a.id);

    edit(snap("a", "b"));
    dashboard.switchTo(b.id);

    expect(svc.get(a.id)?.items.map((it) => it.i)).toEqual(["a", "b"]);
    expect(svc.getCurrentId()).toBe(b.id);
  });

  it("ignores the grid reshaping a layout it was just given", () => {
    const { svc, dashboard, edit } = setup(snap("a"));
    const p = svc.save("A", snap("a").items, snap("a").layout);
    svc.setCurrent(p.id);

    edit({ items: snap("a").items, layout: [tile("a", 3)] });
    dashboard.flush();

    expect(dashboard.canUndo()).toBe(false);
    expect(svc.get(p.id)?.layout).toEqual([tile("a", 3)]);
  });
});

describe("ProfileDashboard undo and redo", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(1_700_000_000_000);
    vi.advanceTimersByTime(1000);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("undoes a change on screen and saves that state into the profile", () => {
    const { svc, dashboard, edit, shown } = setup();
    edit(snap("a"));
    dashboard.flush();
    edit(snap("a", "b"));
    dashboard.flush();

    dashboard.undo();

    expect(ids(shown())).toEqual(["a"]);
    expect(svc.getCurrent()?.items.map((it) => it.i)).toEqual(["a"]);
  });

  it("redoes what was undone", () => {
    const { svc, dashboard, edit, shown } = setup();
    edit(snap("a"));
    dashboard.flush();
    edit(snap("a", "b"));
    dashboard.flush();
    dashboard.undo();

    dashboard.redo();

    expect(ids(shown())).toEqual(["a", "b"]);
    expect(svc.getCurrent()?.items).toHaveLength(2);
  });

  it("drops the redo steps when a new change is made after an undo", () => {
    const { dashboard, edit } = setup();
    edit(snap("a"));
    dashboard.flush();
    dashboard.undo();
    expect(dashboard.canRedo()).toBe(true);

    edit(snap("c"));

    expect(dashboard.canRedo()).toBe(false);
  });

  it("undoes the change still waiting out the autosave delay", () => {
    const { dashboard, edit, shown } = setup(snap("a"));
    edit(snap("a", "b"));

    dashboard.undo();

    expect(ids(shown())).toEqual(["a"]);
  });

  it("undoes a switch by putting the previous profile back as current", () => {
    const { svc, dashboard, shown } = setup(snap("a"));
    const a = svc.save("A", snap("a").items, snap("a").layout);
    const b = svc.save("B", snap("z").items, snap("z").layout);
    svc.setCurrent(a.id);

    dashboard.switchTo(b.id);
    expect(ids(shown())).toEqual(["z"]);

    dashboard.undo();
    expect(svc.getCurrentId()).toBe(a.id);
    expect(ids(shown())).toEqual(["a"]);

    dashboard.redo();
    expect(svc.getCurrentId()).toBe(b.id);
    expect(ids(shown())).toEqual(["z"]);
  });

  it("undoes edits and switches in the order they happened", () => {
    const { svc, dashboard, edit, shown } = setup(snap("a"));
    const a = svc.save("A", snap("a").items, snap("a").layout);
    const b = svc.save("B", snap("z").items, snap("z").layout);
    svc.setCurrent(a.id);

    edit(snap("a", "a2"));
    dashboard.flush();
    dashboard.switchTo(b.id);
    edit(snap("z", "z2"));
    dashboard.flush();

    dashboard.undo();
    expect(svc.getCurrentId()).toBe(b.id);
    expect(ids(shown())).toEqual(["z"]);
    dashboard.undo();
    expect(svc.getCurrentId()).toBe(a.id);
    expect(ids(shown())).toEqual(["a", "a2"]);
    dashboard.undo();
    expect(ids(shown())).toEqual(["a"]);
    expect(svc.get(a.id)?.items).toHaveLength(1);
  });

  it("holds at least the last twenty states of a profile", () => {
    const { dashboard, edit, shown } = setup();
    const steps = Array.from({ length: 25 }, (_, n) =>
      snap(...Array.from({ length: n + 1 }, (_, k) => `w${k}`)),
    );
    for (const s of steps) {
      edit(s);
      dashboard.flush();
    }
    expect(UNDO_DEPTH).toBeGreaterThanOrEqual(20);

    for (let n = 0; n < 20; n++) dashboard.undo();

    expect(ids(shown())).toHaveLength(5);
  });

  it("forgets history that belongs to a deleted profile", () => {
    const { svc, dashboard } = setup(snap("a"));
    const a = svc.save("A", snap("a").items, snap("a").layout);
    const b = svc.save("B", snap("z").items, snap("z").layout);
    svc.setCurrent(a.id);
    dashboard.switchTo(b.id);

    svc.remove(a.id);

    expect(dashboard.canUndo()).toBe(false);
  });
});

describe("ProfileDashboard new layouts", () => {
  it("creates an empty layout, shows it and undoes back to what was there", () => {
    const { svc, dashboard, shown } = setup(snap("a"));

    const blank = dashboard.createLayout("Blank");

    expect(ids(shown())).toEqual([]);
    expect(svc.getCurrentId()).toBe(blank.id);

    dashboard.undo();

    expect(ids(shown())).toEqual(["a"]);
  });

  it("adds every template with its scenes and automatic switching, as one undo step", () => {
    const { svc, dashboard, shown } = setup(snap());

    const made = dashboard.addTemplates(DEFAULT_TEMPLATES, "Flight");

    expect(made.map((p) => p.name)).toEqual(["Flight", "Space Center"]);
    expect(made.every((p) => p.autoSwitch)).toBe(true);
    expect(svc.findForScene("Editor")?.name).toBe("Space Center");
    expect(svc.findForScene("TrackingStation")?.name).toBe("Space Center");
    expect(svc.findForScene("Flight")?.name).toBe("Flight");
    expect(svc.getCurrent()?.name).toBe("Flight");
    expect(shown().items.length).toBeGreaterThan(0);

    dashboard.undo();

    expect(ids(shown())).toEqual([]);
  });

  it("opens the layout for the scene the game is in", () => {
    const { svc, dashboard } = setup(snap());

    dashboard.addTemplates(DEFAULT_TEMPLATES, "TrackingStation");

    expect(svc.getCurrent()?.name).toBe("Space Center");
  });

  it("places every starter widget on a registered component with unique ids and no overlap", () => {
    for (const template of DEFAULT_TEMPLATES) {
      const { items, layout } = snapshotOf(template);
      expect(new Set(items.map((it) => it.i)).size).toBe(items.length);
      for (const it of items) {
        expect(getComponent(it.componentId), it.componentId).toBeDefined();
      }
      for (const a of layout) {
        expect(a.x + a.w).toBeLessThanOrEqual(36);
        for (const b of layout) {
          if (a === b) continue;
          const apart =
            a.x + a.w <= b.x ||
            b.x + b.w <= a.x ||
            a.y + a.h <= b.y ||
            b.y + b.h <= a.y;
          expect(apart, `${a.i} overlaps ${b.i}`).toBe(true);
        }
      }
    }
  });
});
