import { getComponent } from "@ksp-gonogo/core";
import { describe, expect, it } from "vitest";
import "./index";

/**
 * Measured in a real browser with a node planned and the encounter read: the plan and the flight plan sit
 * side by side from two columns' width and both fit in 14 grid columns by 22 rows. A one-column tile
 * gets the same two views as tabs.
 */
describe("Maneuver Planner default size", () => {
  it("is the size its sections were measured to fit in", () => {
    expect(getComponent("maneuver-planner")?.defaultSize).toEqual({
      w: 14,
      h: 22,
    });
  });
});
