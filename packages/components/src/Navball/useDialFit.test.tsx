import { act, render } from "@ksp-gonogo/test-utils";
import { afterEach, describe, expect, it } from "vitest";
import { useDialFit } from "./useDialFit";

const observers: Array<(w: number, h: number) => void> = [];
const pristine = globalThis.ResizeObserver;

class FakeObserver implements ResizeObserver {
  constructor(private readonly cb: ResizeObserverCallback) {}
  observe(el: Element): void {
    observers.push((width, height) =>
      this.cb(
        [{ target: el, contentRect: { width, height } } as ResizeObserverEntry],
        this,
      ),
    );
  }
  unobserve(): void {}
  disconnect(): void {}
}

function Probe({ held }: { held: boolean }) {
  const { dialFit, attachAttitude } = useDialFit({
    reserveThrottle: false,
    controlSurface: false,
    controlRowWanted: false,
    dialPossible: false,
    held,
  });
  return (
    <div ref={attachAttitude}>
      <output>{dialFit}</output>
    </div>
  );
}

afterEach(() => {
  globalThis.ResizeObserver = pristine;
  observers.length = 0;
});

describe("useDialFit", () => {
  it("measures again on release a resize that was dropped while held", () => {
    globalThis.ResizeObserver = FakeObserver;
    const { container, rerender } = render(<Probe held={false} />);
    const fit = () => container.querySelector("output")?.textContent;
    act(() => observers[0](300, 374));
    expect(fit()).toBe("300");

    rerender(<Probe held />);
    act(() => observers[0](200, 274));
    expect(fit()).toBe("300");

    rerender(<Probe held={false} />);
    expect(fit()).toBe("200");
  });
});
