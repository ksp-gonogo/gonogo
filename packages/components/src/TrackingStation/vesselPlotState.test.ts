import { describe, expect, it } from "vitest";
import { vesselPlotStateFromStatus } from "./VesselMarker";

describe("vesselPlotStateFromStatus", () => {
  it("is observed with no contributed status", () => {
    expect(vesselPlotStateFromStatus(null)).toBe("observed");
  });

  it("is observed for a directly-measured (non-reckoned) status", () => {
    expect(
      vesselPlotStateFromStatus({ tone: "nogo", emphasis: "observed" }),
    ).toBe("observed");
  });

  it("maps an info tone to predicted", () => {
    expect(
      vesselPlotStateFromStatus({ tone: "info", emphasis: "reckoned" }),
    ).toBe("predicted");
  });

  it("maps a warn tone to overdue", () => {
    expect(
      vesselPlotStateFromStatus({ tone: "warn", emphasis: "reckoned" }),
    ).toBe("overdue");
  });

  it("maps a nogo tone to lost", () => {
    expect(
      vesselPlotStateFromStatus({ tone: "nogo", emphasis: "reckoned" }),
    ).toBe("lost");
  });
});
