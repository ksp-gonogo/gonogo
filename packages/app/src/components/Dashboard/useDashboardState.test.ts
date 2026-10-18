import { act, render, renderHook } from "@ksp-gonogo/sitrep-sdk/testing";
import { createElement, useCallback, useEffect, useRef } from "react";
import { beforeEach, describe, expect, it } from "vitest";
import type { DashboardItem } from "./index";
import { useDashboardState } from "./useDashboardState";

const INITIAL = { items: [] as DashboardItem[], layout: [] };
const item = (i: string): DashboardItem => ({ i, componentId: "test" });
const idsOf = (items: readonly DashboardItem[]) => items.map((it) => it.i);
const stored = (key: string): { items?: DashboardItem[] } => {
  const parsed: unknown = JSON.parse(localStorage.getItem(key) ?? "{}");
  if (typeof parsed !== "object" || parsed === null) return {};
  const items = Reflect.get(parsed, "items");
  return Array.isArray(items) ? { items: items as DashboardItem[] } : {};
};

describe("useDashboardState: per-scene keys", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("reloads the saved layout when the storage key changes", () => {
    localStorage.setItem(
      "dash:Flight",
      JSON.stringify({
        items: [item("a")],
        layout: [{ i: "a", x: 0, y: 0, w: 3, h: 3 }],
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

    // Switch to a never-visited scene: seeded from current, and Flight's edits are persisted under its own key rather than overwritten.
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

describe("useDashboardState: a damaged saved layout", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("keeps the good items when one saved entry is not an item", () => {
    localStorage.setItem(
      "dash:base",
      JSON.stringify({ items: [item("a"), null, item("b")], layout: [] }),
    );
    const { result } = renderHook(() =>
      useDashboardState("dash:base", INITIAL),
    );
    expect(idsOf(result.current.items)).toEqual(["a", "b"]);
  });

  it("reads items that are not a list as none, without throwing", () => {
    localStorage.setItem(
      "dash:base",
      JSON.stringify({ items: "nope", layout: [] }),
    );
    const { result } = renderHook(() =>
      useDashboardState("dash:base", INITIAL),
    );
    expect(result.current.items).toEqual([]);
  });
});

describe("useDashboardState: a layout loaded because the scene changed", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  /** Replaces the dashboard from a child's effect on a key change, as the auto-switch prompt does. */
  function Child({
    sceneKey,
    replace,
  }: {
    sceneKey: string;
    replace: () => void;
  }) {
    const previous = useRef(sceneKey);
    useEffect(() => {
      if (previous.current === sceneKey) return;
      previous.current = sceneKey;
      replace();
    }, [sceneKey, replace]);
    return null;
  }

  it("is not undone by the incoming scene's saved layout, and is saved under that scene", () => {
    localStorage.setItem(
      "dash:Flight",
      JSON.stringify({ items: [item("saved")], layout: [] }),
    );
    const seen: { items: readonly DashboardItem[] } = { items: [] };
    function Parent({ sceneKey }: { sceneKey: string }) {
      const state = useDashboardState(sceneKey, INITIAL);
      seen.items = state.items;
      const { replaceState } = state;
      const replace = useCallback(
        () => replaceState([item("profile")], []),
        [replaceState],
      );
      return createElement(Child, { sceneKey, replace });
    }
    const { rerender } = render(
      createElement(Parent, { sceneKey: "dash:base" }),
    );
    rerender(createElement(Parent, { sceneKey: "dash:Flight" }));
    expect(idsOf(seen.items)).toEqual(["profile"]);
    expect(idsOf(stored("dash:Flight").items ?? [])).toEqual(["profile"]);
    expect(idsOf(stored("dash:base").items ?? [])).not.toContain("profile");
  });
});
