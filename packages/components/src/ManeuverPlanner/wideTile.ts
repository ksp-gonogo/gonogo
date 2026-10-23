import { installFixedSizeResizeObserver } from "@ksp-gonogo/ui-kit/testing";
import { afterEach, beforeEach } from "vitest";

/**
 * Gives every element the tile width of a wide dashboard cell, which is what
 * lays the planner's plan and flight plan out side by side. jsdom measures
 * nothing, so without it the planner draws its one-column tabs and only the
 * plan is on screen. Call it at the top of a test file.
 */
export function wideTileForTests(): void {
  let restore: () => void = () => {};
  beforeEach(() => {
    restore = installFixedSizeResizeObserver({ width: 900, height: 700 });
  });
  afterEach(() => {
    restore();
  });
}
