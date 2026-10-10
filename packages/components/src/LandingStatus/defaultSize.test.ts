import { getComponent } from "@ksp-gonogo/core";
import { describe, expect, it } from "vitest";
import { tilePixels } from "../../scripts/probe/payload";
import { MIN_PLOT_PX, plotGrid } from "../Plots/PlotBoard";
import "./index";

/** What the plots' column loses to the panel's inset, the altitude rail and the gutters, measured off the widget in a built Storybook at 8 to 16 columns. */
const COLUMN_OVERHEAD_PX = 114;
/** The gutter between two plots, from the plot board. */
const PLOT_GUTTER_PX = 8;

describe("the Landing Status default size", () => {
  it("is wide enough for all three plots to sit side by side, each the same size, so none wraps out of the tile", () => {
    const size = getComponent("landing-status")?.defaultSize;
    if (!size) throw new Error("expected a default size");
    const column = tilePixels(size.w, size.h).pxW - COLUMN_OVERHEAD_PX;
    expect(column).toBeGreaterThanOrEqual(3 * MIN_PLOT_PX + 2 * PLOT_GUTTER_PX);
    expect(plotGrid(3, column, PLOT_GUTTER_PX).columns).toBe(3);
  });
});
