import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  formatKspDate,
  realDatesWanted,
  setRealDatesPreferred,
} from "./formatKspDate";
import { kspCalendar, setKspCalendar } from "./kspTime";
import { NULL_DISPLAY } from "./NullValue";

describe("formatKspDate", () => {
  it("formats UT 0 as Year 1, Day 1, midnight", () => {
    expect(formatKspDate(0)).toBe("Y1 D1 00:00:00");
  });

  it("rolls over to day 2 at the KSP day boundary (21600s = 6h)", () => {
    expect(formatKspDate(21600)).toBe("Y1 D2 00:00:00");
  });

  it("rolls over to year 2 at the KSP year boundary (9,201,600s = 426d)", () => {
    expect(formatKspDate(9_201_600)).toBe("Y2 D1 00:00:00");
  });

  it("formats a mid-day time with non-zero H:M:S", () => {
    // Day 5 (dayIndex 4, dayStart 86400) + 03:22:37 (12157s) = UT 98557.
    expect(formatKspDate(98_557)).toBe("Y1 D5 03:22:37");
  });

  it("formats a large multi-year UT", () => {
    // Year 3 (yearIndex 2, yearStart 18,403,200) + day 100 (dayIndex 99,
    // dayStart 2,138,400) + 05:15:20 (18920s) = UT 20,560,520.
    expect(formatKspDate(20_560_520)).toBe("Y3 D100 05:15:20");
  });

  it("returns an em dash for non-finite input", () => {
    expect(formatKspDate(Number.NaN)).toBe(NULL_DISPLAY);
    expect(formatKspDate(Number.POSITIVE_INFINITY)).toBe(NULL_DISPLAY);
    expect(formatKspDate(Number.NEGATIVE_INFINITY)).toBe(NULL_DISPLAY);
  });

  it("clamps negative UT to the epoch rather than going negative", () => {
    // KSP UT is never negative in normal play; clamp to the epoch instead
    // of surfacing a nonsensical Y0/negative-day reading.
    expect(formatKspDate(-1)).toBe("Y1 D1 00:00:00");
    expect(formatKspDate(-9_201_600)).toBe("Y1 D1 00:00:00");
  });
});

/**
 * The epoch half: a game that has a real calendar renders real dates, and a
 * game that has none renders offsets, which is what it has always done.
 *
 * The anchor is RP-1's own (1951-01-01), because that is the one an operator
 * running that career will actually see.
 */
describe("formatKspDate with an epoch", () => {
  const RSS = {
    minute: 60,
    hour: 3600,
    day: 86_400,
    year: 365 * 86_400,
    epochMs: Date.UTC(1951, 0, 1),
  };

  beforeEach(() => {
    setRealDatesPreferred(true);
  });

  afterEach(() => {
    setKspCalendar();
    setRealDatesPreferred(false);
  });

  it("renders UT 0 as the anchor itself", () => {
    setKspCalendar(RSS);
    expect(formatKspDate(0)).toBe("1 Jan 1951 00:00:00");
  });

  it("renders a UT as the real instant that many seconds later", () => {
    setKspCalendar(RSS);
    // 1957-03-14T03:22:37Z, the shape of date RP-1 prints.
    const ut = (Date.UTC(1957, 2, 14, 3, 22, 37) - Date.UTC(1951, 0, 1)) / 1000;
    expect(formatKspDate(ut)).toBe("14 Mar 1957 03:22:37");
  });

  /**
   * Leap years are the tell that the Gregorian calendar is governing and not
   * the 365-day year the same payload reported. A renderer dividing by
   * `yearSeconds` lands a day out here, every four years, silently.
   */
  it("follows the real calendar rather than the reported year length", () => {
    setKspCalendar(RSS);
    const ut = (Date.UTC(1956, 1, 29) - Date.UTC(1951, 0, 1)) / 1000;
    expect(formatKspDate(ut)).toBe("29 Feb 1956 00:00:00");
  });

  it("clamps a negative UT to the anchor rather than dating before it", () => {
    setKspCalendar(RSS);
    expect(formatKspDate(-86_400)).toBe("1 Jan 1951 00:00:00");
  });

  it("renders a UT with no real date as absent", () => {
    setKspCalendar(RSS);
    expect(formatKspDate(1e18)).toBe(NULL_DISPLAY);
  });

  /**
   * No anchor is the stock game, and the stock game's own UI prints Y1 D1.
   * Inventing a date for it would be the fabrication this field exists to
   * avoid.
   */
  it("keeps the offset form when the game reported no epoch", () => {
    setKspCalendar({ minute: 60, hour: 3600, day: 86_400, year: 365 * 86_400 });
    expect(formatKspDate(0)).toBe("Y1 D1 00:00:00");
  });

  it("drops an unusable epoch and keeps the calendar", () => {
    setKspCalendar({ ...RSS, epochMs: Number.NaN });
    expect(formatKspDate(0)).toBe("Y1 D1 00:00:00");
    expect(kspCalendar().day).toBe(86_400);
  });

  /**
   * The setting is a CHOICE, not a detection. An anchor arriving on the wire
   * must not restyle every date on the board by itself: an operator who never
   * asked keeps the readout they had.
   */
  it("keeps the offset form until the operator asks for real dates", () => {
    setRealDatesPreferred(false);
    setKspCalendar(RSS);
    expect(formatKspDate(0)).toBe("Y1 D1 00:00:00");
    expect(realDatesWanted()).toBe(false);
  });

  /** Asked for, but nothing to anchor against: still the offset form. */
  it("reports real dates unwanted when the game carries no anchor", () => {
    setKspCalendar({ minute: 60, hour: 3600, day: 86_400, year: 365 * 86_400 });
    expect(realDatesWanted()).toBe(false);
    expect(formatKspDate(0)).toBe("Y1 D1 00:00:00");
  });

  it("reports real dates wanted only when asked AND anchored", () => {
    setKspCalendar(RSS);
    expect(realDatesWanted()).toBe(true);
  });
});
