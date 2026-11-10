import { act, render } from "@ksp-gonogo/sitrep-sdk/testing";
import { expectNoA11yViolations } from "@ksp-gonogo/ui-kit/testing";
import { useEffect, useRef } from "react";
import { describe, expect, it } from "vitest";
import { ScrollArea } from "./Panel";

/** Give a jsdom element the scroll geometry a browser would lay out. */
function scrollGeometry(
  el: HTMLElement,
  geometry: { scrollTop: number; clientHeight: number; scrollHeight: number },
): void {
  for (const [key, v] of Object.entries(geometry)) {
    Object.defineProperty(el, key, { configurable: true, value: v });
  }
}

/** The two glows, top then bottom, in render order after the scroller. */
function glows(container: HTMLElement): HTMLElement[] {
  const inner = container.querySelector("[data-scroll-area-inner]");
  const root = inner?.parentElement as HTMLElement;
  return [...root.children].slice(1) as HTMLElement[];
}

describe("ScrollArea", () => {
  it("shows the glow on whichever side there is more to scroll to", () => {
    const { container } = render(
      <ScrollArea>
        <div>row</div>
      </ScrollArea>,
    );
    const inner = container.querySelector(
      "[data-scroll-area-inner]",
    ) as HTMLElement;
    const [top, bottom] = glows(container);
    expect(getComputedStyle(top).opacity).toBe("0");
    expect(getComputedStyle(bottom).opacity).toBe("0");

    scrollGeometry(inner, {
      scrollTop: 40,
      clientHeight: 100,
      scrollHeight: 300,
    });
    act(() => {
      inner.dispatchEvent(new Event("scroll"));
    });

    expect(getComputedStyle(top).opacity).toBe("1");
    expect(getComputedStyle(bottom).opacity).toBe("1");
  });

  it("hands its ref the scrolling element by the time the owner's effects run", () => {
    let seen: HTMLElement | null = null;
    function Owner() {
      const ref = useRef<HTMLDivElement>(null);
      useEffect(() => {
        seen = ref.current;
      }, []);
      return (
        <ScrollArea ref={ref}>
          <div>row</div>
        </ScrollArea>
      );
    }
    render(<Owner />);
    expect(seen).not.toBeNull();
    expect(
      (seen as HTMLElement | null)?.hasAttribute("data-scroll-area-inner"),
    ).toBe(true);
  });

  it("has no axe violations", async () => {
    const { container } = render(
      <ScrollArea>
        <div>row</div>
      </ScrollArea>,
    );
    await expectNoA11yViolations(container);
  });
});
