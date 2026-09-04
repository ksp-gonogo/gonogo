import { describe, expect, it } from "vitest";
import {
  buildBandPath,
  buildPath,
  buildSegmentedPath,
  buildStepPath,
  makeLogScale,
  makeScale,
  niceLogTicks,
  niceTicks,
} from "./lineChartMath";

const id = (v: number) => v;

describe("makeScale", () => {
  it("maps the domain bounds to the range bounds", () => {
    const s = makeScale(0, 10, 0, 100);
    expect(s(0)).toBe(0);
    expect(s(10)).toBe(100);
    expect(s(5)).toBe(50);
  });

  it("collapses to the midpoint when domain has zero span", () => {
    const s = makeScale(7, 7, 0, 100);
    expect(s(7)).toBe(50);
    expect(s(99)).toBe(50);
  });
});

describe("niceTicks", () => {
  it("returns 5 evenly-spaced ticks for a clean range", () => {
    const ticks = niceTicks(0, 100, 5);
    expect(ticks).toEqual([0, 25, 50, 75, 100]);
  });

  it("falls back to bounds when min equals max with count < 2 effective ticks", () => {
    const ticks = niceTicks(5, 5, 5);
    // All 5 entries are 5
    expect(ticks).toHaveLength(5);
    expect(new Set(ticks)).toEqual(new Set([5]));
  });
});

describe("buildPath", () => {
  it("returns empty for empty arrays", () => {
    expect(buildPath([], [], id, id)).toBe("");
  });

  it("joins points with M then L commands", () => {
    expect(buildPath([0, 1, 2], [0, 10, 20], id, id)).toBe(
      "M0.00,0.00 L1.00,10.00 L2.00,20.00",
    );
  });

  // A break is a span the chart HAS NO READINGS FOR: a blackout, or a
  // recording whose oldest span overran the recorder. Joined across, it draws a
  // straight line the operator cannot tell from data, which is the one thing
  // this chart must never do. A fresh `M` is what stops it.
  it("starts a new subpath at a break index instead of joining across it", () => {
    expect(buildPath([0, 1, 2, 3], [0, 10, 20, 30], id, id, [2])).toBe(
      "M0.00,0.00 L1.00,10.00 M2.00,20.00 L3.00,30.00",
    );
  });

  it("ignores an empty or absent break list", () => {
    const joined = "M0.00,0.00 L1.00,10.00";
    expect(buildPath([0, 1], [0, 10], id, id, [])).toBe(joined);
    expect(buildPath([0, 1], [0, 10], id, id)).toBe(joined);
  });
});

describe("buildStepPath", () => {
  it("holds Y until the next X then jumps", () => {
    // Three samples: y starts at 0, rises to 5, falls to 2.
    const path = buildStepPath([0, 1, 2], [0, 5, 2], id, id);
    expect(path).toBe("M0.00,0.00 H1.00 V5.00 H2.00 V2.00");
  });

  it("omits the V step when Y doesn't change", () => {
    const path = buildStepPath([0, 1, 2], [3, 3, 3], id, id);
    expect(path).toBe("M0.00,3.00 H1.00 H2.00");
  });

  it("returns empty for empty input", () => {
    expect(buildStepPath([], [], id, id)).toBe("");
  });

  /**
   * The step builder needs the break too, and needs it MORE than the line
   * builder does: a step holds its value across the gap, so joining across a
   * blackout asserts the state did not change while out of contact, which is
   * exactly what nobody knows.
   */
  it("starts a new subpath at a break index instead of holding across it", () => {
    expect(buildStepPath([0, 1, 2], [0, 5, 2], id, id, [2])).toBe(
      "M0.00,0.00 H1.00 V5.00 M2.00,2.00",
    );
  });
});

describe("buildBandPath", () => {
  it("returns empty for empty input", () => {
    expect(buildBandPath([], [], [], id, id)).toBe("");
  });

  it("traces high forward then low reverse and closes", () => {
    const path = buildBandPath([0, 1], [0, 1], [10, 11], id, id);
    expect(path).toBe("M0.00,10.00 L1.00,11.00 L1.00,1.00 L0.00,0.00 Z");
  });

  it("clamps to the shortest of the three arrays", () => {
    const path = buildBandPath([0, 1, 2], [0, 1], [10, 11, 12], id, id);
    // n = 2: final third sample is ignored
    expect(path).not.toContain("2.00,12.00");
  });
});

describe("makeLogScale", () => {
  it("maps powers of 10 evenly across the range", () => {
    const s = makeLogScale(1, 1000, 0, 100);
    expect(s(1)).toBeCloseTo(0);
    expect(s(10)).toBeCloseTo(100 / 3);
    expect(s(100)).toBeCloseTo(200 / 3);
    expect(s(1000)).toBeCloseTo(100);
  });

  it("clamps non-positive input to the domain floor instead of returning NaN", () => {
    const s = makeLogScale(1, 1000, 0, 100);
    expect(s(0)).toBeCloseTo(0);
    expect(s(-50)).toBeCloseTo(0);
  });

  it("collapses to the midpoint when domain bounds are the same", () => {
    const s = makeLogScale(100, 100, 0, 100);
    expect(s(100)).toBe(50);
  });
});

