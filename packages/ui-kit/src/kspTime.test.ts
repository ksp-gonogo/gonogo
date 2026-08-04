import { afterEach, describe, expect, it } from "vitest";
import { formatDuration, formatIrlDuration } from "./formatDuration";
import { formatKspDate } from "./formatKspDate";
import { kspCalendar, kspYearDays, setKspCalendar } from "./kspTime";
import { formatQuantity } from "./units";

/**
 * The calendar is not a constant, and every one of these fails against the
 * version of this package that thought it was.
 *
 * A day is 21,600s on stock Kerbin time and 86,400s under a planet pack or
 * with the stock `GameSettings.KERBIN_TIME` setting turned off. That is a
 * factor of four in every duration and every date the app prints, in numbers
 * that look entirely plausible either way, which is why it went unnoticed.
 */

/** Real days, real year: RSS, or simply KERBIN_TIME switched off. */
const EARTH = { minute: 60, hour: 3600, day: 86_400, year: 365 * 86_400 };

afterEach(() => {
  // Back to the stock fallback, or one test's calendar leaks into the next.
  setKspCalendar();
});

describe("the calendar the game reported", () => {
  it("defaults to stock Kerbin time", () => {
    expect(kspCalendar().day).toBe(21_600);
    expect(kspYearDays()).toBe(426);
  });

  it("changes every duration at once", () => {
    expect(formatDuration(86_400)).toBe("4d");
    setKspCalendar(EARTH);
    expect(formatDuration(86_400)).toBe("1d");
  });

  it("changes the date readout, which is the same bug wearing a Y/D label", () => {
    // One stock Kerbin year in. On Kerbin that is exactly Y2 D1. The same
    // instant on an Earth calendar is 9,201,600 / 86,400 = 106.5 days, so
    // midday on D107 of year one: the HALF day is the tell that these are two
    // different calendars rather than two labels for one.
    const oneKerbinYear = 426 * 21_600;
    expect(formatKspDate(oneKerbinYear)).toBe("Y2 D1 00:00:00");
    setKspCalendar(EARTH);
    expect(formatKspDate(oneKerbinYear)).toBe("Y1 D107 12:00:00");
  });

  it("changes the unit ladder, so <Unit> follows too", () => {
    expect(formatQuantity(86_400, "s").value).toBe("4d");
    setKspCalendar(EARTH);
    expect(formatQuantity(86_400, "s").value).toBe("1d");
  });

  it("changes a PINNED day, which reads off the ratio rather than the ladder", () => {
    // Zero decimals: the `time` kind rounds to whole units.
    expect(formatQuantity(86_400, "s", { format: "d" }).value).toBe("4");
    setKspCalendar(EARTH);
    expect(formatQuantity(86_400, "s", { format: "d" }).value).toBe("1");
  });

  it("leaves WALL-CLOCK durations alone", () => {
    // The whole point of the irlTime split. How long ago a reading arrived is
    // measured by the clock on the desk; no planet pack moves that.
    expect(formatIrlDuration(86_400)).toBe("1d");
    setKspCalendar(EARTH);
    expect(formatIrlDuration(86_400)).toBe("1d");
  });

  it("refuses a calendar nobody can divide by, and keeps the last good one", () => {
    // A zero day-length renders every duration in the app as infinity, which
    // is a worse answer than the stock fallback already on screen.
    setKspCalendar({ day: 0 });
    expect(kspCalendar().day).toBe(21_600);
    setKspCalendar({ day: Number.NaN });
    expect(kspCalendar().day).toBe(21_600);
    setKspCalendar({ day: -1 });
    expect(kspCalendar().day).toBe(21_600);
  });

  it("takes a partial report and fills the rest from stock", () => {
    setKspCalendar({ day: 86_400, year: 365 * 86_400 });
    expect(kspCalendar().minute).toBe(60);
    expect(kspYearDays()).toBe(365);
  });
});
