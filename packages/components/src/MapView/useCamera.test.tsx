import { act, render, renderHook } from "@ksp-gonogo/test-utils";
import { describe, expect, it } from "vitest";
import { makeInteractionElement, pointerEvent } from "../test/pointerStubs";
import { useCamera } from "./useCamera";

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
  hook.result.current.interactionRef.current = el;
  return { hook, el };
}

describe("useCamera", () => {
  it("pans with a single pointer", () => {
    const { hook, el } = setup();
    const before = hook.result.current.camera;

    act(() => {
      hook.result.current.onPointerDown(
        pointerEvent({
          pointerId: 1,
          clientX: 50,
          clientY: 50,
          currentTarget: el,
        }),
      );
    });
    act(() => {
      hook.result.current.onPointerMove(
        pointerEvent({
          pointerId: 1,
          clientX: 70,
          clientY: 60,
          currentTarget: el,
        }),
      );
    });
    act(() => {
      hook.result.current.onPointerUp(
        pointerEvent({
          pointerId: 1,
          clientX: 70,
          clientY: 60,
          currentTarget: el,
        }),
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
        pointerEvent({
          pointerId: 1,
          clientX: 80,
          clientY: 50,
          currentTarget: el,
        }),
      );
      hook.result.current.onPointerDown(
        pointerEvent({
          pointerId: 2,
          clientX: 120,
          clientY: 50,
          currentTarget: el,
        }),
      );
    });
    // Spread the fingers further apart: should zoom in (larger zoom value)
    act(() => {
      hook.result.current.onPointerMove(
        pointerEvent({
          pointerId: 1,
          clientX: 40,
          clientY: 50,
          currentTarget: el,
        }),
      );
      hook.result.current.onPointerMove(
        pointerEvent({
          pointerId: 2,
          clientX: 160,
          clientY: 50,
          currentTarget: el,
        }),
      );
    });

    expect(hook.result.current.camera.zoom).toBeGreaterThan(before.zoom);
  });

  it("resumes panning when one finger of a pinch lifts off", () => {
    const { hook, el } = setup();

    act(() => {
      hook.result.current.onPointerDown(
        pointerEvent({
          pointerId: 1,
          clientX: 80,
          clientY: 50,
          currentTarget: el,
        }),
      );
      hook.result.current.onPointerDown(
        pointerEvent({
          pointerId: 2,
          clientX: 120,
          clientY: 50,
          currentTarget: el,
        }),
      );
    });
    act(() => {
      hook.result.current.onPointerUp(
        pointerEvent({
          pointerId: 2,
          clientX: 120,
          clientY: 50,
          currentTarget: el,
        }),
      );
    });
    const afterLift = hook.result.current.camera;

    // Remaining finger now pans; no zoom jump.
    act(() => {
      hook.result.current.onPointerMove(
        pointerEvent({
          pointerId: 1,
          clientX: 110,
          clientY: 60,
          currentTarget: el,
        }),
      );
    });

    const after = hook.result.current.camera;
    expect(after.zoom).toBe(afterLift.zoom);
    expect(after.panX).not.toBe(afterLift.panX);
  });
});

/**
 * A real DOM element carrying `interactionRef`, the way MapView's
 * CanvasContainer does, so the native wheel listener the hook attaches is
 * actually on the node the test dispatches to. The fake element the pointer
 * tests use has a no-op `addEventListener`, so it cannot see this path.
 */
function WheelHarness() {
  const { interactionRef, camera } = useCamera({ w: 200, h: 100 });
  return <div ref={interactionRef} data-zoom={camera.zoom} />;
}

function wheelOn(el: Element, init: WheelEventInit): WheelEvent {
  const ev = new WheelEvent("wheel", {
    deltaY: -100,
    cancelable: true,
    bubbles: true,
    ...init,
  });
  act(() => {
    el.dispatchEvent(ev);
  });
  return ev;
}

describe("useCamera wheel handling", () => {
  it("leaves a plain wheel to the page so a dashboard taller than the viewport still scrolls", () => {
    const { container } = render(<WheelHarness />);
    const surface = container.firstElementChild as HTMLElement;
    const before = surface.dataset.zoom;

    const ev = wheelOn(surface, {});

    expect(ev.defaultPrevented).toBe(false);
    expect(surface.dataset.zoom).toBe(before);
  });

  it("zooms on ctrl+wheel, the gesture a trackpad pinch sends, and keeps that one off the page", () => {
    const { container } = render(<WheelHarness />);
    const surface = container.firstElementChild as HTMLElement;
    const before = Number(surface.dataset.zoom);

    const ev = wheelOn(surface, { ctrlKey: true });

    expect(ev.defaultPrevented).toBe(true);
    expect(Number(surface.dataset.zoom)).toBeGreaterThan(before);
  });
});