describe("niceLogTicks", () => {
  it("returns powers of 10 within the domain", () => {
    const ticks = niceLogTicks(1, 1000);
    expect(ticks).toEqual([1, 10, 100, 1000]);
  });

  it("falls back to linear ticks for sub-decade ranges", () => {
    const ticks = niceLogTicks(50, 200);
    expect(ticks).toEqual(niceTicks(50, 200, 5));
  });

  it("falls back when bounds are non-positive", () => {
    expect(niceLogTicks(0, 100)).toEqual(niceTicks(0, 100, 5));
  });

  it("strides over decades when the span is large", () => {
    const ticks = niceLogTicks(1, 1e10, 4);
    // 11 decades, count=4 → stride 3 → exponents 0, 3, 6, 9
    expect(ticks).toEqual([1, 1000, 1_000_000, 1_000_000_000]);
  });
});

/**
 * `breaks` says what the trace has NO readings for; a span says which of its
 * readings did not arrive live. They answer different questions and a chart
 * needs both: a run drawn identically to the live one claims the craft was in
 * contact throughout, which is the falsehood the blackout model exists to
 * stop.
 */
describe("buildSegmentedPath", () => {
  it("returns one whole-series run when nothing is spanned", () => {
    expect(
      buildSegmentedPath([0, 1, 2], [0, 10, 20], id, id, buildPath),
    ).toEqual([{ d: "M0.00,0.00 L1.00,10.00 L2.00,20.00" }]);
  });

  it("cuts the series at a status change and names each run", () => {
    const segments = buildSegmentedPath(
      [0, 1, 2, 3],
      [0, 10, 20, 30],
      id,
      id,
      buildPath,
      [],
      [{ from: 2, to: 3, status: "recorded" }],
    );
    expect(segments.map((s) => s.status)).toEqual([undefined, "recorded"]);
    // The joining segment belongs to the RUN IT ENTERS, drawn once: the newer
    // endpoint is the newer provenance. Without the reach-back the line would
    // have a one-segment hole between the two runs that means nothing.
    expect(segments[0].d).toBe("M0.00,0.00 L1.00,10.00");
    expect(segments[1].d).toBe("M1.00,10.00 L2.00,20.00 L3.00,30.00");
  });

  it("does not reach back across a break", () => {
    // The recorder overran: the trace has a hole AND resumes on recorded data,
    // which is the real reacquisition shape. Nothing joins into index 2, so the
    // recorded run must not borrow the sample before it.
    const segments = buildSegmentedPath(
      [0, 1, 2, 3],
      [0, 10, 20, 30],
      id,
      id,
      buildPath,
      [2],
      [{ from: 2, to: 3, status: "recorded" }],
    );
    expect(segments[1].d).toBe("M2.00,20.00 L3.00,30.00");
  });

  it("keeps a break inside a run", () => {
    const segments = buildSegmentedPath(
      [0, 1, 2, 3],
      [0, 10, 20, 30],
      id,
      id,
      buildPath,
      [2],
      [],
    );
    expect(segments).toEqual([
      { d: "M0.00,0.00 L1.00,10.00 M2.00,20.00 L3.00,30.00" },
    ]);
  });

  it("splits a step path the same way", () => {
    const segments = buildSegmentedPath(
      [0, 1, 2],
      [0, 10, 20],
      id,
      id,
      buildStepPath,
      [],
      [{ from: 1, to: 2, status: "last-before-blackout" }],
    );
    expect(segments.map((s) => s.status)).toEqual([
      undefined,
      "last-before-blackout",
    ]);
    expect(segments[1].d).toBe("M0.00,0.00 H1.00 V10.00 H2.00 V20.00");
  });

  it("ignores a span that names indices the series does not have", () => {
    const segments = buildSegmentedPath(
      [0, 1],
      [0, 10],
      id,
      id,
      buildPath,
      [],
      [{ from: 5, to: 9, status: "recorded" }],
    );
    expect(segments).toEqual([{ d: "M0.00,0.00 L1.00,10.00" }]);
  });

  it("cuts a reckoned run and carries the basis that moved it", () => {
    const segments = buildSegmentedPath(
      [0, 1, 2, 3],
      [0, 10, 20, 30],
      id,
      id,
      buildPath,
      [],
      [],
      [{ from: 2, to: 3, basis: "kepler-propagation" }],
    );
    expect(segments.map((s) => s.basis)).toEqual([
      undefined,
      "kepler-propagation",
    ]);
    // Same reach-back as a status run: the joining segment lands in the run it
    // enters, so the line does not lose a segment at the handover.
    expect(segments[0].d).toBe("M0.00,0.00 L1.00,10.00");
    expect(segments[1].d).toBe("M1.00,10.00 L2.00,20.00 L3.00,30.00");
  });

  it("cuts on a reckoning change even where the stream status is unchanged", () => {
    // A run that is recorded throughout and reckoned onward from its midpoint
    // is two DRAWABLE runs, because only the second is muted and dashed.
    const segments = buildSegmentedPath(
      [0, 1, 2, 3],
      [0, 10, 20, 30],
      id,
      id,
      buildPath,
      [],
      [{ from: 0, to: 3, status: "recorded" }],
      [{ from: 2, to: 3, basis: "linear-dead-reckoning" }],
    );
    expect(segments.map((s) => [s.status, s.basis])).toEqual([
      ["recorded", undefined],
      ["recorded", "linear-dead-reckoning"],
    ]);
  });

  it("ignores a reckoned run that names indices the series does not have", () => {
    const segments = buildSegmentedPath(
      [0, 1],
      [0, 10],
      id,
      id,
      buildPath,
      [],
      [],
      [{ from: 5, to: 9, basis: "rate-integration" }],
    );
    expect(segments).toEqual([{ d: "M0.00,0.00 L1.00,10.00" }]);
  });
});
