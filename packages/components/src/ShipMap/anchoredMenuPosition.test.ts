import { describe, expect, it } from "vitest";
import { anchoredMenuPosition } from "./anchoredMenuPosition";

const VIEWPORT = { w: 1000, h: 800 };
const MENU = { w: 200, h: 300 };

describe("anchoredMenuPosition", () => {
  it("opens below-right of the anchor when there is room", () => {
    expect(anchoredMenuPosition({ x: 100, y: 100 }, MENU, VIEWPORT)).toEqual({
      left: 112,
      top: 112,
    });
  });

  it("flips above the anchor rather than sliding up the bottom edge", () => {
    // 700 + 12 + 300 overruns the 800-high viewport; flipping up fits, and a
    // menu above the part still reads as attached to it, where one pinned to the
    // bottom of the screen would cover the part it belongs to.
    expect(anchoredMenuPosition({ x: 100, y: 700 }, MENU, VIEWPORT).top).toBe(
      700 - 12 - 300,
    );
  });

  it("flips left of the anchor when the right edge is close", () => {
    expect(anchoredMenuPosition({ x: 950, y: 100 }, MENU, VIEWPORT).left).toBe(
      950 - 12 - 200,
    );
  });

  it("clamps into the viewport when neither side fits", () => {
    // Taller than the window: no flip can fit it, so it starts on screen and its
    // own scroll box carries the rest. The alternative (a negative top) puts the
    // first items above the top edge, where nothing can scroll them back.
    const tall = { w: 200, h: 900 };
    const { top } = anchoredMenuPosition({ x: 100, y: 400 }, tall, VIEWPORT);
    expect(top).toBe(8);
  });

  it("keeps an unmeasured menu at the anchor", () => {
    // The first render happens before the menu can be measured; a zero box must
    // resolve to the plain anchor offset rather than to some clamped corner.
    expect(
      anchoredMenuPosition({ x: 300, y: 300 }, { w: 0, h: 0 }, VIEWPORT),
    ).toEqual({ left: 312, top: 312 });
  });
});
