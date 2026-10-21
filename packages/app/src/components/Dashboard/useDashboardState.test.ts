import { act, renderHook } from "@ksp-gonogo/sitrep-sdk/testing";
import { describe, expect, it, vi } from "vitest";
import type { DashboardItem } from "./index";
import { useDashboardState } from "./useDashboardState";

const INITIAL = { items: [] as DashboardItem[], layout: [] };
const item = (i: string): DashboardItem => ({ i, componentId: "test" });
const idsOf = (items: readonly DashboardItem[]) => items.map((it) => it.i);

describe("useDashboardState", () => {
  it("starts from the initial dashboard without reporting a change", () => {
    const onChange = vi.fn();
    const { result } = renderHook(() =>
      useDashboardState({ items: [item("a")], layout: [] }, { onChange }),
    );
    expect(idsOf(result.current.items)).toEqual(["a"]);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("reports each change to the items or the layout", () => {
    const onChange = vi.fn();
    const { result } = renderHook(() =>
      useDashboardState(INITIAL, { onChange }),
    );

    act(() => result.current.addItem(item("a"), { w: 2, h: 2 }));
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(idsOf(onChange.mock.calls[0][0])).toEqual(["a"]);

    act(() => result.current.removeItem("a"));
    expect(onChange).toHaveBeenLastCalledWith([], []);
  });

  it("replaces the whole dashboard in one report", () => {
    const onChange = vi.fn();
    const { result } = renderHook(() =>
      useDashboardState(INITIAL, { onChange }),
    );

    act(() =>
      result.current.replaceState(
        [item("x")],
        [{ i: "x", x: 0, y: 0, w: 3, h: 3 }],
      ),
    );

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(idsOf(result.current.items)).toEqual(["x"]);
  });

  it("tells item subscribers about a change", () => {
    const { result } = renderHook(() => useDashboardState(INITIAL));
    const seen = vi.fn();
    result.current.subscribeItems(seen);

    act(() => result.current.addItem(item("a"), { w: 2, h: 2 }));

    expect(seen).toHaveBeenCalledTimes(1);
  });
});
