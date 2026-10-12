import { act, fireEvent, render, screen } from "@ksp-gonogo/sitrep-sdk/testing";
import { expectNoA11yViolations } from "@ksp-gonogo/ui-kit/testing";
import { describe, expect, it, vi } from "vitest";
import { PanZoomViewport } from "./PanZoomViewport";
import { type UsePanZoomOptions, usePanZoom } from "./usePanZoom";

let latest: ReturnType<typeof usePanZoom>;

function Diagram(options: UsePanZoomOptions) {
  latest = usePanZoom(options);
  return (
    <PanZoomViewport panZoom={latest} label="Test diagram">
      <svg aria-hidden="true" width="400" height="200" />
    </PanZoomViewport>
  );
}

function viewport() {
  const el = screen.getByRole("group", { name: "Test diagram" });
  el.getBoundingClientRect = () =>
    ({
      left: 0,
      top: 0,
      width: 400,
      height: 200,
      right: 400,
      bottom: 200,
    }) as DOMRect;
  return el;
}

function wheel(el: Element, init: WheelEventInit) {
  const e = new WheelEvent("wheel", {
    bubbles: true,
    cancelable: true,
    ...init,
  });
  act(() => {
    el.dispatchEvent(e);
  });
  return e;
}

describe("usePanZoom", () => {
  it("zooms about the pointer so the point under it stays put", () => {
    render(<Diagram />);
    const el = viewport();
    wheel(el, { deltaY: -100, clientX: 300, clientY: 50 });
    const { zoom, panX, panY } = latest.camera;
    expect(zoom).toBeGreaterThan(1);
    // The diagram point under (300, 50) before the zoom was (100, -50) from the centre
    const wx = (300 - 200) / zoom + panX;
    const wy = (50 - 100) / zoom + panY;
    expect(wx).toBeCloseTo(100, 5);
    expect(wy).toBeCloseTo(-50, 5);
  });

  it("zooms about the centre when asked", () => {
    render(<Diagram zoomAbout="centre" />);
    wheel(viewport(), { deltaY: -100, clientX: 300, clientY: 50 });
    expect(latest.camera.panX).toBe(0);
    expect(latest.camera.panY).toBe(0);
  });

  it("holds the zoom inside the limits and lets the page scroll at the limit", () => {
    render(<Diagram minZoom={0.5} maxZoom={2} />);
    const el = viewport();
    wheel(el, { deltaY: 100 });
    expect(latest.camera.zoom).toBeGreaterThanOrEqual(0.5);
    for (let i = 0; i < 30; i++) wheel(el, { deltaY: 100 });
    expect(latest.camera.zoom).toBe(0.5);
    // A fresh gesture at the limit is not swallowed: the page keeps the wheel
    const atLimit = wheel(el, { deltaY: 100 });
    expect(atLimit.defaultPrevented).toBe(false);
  });

  it("pans by dragging, and counts a drag so its click can be ignored", () => {
    render(<Diagram />);
    const el = viewport();
    fireEvent.pointerDown(el, {
      pointerId: 1,
      clientX: 100,
      clientY: 100,
      button: 0,
    });
    fireEvent.pointerMove(el, { pointerId: 1, clientX: 140, clientY: 90 });
    expect(latest.camera.panX).toBe(-40);
    expect(latest.camera.panY).toBe(10);
    expect(latest.didPan()).toBe(true);
    fireEvent.pointerUp(el, { pointerId: 1 });
    expect(latest.isDragging).toBe(false);
  });

  it("does not count a press that stays under the threshold as a pan", () => {
    render(<Diagram panThreshold={4} />);
    const el = viewport();
    fireEvent.pointerDown(el, {
      pointerId: 1,
      clientX: 100,
      clientY: 100,
      button: 0,
    });
    fireEvent.pointerMove(el, { pointerId: 1, clientX: 102, clientY: 101 });
    expect(latest.didPan()).toBe(false);
    expect(latest.camera.panX).toBe(0);
  });

  it("lets go of a press the mouse released outside the element", () => {
    render(<Diagram panThreshold={4} />);
    const el = viewport();
    fireEvent.pointerDown(el, {
      pointerId: 1,
      pointerType: "mouse",
      clientX: 100,
      clientY: 100,
      button: 0,
      buttons: 1,
    });
    // Released outside the element: no pointerup ever arrives here.
    fireEvent.pointerMove(el, {
      pointerId: 1,
      pointerType: "mouse",
      clientX: 101,
      clientY: 100,
      buttons: 0,
    });
    fireEvent.pointerMove(el, {
      pointerId: 1,
      pointerType: "mouse",
      clientX: 160,
      clientY: 100,
      buttons: 0,
    });
    expect(latest.camera.panX).toBe(0);
    expect(latest.isDragging).toBe(false);
  });

  it("takes no drag or key while it is disabled", () => {
    render(<Diagram enabled={false} />);
    const el = viewport();
    fireEvent.pointerDown(el, {
      pointerId: 1,
      clientX: 100,
      clientY: 100,
      button: 0,
    });
    fireEvent.pointerMove(el, { pointerId: 1, clientX: 140, clientY: 90 });
    fireEvent.keyDown(el, { key: "ArrowRight" });
    expect(latest.camera.panX).toBe(0);
    expect(latest.didPan()).toBe(false);
  });

  it("zooms on a two-finger pinch", () => {
    render(<Diagram />);
    const el = viewport();
    fireEvent.pointerDown(el, { pointerId: 1, clientX: 150, clientY: 100 });
    fireEvent.pointerDown(el, { pointerId: 2, clientX: 250, clientY: 100 });
    fireEvent.pointerMove(el, { pointerId: 2, clientX: 350, clientY: 100 });
    fireEvent.pointerMove(el, { pointerId: 1, clientX: 50, clientY: 100 });
    expect(latest.camera.zoom).toBeGreaterThan(1);
  });

  it("operates from the keyboard: arrows pan, plus and minus zoom, 0 resets", () => {
    render(<Diagram />);
    const el = viewport();
    el.focus();
    fireEvent.keyDown(el, { key: "ArrowRight" });
    expect(latest.camera.panX).toBeCloseTo(60);
    fireEvent.keyDown(el, { key: "ArrowDown" });
    expect(latest.camera.panY).toBeCloseTo(30);
    fireEvent.keyDown(el, { key: "+" });
    expect(latest.camera.zoom).toBeCloseTo(1.25);
    fireEvent.keyDown(el, { key: "-" });
    expect(latest.camera.zoom).toBeCloseTo(1);
    fireEvent.keyDown(el, { key: "0" });
    expect(latest.camera).toEqual({ zoom: 1, panX: 0, panY: 0 });
  });

  it("ignores keys that belong to a control inside the diagram", () => {
    render(<Diagram />);
    const el = viewport();
    const part = document.createElement("button");
    el.appendChild(part);
    fireEvent.keyDown(part, { key: "ArrowRight", bubbles: true });
    expect(latest.camera.panX).toBe(0);
  });

  it("calls onManualMove for every hand move, so a follow can let go", () => {
    const onManualMove = vi.fn();
    render(<Diagram onManualMove={onManualMove} />);
    const el = viewport();
    fireEvent.keyDown(el, { key: "ArrowLeft" });
    wheel(el, { deltaY: -100 });
    expect(onManualMove.mock.calls).toEqual([["pan"], ["zoom"]]);
  });

  it("says how to operate the diagram from the keyboard when it takes focus by keyboard", () => {
    render(<Diagram />);
    const el = viewport();
    el.matches = () => true;
    fireEvent.focus(el);
    expect(screen.getByRole("status").textContent).toMatch(/arrow keys/i);
    fireEvent.blur(el);
    expect(screen.getByRole("status").textContent).toBe("");
  });

  it("shows no note for the pointer", () => {
    render(<Diagram />);
    const el = viewport();
    fireEvent.pointerMove(el, {
      pointerType: "mouse",
      clientX: 10,
      clientY: 10,
    });
    fireEvent.pointerMove(el, {
      pointerType: "mouse",
      clientX: 60,
      clientY: 30,
    });
    expect(screen.getByRole("status").textContent).toBe("");
  });

  it("has no axe violations, with and without the keyboard note", async () => {
    const { container } = render(<Diagram />);
    await expectNoA11yViolations(container);
    const el = viewport();
    fireEvent.pointerMove(el, {
      pointerType: "mouse",
      clientX: 10,
      clientY: 10,
    });
    fireEvent.pointerMove(el, {
      pointerType: "mouse",
      clientX: 50,
      clientY: 10,
    });
    await expectNoA11yViolations(container);
  });
});
