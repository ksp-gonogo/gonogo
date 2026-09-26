import { describe, expect, it } from "vitest";
import { horizontalOf } from "./index";

describe("horizontalOf", () => {
  it("is what is left of the surface speed once the vertical part is taken out", () => {
    // 3-4-5: surface 500, vertical 300, horizontal 400.
    expect(horizontalOf(500, 300)).toBeCloseTo(400, 9);
    expect(horizontalOf(500, -300)).toBeCloseTo(400, 9);
  });

  it("clamps to 0, never NaN, when the vertical speed exceeds the surface speed", () => {
    // Two independently reported speeds can disagree by rounding on a craft moving straight up or down.
    expect(horizontalOf(100, 100.000001)).toBe(0);
  });
});
