import { describe, expect, it } from "vitest";
import { convexHull } from "./outline";

describe("convexHull", () => {
  it("keeps the corners of a swept plate and drops the points inside it", () => {
    const hull = convexHull([
      { x: 0, y: 0 },
      { x: 2, y: 0 },
      { x: 3, y: 1 },
      { x: 0, y: 1 },
      { x: 1, y: 0.5 },
    ]);
    expect(hull).toHaveLength(4);
    expect(hull).not.toContainEqual({ x: 1, y: 0.5 });
  });

  it("has no outline for points that enclose no area", () => {
    expect(
      convexHull([
        { x: 0, y: 0 },
        { x: 1, y: 1 },
      ]),
    ).toEqual([]);
    expect(
      convexHull([
        { x: 0, y: 0 },
        { x: 1, y: 1 },
        { x: 2, y: 2 },
      ]),
    ).toEqual([]);
  });
});
