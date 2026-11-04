import { describe, expect, it } from "vitest";
import { placePlotReadouts } from "./plotReadoutPlacement";

describe("placePlotReadouts", () => {
  it("gives a roomy chart a column as wide as its content needs", () => {
    const placed = placePlotReadouts({
      width: 760,
      height: 260,
      contentWidth: 170,
    });
    expect(placed).toEqual({
      placement: "beside",
      columnWidth: 170,
      legendBelow: false,
    });
  });

  it("keeps a narrow or short chart's readouts over the plot", () => {
    const content = { contentWidth: 150 };
    expect(
      placePlotReadouts({ width: 200, height: 120, ...content }).placement,
    ).toBe("overlay");
    expect(
      placePlotReadouts({ width: 760, height: 90, ...content }).placement,
    ).toBe("overlay");
  });

  it("falls back to the plot when the content would not fit whole", () => {
    expect(
      placePlotReadouts({ width: 760, height: 260, contentWidth: 400 })
        .placement,
    ).toBe("overlay");
  });

  it("takes a column only from the width where the plot can spare it", () => {
    const content = { height: 260, contentWidth: 150 };
    expect(placePlotReadouts({ width: 720, ...content }).placement).toBe(
      "beside",
    );
    expect(placePlotReadouts({ width: 719, ...content }).placement).toBe(
      "below",
    );
  });

  it("keeps a chart too short for a strip under the plot over it", () => {
    expect(
      placePlotReadouts({ width: 600, height: 180, contentWidth: 150 })
        .placement,
    ).toBe("overlay");
  });
});
