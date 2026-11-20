import { describe, expect, it } from "vitest";
import { RANGE_MARK, rangePart } from "./rangeMarkSpec";

describe("the standard for drawing a range", () => {
  it("counts a value at the moment on screen as reached, and one after it as ahead", () => {
    expect(rangePart(100, 100)).toBe("reached");
    expect(rangePart(99, 100)).toBe("reached");
    expect(rangePart(100.5, 100)).toBe("ahead");
  });

  it("draws the part ahead as the same line, dimmer and thinner", () => {
    expect(RANGE_MARK.reached).toEqual({ alpha: 1, width: 1 });
    expect(RANGE_MARK.ahead.alpha).toBeLessThan(RANGE_MARK.reached.alpha);
    expect(RANGE_MARK.ahead.width).toBeLessThan(RANGE_MARK.reached.width);
  });
});
