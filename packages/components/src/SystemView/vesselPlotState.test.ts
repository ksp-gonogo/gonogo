import { describe, expect, it } from "vitest";
import { vesselPlotStateFromStatus } from "./SystemDiagram";

describe("vesselPlotStateFromStatus", () => {
  it("is observed with no contributed status", () => {
    expect(vesselPlotStateFromStatus(null)).toBe("observed");
  });

  it("is observed for a directly-measured (non-reckoned) status", () => {
    expect(
      vesselPlotStateFromStatus({ severity: "critical", emphasis: "observed" }),
    ).toBe("observed");
  });

  it("maps info severity to predicted", () => {
    expect(
      vesselPlotStateFromStatus({ severity: "info", emphasis: "reckoned" }),
    ).toBe("predicted");
  });

  it("maps warning severity to overdue", () => {
    expect(
      vesselPlotStateFromStatus({ severity: "warning", emphasis: "reckoned" }),
    ).toBe("overdue");
  });

  it("maps critical severity to lost", () => {
    expect(
      vesselPlotStateFromStatus({ severity: "critical", emphasis: "reckoned" }),
    ).toBe("lost");
  });
});
