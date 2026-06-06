import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import type { DashboardItem } from "./index";
import { useDashboardState } from "./useDashboardState";

const INITIAL = { items: [] as DashboardItem[], layouts: { lg: [] } };
const item = (i: string): DashboardItem => ({ i, componentId: "test" });
const idsOf = (items: readonly DashboardItem[]) => items.map((it) => it.i);
const stored = (key: string) =>
  JSON.parse(localStorage.getItem(key) ?? "{}") as {
    items?: DashboardItem[];
  };

describe("useDashboardState — per-scene keys", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("reloads the saved layout when the storage key changes", () => {
    localStorage.setItem(
      "dash:Flight",
      JSON.stringify({
        items: [item("a")],
        layouts: { lg: [{ i: "a", x: 0, y: 0, w: 3, h: 3 }] },
      }),
    );
    const { result, rerender } = renderHook(
      ({ key }) => useDashboardState(key, INITIAL),
      { initialProps: { key: "dash:base" } },
    );
    expect(result.current.items).toEqual([]);

    rerender({ key: "dash:Flight" });
    expect(idsOf(result.current.items)).toEqual(["a"]);
  });

  it("keeps each scene's edits across switches without clobbering", () => {
    const { result, rerender } = renderHook(
      ({ key }) => useDashboardState(key, INITIAL),
      { initialProps: { key: "dash:Flight" } },
    );

    act(() => result.current.addItem(item("f1"), { w: 2, h: 2 }));
    expect(idsOf(result.current.items)).toContain("f1");

    // Switch to a never-visited scene: seeded from current, and Flight's
    // edits are persisted under its own key rather than overwritten.
    rerender({ key: "dash:SpaceCenter" });
    expect(idsOf(stored("dash:Flight").items ?? [])).toContain("f1");

    // Edit the new scene independently.
    act(() => result.current.addItem(item("sc1"), { w: 2, h: 2 }));

    // Back to Flight: its own edits return; the other scene's don't leak in.
    rerender({ key: "dash:Flight" });
    const ids = idsOf(result.current.items);
    expect(ids).toContain("f1");
    expect(ids).not.toContain("sc1");
  });
});
