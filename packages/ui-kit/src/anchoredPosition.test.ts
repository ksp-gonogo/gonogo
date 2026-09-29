import { describe, expect, it } from "vitest";
import { anchoredPosition } from "./anchoredPosition";

const VIEWPORT = { w: 1000, h: 800 };
const MENU = { w: 200, h: 300 };

describe("anchoredPosition", () => {
  it("opens below-right of the anchor when there is room", () => {
    expect(anchoredPosition({ x: 100, y: 100 }, MENU, VIEWPORT)).toEqual({
      left: 112,
      top: 112,
    });
  });

  it("flips above the anchor rather than sliding up the bottom edge", () => {
    // 700 + 12 + 300 overruns the 800-high viewport, so it flips above the part and still reads as attached.
    expect(anchoredPosition({ x: 100, y: 700 }, MENU, VIEWPORT).top).toBe(
      700 - 12 - 300,
    );
  });

  it("flips left of the anchor when the right edge is close", () => {
    expect(anchoredPosition({ x: 950, y: 100 }, MENU, VIEWPORT).left).toBe(
      950 - 12 - 200,
    );
  });

  it("clamps into the viewport when neither side fits", () => {
    // Taller than the window: it starts on screen and its own scroll box carries the rest; a negative top would be unreachable.
    const tall = { w: 200, h: 900 };
    const { top } = anchoredPosition({ x: 100, y: 400 }, tall, VIEWPORT);
    expect(top).toBe(8);
  });

  it("keeps an unmeasured menu at the anchor", () => {
    // The first render is unmeasured; a zero box resolves to the plain anchor offset.
    expect(
      anchoredPosition({ x: 300, y: 300 }, { w: 0, h: 0 }, VIEWPORT),
    ).toEqual({ left: 312, top: 312 });
  });
});
