import { describe, expect, it } from "vitest";
import { alignXY } from "./align";

describe("alignXY", () => {
  it("returns empty for empty inputs", () => {
    expect(alignXY({ t: [], v: [] }, { t: [], v: [] })).toEqual({
      x: [],
      y: [],
      breaks: [],
    });
  });

  it("pairs same-tick samples via nearest-prior match", () => {
    // Two keys from the same tick land a few ms apart; alignXY pairs them.
    const xs = { t: [1000, 2000, 3000], v: [10, 20, 30] };
    const ys = { t: [1002, 2001, 3003], v: [100, 200, 300] };
    const out = alignXY(ys, xs);
    expect(out).toEqual({ x: [10, 20, 30], y: [100, 200, 300], breaks: [] });
  });

  it("drops Y samples with no prior X within the tolerance", () => {
    // First Y arrives before any X; second Y has a prior X in window.
    const xs = { t: [500], v: [5] };
    const ys = { t: [100, 600], v: [1, 2] };
    const out = alignXY(ys, xs);
    expect(out).toEqual({ x: [5], y: [2], breaks: [] });
  });

  it("drops Y samples when the nearest X is older than the tolerance", () => {
    const xs = { t: [0], v: [99] };
    const ys = { t: [2000], v: [1] }; // 2s gap > 1s tolerance
    const out = alignXY(ys, xs, 1000);
    expect(out).toEqual({ x: [], y: [], breaks: [] });
  });

  it("uses the newest prior X when multiple are available", () => {
    const xs = { t: [1000, 1100, 1200], v: [10, 11, 12] };
    const ys = { t: [1150], v: [999] };
    const out = alignXY(ys, xs);
    expect(out).toEqual({ x: [11], y: [999], breaks: [] });
  });

  it("allows a custom tolerance", () => {
    const xs = { t: [0], v: [7] };
    const ys = { t: [5000], v: [1] };
    expect(alignXY(ys, xs, 10_000)).toEqual({ x: [7], y: [1], breaks: [] });
    expect(alignXY(ys, xs, 1_000)).toEqual({ x: [], y: [], breaks: [] });
  });

  // A break names a hole by INDEX, and this function reindexes: it drops any Y
  // sample it cannot pair with an X. Passed through unchanged the index would
  // break the trace at whatever sample happened to land there, which is a
  // wrong claim rather than a missing one.
  it("reindexes a break onto the output position of its own sample", () => {
    const xs = { t: [0, 1000, 2000], v: [10, 11, 12] };
    const ys = { t: [0, 1000, 2000], v: [1, 2, 3], breaks: [2] };
    expect(alignXY(ys, xs)).toEqual({
      x: [10, 11, 12],
      y: [1, 2, 3],
      breaks: [2],
    });
  });

  it("carries a break whose own sample is dropped onto the next survivor", () => {
    /**
     * The Y sample at t=500 has no prior X inside the tolerance and is
     * dropped; the hole it opened is still there, so the break lands on the
     * next sample that actually draws.
     */
    const xs = { t: [0, 2000], v: [10, 12] };
    const ys = { t: [0, 500, 2000], v: [1, 2, 3], breaks: [1] };
    expect(alignXY(ys, xs, 100)).toEqual({
      x: [10, 12],
      y: [1, 3],
      breaks: [1],
    });
  });

  it("never emits a break at index 0: nothing draws before the first point", () => {
    const xs = { t: [0, 1000], v: [10, 11] };
    const ys = { t: [0, 1000], v: [1, 2], breaks: [0] };
    expect(alignXY(ys, xs)).toEqual({ x: [10, 11], y: [1, 2], breaks: [] });
  });
});
