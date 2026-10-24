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

  it("adds several widgets in one report, each in its own slot", () => {
    const onChange = vi.fn();
    const { result } = renderHook(() =>
      useDashboardState(INITIAL, { onChange }),
    );

    act(() =>
      result.current.addItems([
        { item: item("a"), placement: { w: 3, h: 3 } },
        { item: item("b"), placement: { w: 3, h: 3 } },
      ]),
    );

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(idsOf(result.current.items)).toEqual(["a", "b"]);
    const [a, b] = result.current.layout;
    expect([a.i, b.i]).toEqual(["a", "b"]);
    expect([a.x, a.y]).not.toEqual([b.x, b.y]);
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
