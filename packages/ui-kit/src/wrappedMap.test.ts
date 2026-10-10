import { describe, expect, it } from "vitest";
import { repeatsInView, splitAtPoleCrossings, wrapPath } from "./wrappedMap";

const xs = (copies: { x: number }[][]) => copies.map((c) => c.map((p) => p.x));

describe("wrapPath", () => {
  it("carries a path on past the world's east edge instead of jumping back across it", () => {
    // A 100 px world: 90 then 5 is a step of 15 east, not 85 west.
    const path = [{ x: 80 }, { x: 90 }, { x: 5 }, { x: 15 }];
    expect(xs(wrapPath(path, 100, 0, 100))).toEqual([
      [-20, -10, 5, 15],
      [80, 90, 105, 115],
    ]);
  });

  it("never draws a step longer than half the world", () => {
    const path = [-170, -178, 175, 168, -179, 179].map((x) => ({ x }));
    for (const copy of wrapPath(path, 360, -180, 180)) {
      for (let i = 1; i < copy.length; i++)
        expect(Math.abs(copy[i].x - copy[i - 1].x)).toBeLessThan(180);
    }
  });

  it("draws one copy for each repeat of the world the view shows", () => {
    // A view three worlds wide sees a short path three times.
    const copies = wrapPath([{ x: 40 }, { x: 60 }], 100, -100, 200);
    expect(xs(copies)).toEqual([
      [-60, -40],
      [40, 60],
      [140, 160],
    ]);
  });

  it("keeps each point's other fields", () => {
    const [copy] = wrapPath([{ x: 10, alpha: 0.5 }], 100, 0, 100);
    expect(copy).toEqual([{ x: 10, alpha: 0.5 }]);
  });

  it("draws nothing for an empty path or a world with no width", () => {
    expect(wrapPath([], 100, 0, 100)).toEqual([]);
    expect(wrapPath([{ x: 1 }], 0, 0, 100)).toEqual([]);
  });
});

describe("repeatsInView", () => {
  it("is only the unshifted copy when the span sits inside the view", () => {
    expect(repeatsInView(20, 30, 0, 100, 100)).toEqual([0]);
  });

  it("finds the copy of a point far east of the view", () => {
    expect(repeatsInView(1050, 1050, 0, 100, 100)).toEqual([-1000]);
  });

  it("finds both copies of a span the view's west edge cuts", () => {
    expect(repeatsInView(80, 120, 100, 200, 100)).toEqual([0, 100]);
  });

  it("finds nothing for a span that never reaches the view", () => {
    expect(repeatsInView(10, 20, 30, 40, 100)).toEqual([]);
    expect(repeatsInView(Number.NaN, 20, 0, 40, 100)).toEqual([]);
  });
});

describe("splitAtPoleCrossings", () => {
  it("breaks a polar pass where it goes over the pole", () => {
    const pass = [
      { lat: 86, lon: 10 },
      { lat: 88, lon: 10 },
      { lat: 88, lon: -170 },
      { lat: 86, lon: -170 },
    ];
    expect(splitAtPoleCrossings(pass)).toEqual([
      pass.slice(0, 2),
      pass.slice(2),
    ]);
  });

  it("does not break at the antimeridian", () => {
    const pass = [
      { lat: 10, lon: 175 },
      { lat: 11, lon: -178 },
      { lat: 12, lon: -171 },
    ];
    expect(splitAtPoleCrossings(pass)).toEqual([pass]);
  });

  it("leaves a high-latitude turn that the sampling resolves whole", () => {
    const turn = [
      { lat: 79, lon: 0 },
      { lat: 80, lon: 10 },
      { lat: 79, lon: 20 },
    ];
    expect(splitAtPoleCrossings(turn)).toEqual([turn]);
  });
});
