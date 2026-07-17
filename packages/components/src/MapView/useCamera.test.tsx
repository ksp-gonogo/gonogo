import { act, renderHook } from "@ksp-gonogo/test-utils";
import type { RefObject } from "react";
import { describe, expect, it } from "vitest";
import { useCamera } from "./useCamera";

type PointerFields = Partial<{
  pointerId: number;
  clientX: number;
  clientY: number;
  currentTarget: HTMLDivElement;
}>;

function ptr(fields: PointerFields): React.PointerEvent<HTMLDivElement> {
  const el =
    fields.currentTarget ??
    ({
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
    } as unknown as HTMLDivElement);

  return {
    pointerId: fields.pointerId ?? 1,
    clientX: fields.clientX ?? 0,
    clientY: fields.clientY ?? 0,
    currentTarget: el,
  } as unknown as React.PointerEvent<HTMLDivElement>;
}

/**
 * Renders the hook with a fixed container size and attaches a fake element to
 * interactionRef so the pinch path (which reads getBoundingClientRect) works.
 */
function setup() {
  const el = {
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

  const hook = renderHook(() => useCamera({ w: 200, h: 100 }));
  (
    hook.result.current.interactionRef as unknown as RefObject<HTMLDivElement>
  ).current = el;
  return { hook, el };
}

describe("useCamera", () => {
  it("pans with a single pointer", () => {
    const { hook, el } = setup();
    const before = hook.result.current.camera;

    act(() => {
      hook.result.current.onPointerDown(
        ptr({ pointerId: 1, clientX: 50, clientY: 50, currentTarget: el }),
      );
    });
    act(() => {
      hook.result.current.onPointerMove(
        ptr({ pointerId: 1, clientX: 70, clientY: 60, currentTarget: el }),
      );
    });
    act(() => {
      hook.result.current.onPointerUp(
        ptr({ pointerId: 1, clientX: 70, clientY: 60, currentTarget: el }),
      );
    });

    const after = hook.result.current.camera;
    expect(after.panX).not.toBe(before.panX);
    expect(after.panY).not.toBe(before.panY);
    expect(after.zoom).toBe(before.zoom);
  });

  it("zooms with a two-pointer pinch", () => {
    const { hook, el } = setup();
    const before = hook.result.current.camera;

    act(() => {
      hook.result.current.onPointerDown(
        ptr({ pointerId: 1, clientX: 80, clientY: 50, currentTarget: el }),
      );
      hook.result.current.onPointerDown(
        ptr({ pointerId: 2, clientX: 120, clientY: 50, currentTarget: el }),
      );
    });
    // Spread the fingers further apart — should zoom in (larger zoom value)
    act(() => {
      hook.result.current.onPointerMove(
        ptr({ pointerId: 1, clientX: 40, clientY: 50, currentTarget: el }),
      );
      hook.result.current.onPointerMove(
        ptr({ pointerId: 2, clientX: 160, clientY: 50, currentTarget: el }),
      );
    });

    expect(hook.result.current.camera.zoom).toBeGreaterThan(before.zoom);
  });

  it("resumes panning when one finger of a pinch lifts off", () => {
    const { hook, el } = setup();

    act(() => {
      hook.result.current.onPointerDown(
        ptr({ pointerId: 1, clientX: 80, clientY: 50, currentTarget: el }),
      );
      hook.result.current.onPointerDown(
        ptr({ pointerId: 2, clientX: 120, clientY: 50, currentTarget: el }),
      );
    });
    act(() => {
      hook.result.current.onPointerUp(
        ptr({ pointerId: 2, clientX: 120, clientY: 50, currentTarget: el }),
      );
    });
    const afterLift = hook.result.current.camera;

    // Remaining finger now pans; no zoom jump.
    act(() => {
      hook.result.current.onPointerMove(
        ptr({ pointerId: 1, clientX: 110, clientY: 60, currentTarget: el }),
      );
    });

    const after = hook.result.current.camera;
    expect(after.zoom).toBe(afterLift.zoom);
    expect(after.panX).not.toBe(afterLift.panX);
  });
});
