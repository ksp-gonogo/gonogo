import { describe, expect, it } from "vitest";
import { widestZoom } from "./usePanZoom";

const AT_CENTRE = { x: 0, y: 0 };

describe("widestZoom", () => {
  it("keeps the standing limit where the frame body has no parent", () => {
    expect(widestZoom(null, AT_CENTRE)).toBe(0.3);
  });

  it("keeps the standing limit when the parent's distance is not known", () => {
    expect(
      widestZoom(
        { parentAtPlotUnits: Number.NaN, halfPicturePlotUnits: 140 },
        AT_CENTRE,
      ),
    ).toBe(0.3);
  });

  it("never narrows the limit for a parent already within it", () => {
    expect(
      widestZoom(
        { parentAtPlotUnits: 40, halfPicturePlotUnits: 140 },
        AT_CENTRE,
      ),
    ).toBe(0.3);
  });

  it("widens to hold a distant parent with a margin", () => {
    const zoom = widestZoom(
      { parentAtPlotUnits: 600, halfPicturePlotUnits: 140 },
      AT_CENTRE,
    );
    expect(zoom).toBeLessThan(0.3);
    // The parent's distance, with its margin, fits in what is left of the half picture once the edge pointer's inset is kept.
    expect(600 * zoom).toBeLessThan(140);
  });

  it("widens further for a view centred away from the frame body", () => {
    const parent = { parentAtPlotUnits: 600, halfPicturePlotUnits: 140 };
    expect(widestZoom(parent, { x: 100, y: 0 })).toBeLessThan(
      widestZoom(parent, AT_CENTRE),
    );
  });
});
