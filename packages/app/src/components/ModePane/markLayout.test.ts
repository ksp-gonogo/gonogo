import { describe, expect, it } from "vitest";
import { layoutMarks } from "./markLayout";

describe("the Timeline's mark labels", () => {
  it("centres a label on its moment where there is room", () => {
    expect(layoutMarks([100, 400], [40, 60], 800, 4)).toEqual([80, 370]);
  });

  it("moves labels that would overlap apart, in order", () => {
    // Three marks within 6 percent of a long range, as a node, an encounter and a return are.
    expect(layoutMarks([10, 30, 48], [44, 30, 46], 800, 4)).toEqual([
      0, 48, 82,
    ]);
  });

  it("keeps the last label inside the track and moves its neighbours back", () => {
    expect(layoutMarks([720, 790], [60, 60], 800, 4)).toEqual([676, 740]);
  });
});
