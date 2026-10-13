import { act, render, screen } from "@ksp-gonogo/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useMapResize } from "./useMapResize";

type Callback = (entries: { contentRect: DOMRect }[]) => void;

let live: { el: Element; cb: Callback }[] = [];

class FakeResizeObserver {
  constructor(private readonly cb: Callback) {}
  observe(el: Element) {
    live.push({ el, cb: this.cb });
  }
  disconnect() {
    live = live.filter((o) => o.cb !== this.cb);
  }
  unobserve() {}
}

function Probe({ show }: { show: boolean }) {
  const { outerRef, containerSize } = useMapResize();
  return (
    <div>
      {show && <div ref={outerRef} data-testid="outer" />}
      <span data-testid="size">
        {containerSize === null
          ? "none"
          : `${containerSize.w}x${containerSize.h}`}
      </span>
    </div>
  );
}

function resizeTo(width: number, height: number) {
  act(() => {
    for (const o of live) {
      o.cb([{ contentRect: { width, height } as DOMRect }]);
    }
  });
}

describe("useMapResize", () => {
  beforeEach(() => {
    live = [];
    vi.stubGlobal("ResizeObserver", FakeResizeObserver);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("measures a frame that mounts after the first render", () => {
    const { rerender } = render(<Probe show={false} />);
    rerender(<Probe show />);
    resizeTo(640, 320);
    expect(screen.getByTestId("size").textContent).toBe("640x320");
  });

  it("observes the new frame after the old one was detached", () => {
    const { rerender } = render(<Probe show />);
    rerender(<Probe show={false} />);
    rerender(<Probe show />);
    expect(live).toHaveLength(1);
    expect(live[0]?.el).toBe(screen.getByTestId("outer"));
  });
});
