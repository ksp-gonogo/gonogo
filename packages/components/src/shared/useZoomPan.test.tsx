import { act, renderHook } from "@ksp-gonogo/test-utils";
import type { RefObject } from "react";
import { describe, expect, it } from "vitest";
import { useZoomPan } from "./useZoomPan";

type PointerFields = Partial<{
  pointerId: number;
  clientX: number;
  clientY: number;
  currentTarget: HTMLDivElement;
}>;

function makeEl(): HTMLDivElement {
  return {
    setPointerCapture() {},
    releasePointerCapture() {},
    getBoundingClientRect: () => ({
      left: 0,
      top: 0,
      width: 200,
      height: 100,
      right: 200,
      bottom: 100,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    }),
    addEventListener() {},
    removeEventListener() {},
  } as unknown as HTMLDivElement;
}

function ptr(
  fields: PointerFields,
  el: HTMLDivElement,
): React.PointerEvent<HTMLDivElement> {
  return {
    pointerId: fields.pointerId ?? 1,
    clientX: fields.clientX ?? 0,
    clientY: fields.clientY ?? 0,
    currentTarget: fields.currentTarget ?? el,
  } as unknown as React.PointerEvent<HTMLDivElement>;
}

function setup() {
  const el = makeEl();
  const hook = renderHook(() => useZoomPan<HTMLDivElement>());
  (hook.result.current.ref as unknown as RefObject<HTMLDivElement>).current =
    el;
  return { hook, el };
}

describe("useZoomPan", () => {
  it("pans with a single pointer once movement exceeds the threshold", () => {
    const { hook, el } = setup();
    const { onPointerDown, onPointerMove, onPointerUp } =
      hook.result.current.pointerHandlers;
    const before = hook.result.current.cam;

    act(() => {
      onPointerDown(ptr({ pointerId: 1, clientX: 50, clientY: 50 }, el));
    });
    act(() => {
      onPointerMove(ptr({ pointerId: 1, clientX: 80, clientY: 70 }, el));
    });
    act(() => {
      onPointerUp(ptr({ pointerId: 1, clientX: 80, clientY: 70 }, el));
    });

    const after = hook.result.current.cam;
    expect(after.panX).not.toBe(before.panX);
    expect(after.panY).not.toBe(before.panY);
    expect(after.zoom).toBe(before.zoom);
  });

  it("ignores tiny pointer movements (under panThreshold)", () => {
    const { hook, el } = setup();
    const { onPointerDown, onPointerMove } =
      hook.result.current.pointerHandlers;
    const before = hook.result.current.cam;

    act(() => {
      onPointerDown(ptr({ pointerId: 1, clientX: 50, clientY: 50 }, el));
    });
    // 1px in each axis — well under the default 4px threshold.
    act(() => {
      onPointerMove(ptr({ pointerId: 1, clientX: 51, clientY: 51 }, el));
    });

    expect(hook.result.current.cam).toEqual(before);
  });

  it("zooms with a two-pointer pinch", () => {
    const { hook, el } = setup();
    const { onPointerDown, onPointerMove } =
      hook.result.current.pointerHandlers;
    const before = hook.result.current.cam;

    act(() => {
      onPointerDown(ptr({ pointerId: 1, clientX: 80, clientY: 50 }, el));
      onPointerDown(ptr({ pointerId: 2, clientX: 120, clientY: 50 }, el));
    });
    // Spread fingers further apart — should zoom in.
    act(() => {
      onPointerMove(ptr({ pointerId: 1, clientX: 40, clientY: 50 }, el));
      onPointerMove(ptr({ pointerId: 2, clientX: 160, clientY: 50 }, el));
    });

    expect(hook.result.current.cam.zoom).toBeGreaterThan(before.zoom);
  });

  it("zoomAbout doubles scale around the given screen point", () => {
    const { hook } = setup();
    const before = hook.result.current.cam;
    const sx = 73;
    const sy = 41;
    // World point under (sx, sy) before the zoom — must remain pinned after.
    const worldX = (sx - before.panX) / before.zoom;
    const worldY = (sy - before.panY) / before.zoom;

    act(() => {
      hook.result.current.zoomAbout(2, sx, sy);
    });

    const after = hook.result.current.cam;
    expect(after.zoom).toBeCloseTo(before.zoom * 2);
    // Same world point should still sit under (sx, sy).
    expect((sx - after.panX) / after.zoom).toBeCloseTo(worldX);
    expect((sy - after.panY) / after.zoom).toBeCloseTo(worldY);
  });

  it("reset returns to identity transform", () => {
    const { hook, el } = setup();
    const { onPointerDown, onPointerMove } =
      hook.result.current.pointerHandlers;

    act(() => {
      onPointerDown(ptr({ pointerId: 1, clientX: 0, clientY: 0 }, el));
    });
    act(() => {
      onPointerMove(ptr({ pointerId: 1, clientX: 50, clientY: 50 }, el));
    });
    act(() => {
      hook.result.current.zoomAbout(2, 25, 25);
    });
    expect(hook.result.current.cam).not.toEqual({ zoom: 1, panX: 0, panY: 0 });

    act(() => {
      hook.result.current.reset();
    });
    expect(hook.result.current.cam).toEqual({ zoom: 1, panX: 0, panY: 0 });
  });

  it("clamps zoom to the configured min/max", () => {
    const el = makeEl();
    const hook = renderHook(() =>
      useZoomPan<HTMLDivElement>({ minScale: 0.5, maxScale: 4 }),
    );
    (hook.result.current.ref as unknown as RefObject<HTMLDivElement>).current =
      el;

    act(() => {
      hook.result.current.zoomAbout(100, 0, 0);
    });
    expect(hook.result.current.cam.zoom).toBe(4);

    act(() => {
      hook.result.current.zoomAbout(0.001, 0, 0);
    });
    expect(hook.result.current.cam.zoom).toBe(0.5);
  });
});
