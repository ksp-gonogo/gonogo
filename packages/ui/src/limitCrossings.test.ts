import { describe, expect, it } from "vitest";
import { limitCrossings } from "./limitCrossings";

/** A trace drawn one sample every ten pixels, with a figure of 100 at the top of a 100 pixel plot. */
function crossings(
  y: number[],
  over: Partial<Parameters<typeof limitCrossings>[0]> = {},
) {
  return limitCrossings({
    y,
    cx: y.map((_, i) => i * 10),
    cy: y.map((v) => 100 - v),
    limit: 50,
    limitY: 50,
    bad: "above",
    minGapPx: 14,
    ...over,
  });
}

describe("limitCrossings", () => {
  it("finds nothing on a trace that stays inside the limit", () => {
    expect(crossings([10, 20, 30, 40])).toEqual([]);
  });

  it("puts one crossing where the trace meets the limit's line, part-way between the two samples either side", () => {
    expect(crossings([10, 30, 70, 90])).toEqual([
      { index: 2, x: 15, y: 50, entered: true, spells: 1 },
    ]);
  });

  it("reads a floor the other way up", () => {
    expect(crossings([90, 70, 30, 10], { bad: "below" })).toEqual([
      { index: 2, x: 15, y: 50, entered: true, spells: 1 },
    ]);
    expect(crossings([10, 30, 70, 90], { bad: "below" })).toEqual([
      { index: 0, x: 0, y: 90, entered: false, spells: 1 },
    ]);
  });

  it("marks a trace past the limit from its first sample on the trace, as not entered in view", () => {
    expect(crossings([60, 70, 80])).toEqual([
      { index: 0, x: 0, y: 40, entered: false, spells: 1 },
    ]);
  });

  it("gives each spell past the limit its own crossing once they are far enough apart", () => {
    const found = crossings([10, 90, 90, 10, 10, 90]);
    expect(found.map((c) => c.index)).toEqual([1, 5]);
  });

  it("stands one entry for a run of spells that start closer together than the gap, however long the run", () => {
    const chatter = Array.from({ length: 40 }, (_, i) => (i % 2 ? 60 : 40));
    const found = crossings(chatter, { cx: chatter.map((_, i) => i * 5) });
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ index: 1, spells: 20 });
  });

  it("starts a fresh entry once the chatter has stopped for longer than the gap", () => {
    const y = [40, 60, 40, 60, 40, 40, 40, 40, 40, 60];
    const found = crossings(y, { cx: y.map((_, i) => i * 5) });
    expect(found.map((c) => [c.index, c.spells])).toEqual([
      [1, 2],
      [9, 1],
    ]);
  });

  it("meets the line at the sample on a step trace, and after a hole", () => {
    expect(crossings([10, 30, 70], { step: true })[0]).toMatchObject({
      x: 20,
      y: 50,
    });
    expect(crossings([10, 30, 70], { breaks: [2] })[0]).toMatchObject({
      x: 20,
      y: 50,
      entered: true,
    });
  });

  it("keeps one spell across a hole that is past the limit on both sides", () => {
    expect(crossings([10, 70, Number.NaN, 80, 90])).toHaveLength(1);
    expect(crossings([10, 70, 80, 90], { breaks: [2] })).toHaveLength(1);
  });
});
