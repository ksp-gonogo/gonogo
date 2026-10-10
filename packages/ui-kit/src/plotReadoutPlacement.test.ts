import { describe, expect, it } from "vitest";
import { placePlotReadouts } from "./plotReadoutPlacement";

describe("placePlotReadouts", () => {
  it("gives a roomy chart a column as wide as its content needs", () => {
    const placed = placePlotReadouts({
      width: 760,
      height: 260,
      contentWidth: 170,
    });
    expect(placed).toEqual({ placement: "beside", columnWidth: 170 });
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

  it("leaves the plot its width at the narrowest chart that takes a column", () => {
    expect(
      placePlotReadouts({ width: 480, height: 200, contentWidth: 150 })
        .placement,
    ).toBe("beside");
    expect(
      placePlotReadouts({ width: 480, height: 200, contentWidth: 190 })
        .placement,
    ).toBe("overlay");
  });
});
