import { describe, expect, it } from "vitest";
import {
  composeUt,
  decomposeUt,
  isBurning,
  secondsToIgnition,
} from "./burn-clock";
import { STOCK_KERBIN_CALENDAR } from "./unit-system/calendar";

const CAL = STOCK_KERBIN_CALENDAR;

describe("an instant an operator can type", () => {
  it("reads year and day from ONE, the way the game's clock does", () => {
    // Counting them from zero puts everything a day out, and does it
    // invisibly: every field still looks like a plausible date.
    expect(decomposeUt(0, CAL)).toEqual({
      year: 1,
      day: 1,
      hour: 0,
      minute: 0,
      second: 0,
    });
  });

  it("rolls into the next day at the day boundary, not the next hour", () => {
    expect(decomposeUt(CAL.day, CAL)).toMatchObject({
      year: 1,
      day: 2,
      hour: 0,
    });
  });

  it("rolls into the next year at the year boundary", () => {
    expect(decomposeUt(CAL.year, CAL)).toMatchObject({ year: 2, day: 1 });
  });

  it("splits an arbitrary instant into parts that add back up", () => {
    const ut =
      3 * CAL.year + 17 * CAL.day + 4 * CAL.hour + 23 * CAL.minute + 11;
    const parts = decomposeUt(ut, CAL);

    expect(parts).toEqual({
      year: 4,
      day: 18,
      hour: 4,
      minute: 23,
      second: 11,
    });
    expect(composeUt(parts, CAL)).toBe(ut);
  });

  it("round-trips every instant it can express", () => {
    // The property an editor depends on: a field the operator did NOT touch
    // must come back the number it went in as, or every edit drifts the burn by
    // the rounding of the fields beside it.
    for (const ut of [0, 1, 59, 3599, CAL.day - 1, CAL.year - 1, 12_345_678]) {
      expect(composeUt(decomposeUt(ut, CAL), CAL)).toBe(ut);
    }
  });

  it("drops a fraction of a second rather than carrying it", () => {
    // A burn scheduled to the microsecond is one nobody can enter, and the
    // fraction would reappear as a rounding difference the next time any other
    // field was touched.
    expect(decomposeUt(10.9, CAL).second).toBe(10);
  });

  it("carries an out-of-range part instead of refusing it", () => {
    // Minute 90 means an hour and a half, which is what somebody typing it
    // meant. Refusing would make the obvious way to say "half an hour later"
    // an error.
    expect(
      composeUt({ year: 1, day: 1, hour: 0, minute: 90, second: 0 }, CAL),
    ).toBe(90 * CAL.minute);
  });

  it("follows the calendar it is given rather than assuming stock", () => {
    // An Earth-calendar install has a 86,400s day, and a decomposition that
    // assumed 21,600 would put a burn four days out.
    const earth = { minute: 60, hour: 3600, day: 86_400, year: 365 * 86_400 };

    expect(decomposeUt(86_400, earth)).toMatchObject({ day: 2, hour: 0 });
  });
});

describe("counting down to a burn", () => {
  it("counts to IGNITION, not to the node", () => {
    // The node instant of a finite burn is its half-delta-v point. Counting to
    // it puts ignition half a burn in the past by the time the countdown reads
    // zero, so an operator lighting on it is late every time, by an amount that
    // grows with the burn.
    expect(secondsToIgnition({ ut: 1030, ignitionUt: 1000 }, 900)).toBe(100);
  });

  it("uses the node instant only when nothing modelled an ignition", () => {
    // The stock case: an instantaneous burn lights when it happens, so the two
    // ARE the same instant rather than one standing in for the other.
    expect(secondsToIgnition({ ut: 1000 }, 900)).toBe(100);
    expect(secondsToIgnition({ ut: 1000, ignitionUt: null }, 900)).toBe(100);
  });

  it("goes negative once the burn has started", () => {
    // A real state worth showing: a burn in progress is exactly when an
    // operator most wants to know how far into it they are.
    expect(secondsToIgnition({ ut: 1030, ignitionUt: 1000 }, 1020)).toBe(-20);
  });

  it("knows a burn is lit between ignition and cutoff", () => {
    const burn = { ignitionUt: 1000, cutoffUt: 1060 };

    expect(isBurning(burn, 999)).toBe(false);
    expect(isBurning(burn, 1000)).toBe(true);
    expect(isBurning(burn, 1059)).toBe(true);
    expect(isBurning(burn, 1060)).toBe(false);
  });

  it("never calls an instantaneous burn in progress", () => {
    // There is no interval to be inside, and reporting one would invent a state
    // the plan does not have.
    expect(isBurning({ ignitionUt: null, cutoffUt: null }, 1000)).toBe(false);
    expect(isBurning({ ignitionUt: 1000 }, 1000)).toBe(false);
  });
});
