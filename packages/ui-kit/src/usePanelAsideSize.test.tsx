import { describe, expect, it } from "vitest";
import { nextAsideCollapsed } from "./usePanelAsideSize";

/**
 * Task 9/10 rework (operator review): the aside collapse is now a measured-fit
 * decision (`useHeaderAsideFit`, exercised end to end through `PanelHeader` in
 * `Panel.asideCollapse.test.tsx`) rather than a fixed `@container` width
 * threshold, so there is no longer a pure `asideSizeForWidth(width)` mapping to
 * unit test. What stays pure and worth testing in isolation is the hysteresis
 * itself: `nextAsideCollapsed` is the one function that decides, given the
 * previous state and this cycle's measurements, whether to flip.
 */
describe("nextAsideCollapsed", () => {
  it("collapses the instant content needs more room than is available, full -> collapsed", () => {
    expect(nextAsideCollapsed(false, 300, 301)).toBe(true);
    expect(nextAsideCollapsed(false, 300, 500)).toBe(true);
  });

  it("stays full whenever content fits, no margin required on this side", () => {
    expect(nextAsideCollapsed(false, 300, 300)).toBe(false);
    expect(nextAsideCollapsed(false, 300, 299)).toBe(false);
  });

  it("does NOT re-expand the instant content would merely fit again (the dead band)", () => {
    // Available is now bigger than needed, but by less than the re-expand
    // margin: staying collapsed here is the whole point of the hysteresis,
    // otherwise a panel sitting at the boundary would flip every cycle.
    expect(nextAsideCollapsed(true, 310, 300)).toBe(true);
    expect(nextAsideCollapsed(true, 323, 300)).toBe(true);
  });

  it("re-expands only once there is room to spare", () => {
    expect(nextAsideCollapsed(true, 325, 300)).toBe(false);
    expect(nextAsideCollapsed(true, 400, 300)).toBe(false);
  });

  it("holds the previous state when either measurement is unavailable (0)", () => {
    // 0 means "no real measurement landed yet" (jsdom, pre-layout, an
    // unfired ResizeObserver), not "no room" or "no content".
    expect(nextAsideCollapsed(false, 0, 500)).toBe(false);
    expect(nextAsideCollapsed(false, 300, 0)).toBe(false);
    expect(nextAsideCollapsed(true, 0, 500)).toBe(true);
    expect(nextAsideCollapsed(true, 300, 0)).toBe(true);
  });
});
