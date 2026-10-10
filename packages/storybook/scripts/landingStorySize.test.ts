import "@ksp-gonogo/components";
import { getComponent } from "@ksp-gonogo/core";
import { describe, expect, it } from "vitest";
import { tilePixels } from "../../components/scripts/probe/payload";
import { plotGrid } from "../../components/src/Plots/PlotBoard";
import { COMPACT_SIZE, DEFAULT_SIZE, MIN_SIZE } from "./landingStorySize";

/** What the plots' column loses to the panel's inset, the altitude rail and the gutters, measured off the widget in a built Storybook. */
const COLUMN_OVERHEAD_PX = 114;
const PLOT_GUTTER_PX = 8;

const plotsAcross = (w: number) =>
  plotGrid(3, tilePixels(w, 1).pxW - COLUMN_OVERHEAD_PX, PLOT_GUTTER_PX)
    .columns;

describe("the Landing Status stories", () => {
  it("show the widget at the default size it registers", () => {
    expect(getComponent("landing-status")?.defaultSize).toEqual(DEFAULT_SIZE);
  });

  it("show the widget at the smallest size it registers", () => {
    expect(getComponent("landing-status")?.minSize).toEqual(MIN_SIZE);
  });

  it("show the compact size at the narrowest tile that holds three plots side by side", () => {
    expect(plotsAcross(COMPACT_SIZE.w)).toBe(3);
    expect(plotsAcross(COMPACT_SIZE.w - 1)).toBeLessThan(3);
  });
});
