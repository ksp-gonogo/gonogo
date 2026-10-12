import { act, fireEvent, render } from "@ksp-gonogo/test-utils";
import { PanZoomViewport } from "@ksp-gonogo/ui-kit";
import { describe, expect, it } from "vitest";
import { WORLD_H, WORLD_W, widestZoom } from "./camera";
import { useCamera } from "./useCamera";

let latest: ReturnType<typeof useCamera>;

function Harness({ size }: { size: { w: number; h: number } }) {
  latest = useCamera(size);
  return (
    <PanZoomViewport panZoom={latest.panZoom} label="Map">
      <span />
    </PanZoomViewport>
  );
}

/** Renders the hook on a surface of a fixed size: the rect the gestures measure is the tile's. */
function setup(size = { w: 200, h: 100 }) {
  const view = render(<Harness size={size} />);
  const el = view.getByRole("group", { name: "Map" });
  el.getBoundingClientRect = () =>
    ({
      left: 0,
      top: 0,
      width: size.w,
      height: size.h,
      right: size.w,
      bottom: size.h,
    }) as DOMRect;
  return el;
}

const down = (el: Element, pointerId: number, x: number, y: number) =>
  fireEvent.pointerDown(el, { pointerId, clientX: x, clientY: y, button: 0 });
const move = (el: Element, pointerId: number, x: number, y: number) =>
  fireEvent.pointerMove(el, { pointerId, clientX: x, clientY: y });

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

describe("useCamera", () => {
  it("pans with a single pointer", () => {
    const el = setup({ w: 200, h: 50 });
    const before = latest.camera;
    down(el, 1, 50, 50);
    move(el, 1, 70, 60);
    fireEvent.pointerUp(el, { pointerId: 1 });
    expect(latest.camera.panX).not.toBe(before.panX);
    expect(latest.camera.panY).not.toBe(before.panY);
    expect(latest.camera.zoom).toBe(before.zoom);
  });

  it("stops a drag at the poles, so nothing is banked to drag back", () => {
    const el = setup({ w: 200, h: 50 });
    down(el, 1, 50, 0);
    const { zoom } = latest.camera;
    const half = 50 / 2 / zoom;
    // Far further down the screen than the map is tall.
    for (let y = 100; y <= 3000; y += 100) move(el, 1, 50, y);
    expect(latest.camera.panY).toBeCloseTo(half, 6);
    move(el, 1, 50, 2900);
    // One step back up moves the view at once.
    expect(latest.camera.panY).toBeGreaterThan(half);
    for (let y = 2800; y >= -3000; y -= 100) move(el, 1, 50, y);
    expect(latest.camera.panY).toBeCloseTo(WORLD_H - half, 6);
  });

  it("starts at one world across and cannot zoom out from there", () => {
    setup({ w: 400, h: 100 });
    expect(latest.camera.zoom).toBe(widestZoom(400));
    expect(latest.baseZoom).toBe(widestZoom(400));
  });

  it("holds a tile too tall for the world on the world's middle", () => {
    setup({ w: 100, h: 400 });
    expect(latest.camera.panY).toBe(WORLD_H / 2);
  });

  it("pans without end: dragging past the world's edge carries on into the next repeat of it", () => {
    const el = setup();
    down(el, 1, 0, 50);
    const { zoom, panX: start } = latest.camera;
    // Each drag moves the view a fifth of a world east; six of them pass the edge.
    const step = (WORLD_W / 5) * zoom;
    for (let i = 1; i <= 6; i++) move(el, 1, -i * step, 50);
    const { panX } = latest.camera;
    expect(panX).toBeGreaterThanOrEqual(0);
    expect(panX).toBeLessThan(WORLD_W);
    expect(panX).toBeCloseTo((start + (6 * WORLD_W) / 5) % WORLD_W, 6);
  });

  it("zooms with a two-pointer pinch", () => {
    const el = setup();
    const before = latest.camera;
    down(el, 1, 80, 50);
    down(el, 2, 120, 50);
    move(el, 1, 40, 50);
    move(el, 2, 160, 50);
    expect(latest.camera.zoom).toBeGreaterThan(before.zoom);
  });

  it("resumes panning when one finger of a pinch lifts off", () => {
    const el = setup();
    down(el, 1, 80, 50);
    down(el, 2, 120, 50);
    fireEvent.pointerUp(el, { pointerId: 2 });
    const afterLift = latest.camera;
    move(el, 1, 110, 60);
    expect(latest.camera.zoom).toBe(afterLift.zoom);
    expect(latest.camera.panX).not.toBe(afterLift.panX);
  });

  it("leaves follow mode when the operator moves the view", () => {
    const el = setup();
    act(() => latest.setViewMode("follow"));
    wheelOn(el, { ctrlKey: true });
    expect(latest.viewMode).toBe("global");
  });
});

describe("useCamera wheel handling", () => {
  it("leaves a scroll that began outside the map to the page when it carries over the map", () => {
    const el = setup();
    const before = latest.camera.zoom;
    wheelOn(document.body, {});
    const ev = wheelOn(el, {});
    expect(ev.defaultPrevented).toBe(false);
    expect(latest.camera.zoom).toBe(before);
  });

  it("zooms on a wheel turn that began inside the map, and keeps it off the page", () => {
    const el = setup();
    const before = latest.camera.zoom;
    const ev = wheelOn(el, {});
    expect(ev.defaultPrevented).toBe(true);
    expect(latest.camera.zoom).toBeGreaterThan(before);
  });

  it("zooms on ctrl+wheel, the gesture a trackpad pinch sends, wherever the gesture began", () => {
    const el = setup();
    const before = latest.camera.zoom;
    wheelOn(document.body, {});
    const ev = wheelOn(el, { ctrlKey: true });
    expect(ev.defaultPrevented).toBe(true);
    expect(latest.camera.zoom).toBeGreaterThan(before);
  });
});
