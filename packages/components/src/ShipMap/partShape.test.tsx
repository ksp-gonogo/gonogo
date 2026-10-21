import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { renderPartShape } from "./partShape";

const BOX = { x: 10, y: 20, w: 40, h: 80 };
const CENTER = { x: 30, y: 60 };

function stateHalf(outerSign: number): number[][] {
  const markup = renderToStaticMarkup(
    renderPartShape(
      "parachute",
      BOX,
      CENTER,
      "var(--color-info-mark)",
      false,
      1,
      outerSign,
      "armed",
    ),
  );
  const points = /data-role="parachute-state-half"[^>]*points="([^"]+)"/
    .exec(markup)?.[1]
    .split(" ")
    .map((pair) => pair.split(",").map(Number));
  return points ?? [];
}

/** The area a closed outline encloses; an outline that doubles back over itself encloses less. */
function area(points: number[][]): number {
  let sum = 0;
  for (let i = 0; i < points.length; i++) {
    const [x1, y1] = points[i];
    const [x2, y2] = points[(i + 1) % points.length];
    sum += x1 * y2 - x2 * y1;
  }
  return Math.abs(sum) / 2;
}

describe("a parachute's state half", () => {
  it.each([
    [1, "right"],
    [-1, "left"],
  ])("sits on the outer side for outer sign %i (%s) along a straight vertical line", (outerSign) => {
    const points = stateHalf(outerSign);
    const mid = BOX.x + BOX.w / 2;
    const inner =
      outerSign > 0
        ? points.map((p) => p[0] - mid)
        : points.map((p) => mid - p[0]);
    expect(Math.min(...inner)).toBeGreaterThanOrEqual(-1e-9);
    const seam = points.filter((p) => Math.abs(p[0] - mid) < 1e-9);
    expect(seam.length).toBe(2);
    expect(Math.abs(seam[0][0] - seam[1][0])).toBe(0);
  });

  it("covers the same area whichever side it is on", () => {
    const right = area(stateHalf(1));
    const left = area(stateHalf(-1));
    expect(right).toBeGreaterThan(0);
    expect(right / left).toBeCloseTo(1, 2);
  });
});

function gear(gearDown: boolean): string {
  return renderToStaticMarkup(
    renderPartShape(
      "gear",
      BOX,
      CENTER,
      "var(--color-info-mark)",
      false,
      1,
      1,
      undefined,
      gearDown,
    ),
  );
}

describe("a landing leg", () => {
  it("draws a leg that is down as a strut and a foot, with nothing painted for its box", () => {
    const markup = gear(true);
    expect(markup).toContain('data-role="gear-foot"');
    expect(markup).toContain("<line");
    const boxes = markup.match(/<rect[^>]*>/g) ?? [];
    for (const box of boxes) expect(box).toContain('fill="transparent"');
  });

  it("draws a leg that is folded as a dashed outline of the box it folds into", () => {
    const markup = gear(false);
    expect(markup).not.toContain('data-role="gear-foot"');
    expect(markup).not.toContain("<line");
    expect(markup).toContain("stroke-dasharray");
  });
});
