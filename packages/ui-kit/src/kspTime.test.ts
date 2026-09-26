import { afterEach, describe, expect, it } from "vitest";
import { formatDuration, formatIrlDuration } from "./formatDuration";
import { formatKspDate } from "./formatKspDate";
import { kspCalendar, kspYearDays, setKspCalendar } from "./kspTime";
import { formatQuantity } from "./units";

/*
 * A day is 21,600s on stock Kerbin time and 86,400s under a planet pack or with
 * `KERBIN_TIME` off: a factor of four that looks plausible either way.
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
    // One Kerbin year is 106.5 Earth days: the half day shows two calendars, not two labels for one.
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
    // Wall-clock durations are unmoved by the game's calendar.
    expect(formatIrlDuration(86_400)).toBe("1d");
    setKspCalendar(EARTH);
    expect(formatIrlDuration(86_400)).toBe("1d");
  });

  it("refuses a calendar nobody can divide by, and keeps the last good one", () => {
    // A zero day-length would render every duration as infinity, so it is refused.
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
