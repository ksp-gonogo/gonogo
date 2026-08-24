import { afterEach, describe, expect, it } from "vitest";
import {
  composeUt,
  decomposeUt,
  isBurning,
  timeToIgnition,
} from "./burn-clock";
import { STOCK_KERBIN_CALENDAR, setKspCalendar } from "./unit-system/calendar";
import { value } from "./unit-system/value";

const DAY = STOCK_KERBIN_CALENDAR.day;
const HOUR = STOCK_KERBIN_CALENDAR.hour;
const MINUTE = STOCK_KERBIN_CALENDAR.minute;
const YEAR = STOCK_KERBIN_CALENDAR.year;

const ut = (seconds: number) => value("ut", seconds);

afterEach(() => {
  setKspCalendar();
});

describe("an instant an operator can type", () => {
  it("reads year and day from ONE, the way the game's clock does", () => {
    // Counting them from zero puts everything a day out, and does it
    // invisibly: every field still looks like a plausible date.
    expect(decomposeUt(ut(0))).toEqual({
      year: 1,
      day: 1,
      hour: 0,
      minute: 0,
      second: 0,
    });
  });

  it("rolls into the next day at the day boundary, not the next hour", () => {
    expect(decomposeUt(ut(DAY))).toMatchObject({ year: 1, day: 2, hour: 0 });
  });

  it("rolls into the next year at the year boundary", () => {
    expect(decomposeUt(ut(YEAR))).toMatchObject({ year: 2, day: 1 });
  });

  it("splits an arbitrary instant into parts that add back up", () => {
    const at = 3 * YEAR + 17 * DAY + 4 * HOUR + 23 * MINUTE + 11;
    const parts = decomposeUt(ut(at));

    expect(parts).toEqual({
      year: 4,
      day: 18,
      hour: 4,
      minute: 23,
      second: 11,
    });
    expect(composeUt(parts).in("s").magnitude).toBe(at);
  });

  it("round-trips every instant it can express", () => {
    // The property an editor depends on: a field the operator did NOT touch
    // must come back the number it went in as, or every edit drifts the burn by
    // the rounding of the fields beside it.
    for (const at of [0, 1, 59, 3599, DAY - 1, YEAR - 1, 12_345_678]) {
      expect(composeUt(decomposeUt(ut(at))).in("s").magnitude).toBe(at);
    }
  });

  it("drops a fraction of a second rather than carrying it", () => {
    // A burn scheduled to the microsecond is one nobody can enter, and the
    // fraction would reappear as a rounding difference the next time any other
    // field was touched.
    expect(decomposeUt(ut(10.9)).second).toBe(10);
  });

  it("carries an out-of-range part instead of refusing it", () => {
    // Minute 90 means an hour and a half, which is what somebody typing it
    // meant. Refusing would make the obvious way to say "half an hour later"
    // an error.
    expect(
      composeUt({ year: 1, day: 1, hour: 0, minute: 90, second: 0 }).in("s")
        .magnitude,
    ).toBe(90 * MINUTE);
  });

  it("follows the calendar the GAME reported, through the unit system", () => {
    // The reason this file owns no ratios of its own. An Earth-calendar install
    // has an 86,400s day, and a decomposition carrying stock's 21,600 would put
    // a burn four days out. `Value` is what knows the difference, so the same
    // instant has to read differently once the game says so.
    setKspCalendar({ day: 86_400, hour: 3600, minute: 60, year: 365 * 86_400 });

    expect(decomposeUt(ut(86_400))).toMatchObject({ day: 2, hour: 0 });
  });
});

describe("counting down to a burn", () => {
  it("counts to IGNITION, not to the node", () => {
    // The node instant of a finite burn is its half-delta-v point. Counting to
    // it puts ignition half a burn in the past by the time the countdown reads
    // zero, so an operator lighting on it is late every time, by an amount that
    // grows with the burn.
    expect(
      timeToIgnition({ ut: ut(1030), ignitionUt: ut(1000) }, ut(900)).magnitude,
    ).toBe(100);
  });

  it("answers an interval, so it cannot be mistaken for an instant", () => {
    // `s` rather than `ut`: a countdown handed to something expecting a date
    // would render as one, and the token split is what stops that.
    expect(timeToIgnition({ ut: ut(1000) }, ut(900)).unit).toBe("s");
  });

  it("uses the node instant only when nothing modelled an ignition", () => {
    // The stock case: an instantaneous burn lights when it happens, so the two
    // ARE the same instant rather than one standing in for the other.
    expect(timeToIgnition({ ut: ut(1000) }, ut(900)).magnitude).toBe(100);
    expect(
      timeToIgnition({ ut: ut(1000), ignitionUt: null }, ut(900)).magnitude,
    ).toBe(100);
  });

  it("goes negative once the burn has started", () => {
    // A real state worth showing: a burn in progress is exactly when an
    // operator most wants to know how far into it they are.
    expect(
      timeToIgnition({ ut: ut(1030), ignitionUt: ut(1000) }, ut(1020))
        .magnitude,
    ).toBe(-20);
  });

  it("knows a burn is lit between ignition and cutoff", () => {
    const burn = { ignitionUt: ut(1000), cutoffUt: ut(1060) };

    expect(isBurning(burn, ut(999))).toBe(false);
    expect(isBurning(burn, ut(1000))).toBe(true);
    expect(isBurning(burn, ut(1059))).toBe(true);
    expect(isBurning(burn, ut(1060))).toBe(false);
  });

  it("never calls an instantaneous burn in progress", () => {
    // There is no interval to be inside, and reporting one would invent a state
    // the plan does not have.
    expect(isBurning({ ignitionUt: null, cutoffUt: null }, ut(1000))).toBe(
      false,
    );
    expect(isBurning({ ignitionUt: ut(1000) }, ut(1000))).toBe(false);
  });
});
