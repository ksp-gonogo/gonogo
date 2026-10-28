import { describe, expect, it } from "vitest";
import { boxLayoutFor } from "./ClusterLayer";

describe("boxLayoutFor", () => {
  it("keeps full size and two columns where the view is roomy", () => {
    const l = boxLayoutFor(4, 800, 600);
    expect(l.scale).toBe(1);
    expect(l.boxH).toBeLessThanOrEqual(600 - 12);
  });

  it("shrinks to fit a small view instead of overflowing it", () => {
    const l = boxLayoutFor(8, 300, 240);
    expect(l.boxW).toBeLessThanOrEqual(300 * 0.6);
    expect(l.boxH).toBeLessThanOrEqual(240 - 12 + 1e-6);
  });

  it("never shrinks below the readable floor", () => {
    expect(boxLayoutFor(40, 200, 150).scale).toBeGreaterThanOrEqual(0.4);
  });
});
