import { afterEach, describe, expect, it } from "vitest";
import { kspCalendar, kspYearDays, setKspCalendar } from "./calendar";
import { value } from "./value";

/**
 * A day is not a constant, and arithmetic has to know that too.
 *
 * The display half of this shipped first and looked complete: `formatDuration`
 * and `<Unit>` followed the calendar the game reported. But `Value` resolved
 * its ratios out of the baked catalogue, so a duration that was FORMATTED read
 * one way and the same duration COMPUTED read another, and nothing said so.
 * These tests are the arithmetic half.
 */

const EARTH = { minute: 60, hour: 3600, day: 86_400, year: 365 * 86_400 };

afterEach(() => {
  // Module state: leak it and the next test formats on someone else's
  // calendar, which is the exact failure this whole module is about.
  setKspCalendar();
});

describe("the calendar the game reported", () => {
  it("stands the stock Kerbin figures in until told otherwise", () => {
    expect(kspCalendar().day).toBe(21_600);
    expect(kspYearDays()).toBe(426);
    expect(value("s", 86_400).in("d").magnitude).toBe(4);
  });

  it("changes what a day converts to, which is the whole bug", () => {
    setKspCalendar(EARTH);
    // Before this, the baked 21,600 stood and this answered 4. Nothing about
    // "4 days" looks wrong on screen, which is how it survived so long.
    expect(value("s", 86_400).in("d").magnitude).toBe(1);
    expect(kspYearDays()).toBe(365);
  });

  it("changes what adding across two time units means", () => {
    expect(value("h", 1).plus(value("d", 1)).magnitude).toBe(7);
    setKspCalendar(EARTH);
    expect(value("h", 1).plus(value("d", 1)).magnitude).toBe(25);
  });

  it("flips a comparison, so a guard reads the other way", () => {
    // The sharpest form of the bug: not a number that looks slightly off, but
    // a boolean that inverts. A "more than 20 hours of life support left"
    // check answers NO for one day of stock time and YES for one Earth day.
    expect(value("d", 1).greaterThan(value("h", 20))).toBe(false);
    setKspCalendar(EARTH);
    expect(value("d", 1).greaterThan(value("h", 20))).toBe(true);
  });

  it("leaves a PHYSICAL unit alone, hour in it or not", () => {
    // `km/h` has an hour in its name and is not game time: it is an
    // SI-adjacent speed whose hour is 3,600 real seconds whatever Kerbin is
    // doing. Only `h` as a DURATION follows the game.
    expect(value("km/h", 36).in("m/s").magnitude).toBe(10);
    setKspCalendar(EARTH);
    expect(value("km/h", 36).in("m/s").magnitude).toBe(10);
  });

  it("leaves WALL-CLOCK time alone, which is why it has its own dimension", () => {
    // How long ago a reading arrived is measured by the clock on the desk. No
    // planet pack moves that, and `irl:` carries a separate dimension so the
    // two can never be confused for one another.
    expect(value("irl:d", 1).in("irl:h").magnitude).toBe(24);
    setKspCalendar(EARTH);
    expect(value("irl:d", 1).in("irl:h").magnitude).toBe(24);
  });

  it("refuses a calendar nobody can divide by and keeps the last good one", () => {
    setKspCalendar({ day: 0 });
    // Dividing by it would make every duration in the app infinity, which is
    // a worse answer than the stock one already on screen.
    expect(kspCalendar().day).toBe(21_600);
    expect(value("s", 86_400).in("d").magnitude).toBe(4);
  });

  it("takes a partial report and fills the rest from stock", () => {
    setKspCalendar({ day: 86_400 });
    expect(kspCalendar().day).toBe(86_400);
    expect(kspCalendar().minute).toBe(60);
  });

  it("goes back to stock when passed nothing", () => {
    setKspCalendar(EARTH);
    setKspCalendar();
    expect(value("s", 86_400).in("d").magnitude).toBe(4);
  });
});
