import { act, render } from "@ksp-gonogo/test-utils";
import { useRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useFoldSnap } from "./useFoldSnap";

/** Each observer's callback, called by the test when it means a size to have changed. */
const observers = new Set<() => void>();

class FakeResizeObserver {
  constructor(private readonly callback: () => void) {}
  observe(): void {
    observers.add(this.callback);
  }
  unobserve(): void {}
  disconnect(): void {
    observers.delete(this.callback);
  }
}

function resize(): void {
  act(() => {
    for (const callback of [...observers]) callback();
  });
}

/** Two readouts 50 px tall, the second 60 px down a scroller whose fold is 100 px. */
const geometry = { firstHeight: 50 };

function rect(top: number, height: number): DOMRect {
  return { top, height, bottom: top + height } as DOMRect;
}

function Stack({ tick }: Readonly<{ tick: number }>) {
  const wrapper = useRef<HTMLDivElement>(null);
  const window = useRef<HTMLDivElement>(null);
  useFoldSnap(wrapper, window, true);
  return (
    <div data-testid="scroller">
      <div ref={window}>
        <div ref={wrapper}>
          <div>
            <div data-testid="first">first {tick}</div>
            <div data-testid="second">second</div>
          </div>
        </div>
      </div>
    </div>
  );
}

describe("useFoldSnap", () => {
  let measured: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.stubGlobal("ResizeObserver", FakeResizeObserver);
    vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockImplementation(
      function (this: HTMLElement) {
        return this.dataset.testid === "scroller" ? 100 : 0;
      },
    );
    vi.spyOn(HTMLElement.prototype, "scrollHeight", "get").mockImplementation(
      function (this: HTMLElement) {
        return this.dataset.testid === "scroller" ? 300 : 0;
      },
    );
    measured = vi
      .spyOn(HTMLElement.prototype, "getBoundingClientRect")
      .mockImplementation(function (this: HTMLElement) {
        if (this.dataset.testid === "first") {
          return rect(0, geometry.firstHeight);
        }
        if (this.dataset.testid === "second") {
          return rect(geometry.firstHeight + 10, 50);
        }
        return rect(0, 0);
      });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    observers.clear();
    geometry.firstHeight = 50;
  });

  it("moves the first readout the glow would dim down to the fold", () => {
    const { getByTestId } = render(<Stack tick={0} />);
    expect(getByTestId("second").style.marginTop).toBe("40px");
  });

  it("measures nothing when a render changes no size", () => {
    const { rerender } = render(<Stack tick={0} />);
    const before = measured.mock.calls.length;
    rerender(<Stack tick={1} />);
    rerender(<Stack tick={2} />);
    expect(measured.mock.calls.length).toBe(before);
  });

  it("settles again when a readout above changes height", () => {
    const { getByTestId } = render(<Stack tick={0} />);
    geometry.firstHeight = 60;
    resize();
    expect(getByTestId("second").style.marginTop).toBe("30px");
  });
});
