import { act, render } from "@ksp-gonogo/sitrep-sdk/testing";
import { useRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useWheelGesture } from "./useWheelGesture";

function Page({ onZoom }: { onZoom: (f: number) => boolean | undefined }) {
  const ref = useRef<HTMLDivElement>(null);
  useWheelGesture(ref, onZoom);
  return (
    <div data-testid="page">
      <div data-testid="outside" />
      <div ref={ref} data-testid="diagram" />
    </div>
  );
}

function wheel(el: Element, init: WheelEventInit = {}): WheelEvent {
  const e = new WheelEvent("wheel", {
    bubbles: true,
    cancelable: true,
    deltaY: -100,
    ...init,
  });
  act(() => {
    el.dispatchEvent(e);
  });
  return e;
}

describe("useWheelGesture", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
  });
  afterEach(() => vi.useRealTimers());

  function setup(onZoom = vi.fn(() => true)) {
    const r = render(<Page onZoom={onZoom} />);
    return {
      onZoom,
      diagram: r.getByTestId("diagram"),
      outside: r.getByTestId("outside"),
    };
  }

  it("zooms and swallows a wheel that starts inside", () => {
    const { diagram, onZoom } = setup();
    const e = wheel(diagram);
    expect(onZoom).toHaveBeenCalledTimes(1);
    expect(e.defaultPrevented).toBe(true);
  });

  it("leaves a scroll that began outside alone when it reaches the diagram", () => {
    const { diagram, outside, onZoom } = setup();
    wheel(outside);
    vi.advanceTimersByTime(16);
    const e = wheel(diagram);
    expect(onZoom).not.toHaveBeenCalled();
    expect(e.defaultPrevented).toBe(false);
  });

  it("zooms with Ctrl even in a gesture that began outside", () => {
    const { diagram, outside, onZoom } = setup();
    wheel(outside);
    const e = wheel(diagram, { ctrlKey: true });
    expect(onZoom).toHaveBeenCalledTimes(1);
    expect(e.defaultPrevented).toBe(true);
  });

  it("lets the page scroll once a diagram at its limit has nothing to zoom", () => {
    const { diagram, onZoom } = setup(vi.fn(() => false));
    const first = wheel(diagram);
    vi.advanceTimersByTime(16);
    const second = wheel(diagram);
    expect(first.defaultPrevented).toBe(false);
    expect(second.defaultPrevented).toBe(false);
    expect(onZoom).toHaveBeenCalledTimes(1);
  });

  it("treats a scroll that moved the page under a still pointer as the page's, however slowly the next notch comes", () => {
    const { diagram, outside, onZoom } = setup();
    wheel(outside);
    act(() => {
      document.dispatchEvent(new Event("scroll"));
    });
    vi.advanceTimersByTime(5000);
    const e = wheel(diagram);
    expect(onZoom).not.toHaveBeenCalled();
    expect(e.defaultPrevented).toBe(false);
  });

  it("gives the diagram a gesture once the pointer really moves over it", () => {
    const { diagram, outside, onZoom } = setup();
    wheel(outside);
    act(() => {
      document.dispatchEvent(new Event("scroll"));
    });
    vi.advanceTimersByTime(5000);
    act(() => {
      diagram.dispatchEvent(
        new PointerEvent("pointermove", {
          bubbles: true,
          clientX: 40,
          clientY: 40,
        }),
      );
    });
    const e = wheel(diagram);
    expect(onZoom).toHaveBeenCalledTimes(1);
    expect(e.defaultPrevented).toBe(true);
  });

  it("does not take the browser's repeat of the pointer position after a scroll as the pointer moving", () => {
    const { diagram, outside, onZoom } = setup();
    wheel(outside, { clientX: 40, clientY: 40 });
    act(() => {
      document.dispatchEvent(new Event("scroll"));
    });
    act(() => {
      diagram.dispatchEvent(
        new PointerEvent("pointermove", {
          bubbles: true,
          clientX: 40,
          clientY: 40,
        }),
      );
    });
    vi.advanceTimersByTime(5000);
    const e = wheel(diagram, { clientX: 40, clientY: 40 });
    expect(onZoom).not.toHaveBeenCalled();
    expect(e.defaultPrevented).toBe(false);
  });
});
