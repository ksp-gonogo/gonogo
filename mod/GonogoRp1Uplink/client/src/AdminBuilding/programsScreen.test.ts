import { describe, expect, it } from "vitest";
import { PROGRAMS_SCREEN } from "./programsScreen";

/**
 * The screen this Uplink adds to the Administration Building. What the host does
 * with it (orders the strip, filters the list, draws the tabs) is the host's own
 * suite; what belongs here is that the entry says the right things about RP-1.
 */
describe("RP-1 Programs screen", () => {
  it("claims the department name RP-1 actually puts on the wire", () => {
    /*
     * `Programs` is the `STRATEGY_DEPARTMENT` name in RP-1's Departments.cfg,
     * and the same string reaches the host as `department` on every entry of
     * `career.status`'s strategy list. Spelling it the way the department's
     * `title` reads ("Select Programs") would claim a department that does not
     * exist and quietly list nothing.
     */
    expect(PROGRAMS_SCREEN[0].departments).toEqual(["Programs"]);
  });

  it("is labelled as a place rather than as the game's instruction", () => {
    expect(PROGRAMS_SCREEN[0].label).toBe("Programs");
  });

  it("states an order, since the config file's own order does not travel", () => {
    expect(PROGRAMS_SCREEN[0].order).toBe(10);
  });

  it("hands back the identical array every time, so it never churns the slot", () => {
    /*
     * The aggregation compares entries by reference to decide whether a slot
     * changed; a fresh literal per call would recompute the strip every frame and
     * put a constant on the slot's own recompute budget.
     */
    expect(Object.isFrozen(PROGRAMS_SCREEN)).toBe(true);
    expect(Object.isFrozen(PROGRAMS_SCREEN[0])).toBe(true);
  });
});
