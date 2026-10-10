import { describe, expect, it } from "vitest";
import { placePlotReadouts } from "./plotReadoutPlacement";

describe("placePlotReadouts", () => {
  it("gives a roomy chart a column beside the plot", () => {
    const placed = placePlotReadouts({ width: 760, height: 260 });
    expect(placed.placement).toBe("beside");
  });

  it("keeps a narrow or short chart's readouts over the plot", () => {
    expect(placePlotReadouts({ width: 200, height: 120 }).placement).toBe(
      "overlay",
    );
    expect(placePlotReadouts({ width: 760, height: 90 }).placement).toBe(
      "overlay",
    );
  });

  it("bounds the column so the plot keeps most of the width", () => {
    const wide = placePlotReadouts({ width: 2000, height: 400 });
    const narrow = placePlotReadouts({ width: 480, height: 200 });
    if (wide.placement !== "beside" || narrow.placement !== "beside") {
      throw new Error("expected a column");
    }
    expect(wide.columnWidth).toBeLessThanOrEqual(168);
    expect(narrow.columnWidth).toBeGreaterThanOrEqual(104);
  });
});
