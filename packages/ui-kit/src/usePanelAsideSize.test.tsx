import { describe, expect, it } from "vitest";
import { nextAsideCollapsed } from "./usePanelAsideSize";

/**
 * The hysteresis in isolation: given the previous state and this cycle's
 * measurements, whether the aside flips. The measured fit itself is exercised
 * through `PanelHeader` in `Panel.asideCollapse.test.tsx`.
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
    expect(nextAsideCollapsed(true, 310, 300)).toBe(true);
    expect(nextAsideCollapsed(true, 323, 300)).toBe(true);
  });

  it("re-expands only once there is room to spare", () => {
    expect(nextAsideCollapsed(true, 325, 300)).toBe(false);
    expect(nextAsideCollapsed(true, 400, 300)).toBe(false);
  });

  it("re-decides with no margin once the content itself is a different width", () => {
    // The dead band is for the room moving under the same content; content that shrank from 360 to 300 is a new question.
    expect(nextAsideCollapsed(true, 310, 300, 360)).toBe(false);
    expect(nextAsideCollapsed(true, 310, 300, 300)).toBe(true);
  });

  it("still collapses new content that does not fit", () => {
    expect(nextAsideCollapsed(false, 310, 400, 300)).toBe(true);
    expect(nextAsideCollapsed(true, 310, 320, 360)).toBe(true);
  });

  it("holds the previous state when either measurement is unavailable (0)", () => {
    // 0 means no measurement has landed yet, not "no room" or "no content".
    expect(nextAsideCollapsed(false, 0, 500)).toBe(false);
    expect(nextAsideCollapsed(false, 300, 0)).toBe(false);
    expect(nextAsideCollapsed(true, 0, 500)).toBe(true);
    expect(nextAsideCollapsed(true, 300, 0)).toBe(true);
  });
});
