import { describe, expect, it } from "vitest";
import {
  formatCountdown,
  formatDuration,
  formatIrlDuration,
} from "./formatDuration";
import { NULL_DISPLAY } from "./NullValue";

describe("formatDuration", () => {
  it("formats plain seconds below the minute boundary", () => {
    expect(formatDuration(45)).toBe("45s");
  });

  it("formats minutes + seconds", () => {
    expect(formatDuration(80)).toBe("1min 20s");
  });

  it("truncates (never rounds up) the smaller unit", () => {
    // 89s = 1min 29s exactly, but this also documents the choice for
    // fractional input: the smaller unit is floored, not rounded, so a
    // countdown never displays a value that hasn't fully elapsed yet.
    expect(formatDuration(89)).toBe("1min 29s");
    expect(formatDuration(89.9)).toBe("1min 29s");
  });

  it("formats hours + minutes", () => {
    expect(formatDuration(8100)).toBe("2h 15min");
  });

  it("formats KSP days (6h) + hours", () => {
    // 3d 4h in KSP time = 3*21600 + 4*3600
    expect(formatDuration(3 * 21600 + 4 * 3600)).toBe("3d 4h");
  });

  it("formats KSP years (426d) + days", () => {
    // 1y 200d = 426d + 200d, in seconds
    expect(formatDuration(426 * 21600 + 200 * 21600)).toBe("1y 200d");
  });

  it("drops the smaller unit when it is exactly zero at that scale", () => {
    expect(formatDuration(2 * 3600)).toBe("2h");
    expect(formatDuration(60)).toBe("1min");
    expect(formatDuration(3600)).toBe("1h");
    expect(formatDuration(21600)).toBe("1d");
    expect(formatDuration(426 * 21600)).toBe("1y");
  });

  it("rolls a KSP day over at 6 hours, not 24", () => {
    expect(formatDuration(7 * 3600)).toBe("1d 1h");
  });

  it("rolls a KSP year over at 426 days", () => {
    expect(formatDuration(427 * 21600)).toBe("1y 1d");
  });

  it("formats zero as 0s without opts.ms", () => {
    expect(formatDuration(0)).toBe("0s");
  });

  it("floors sub-second durations to 0s without opts.ms", () => {
    expect(formatDuration(0.4)).toBe("0s");
    expect(formatDuration(0.9)).toBe("0s");
  });

  it("renders milliseconds below 1s when opts.ms is set", () => {
    expect(formatDuration(0.82, { ms: true })).toBe("820 ms");
    expect(formatDuration(0, { ms: true })).toBe("0 ms");
  });

  it("never shows a unit finer than seconds once at/above 1s, even with opts.ms", () => {
    expect(formatDuration(45, { ms: true })).toBe("45s");
  });

  it("prefixes T+ for a negative (past) signed input", () => {
    expect(formatDuration(-95, { sign: true })).toBe("T+1min 35s");
  });

  it("prefixes T− for a positive (future) signed input", () => {
    expect(formatDuration(95, { sign: true })).toBe("T−1min 35s");
  });

  it("treats zero as future (T−) when signed", () => {
    expect(formatDuration(0, { sign: true })).toBe("T−0s");
  });

  it("does not prefix a sign by default", () => {
    expect(formatDuration(-95)).toBe("1min 35s");
  });

  it("returns an em dash for non-finite input", () => {
    expect(formatDuration(Number.NaN)).toBe(NULL_DISPLAY);
    expect(formatDuration(Number.POSITIVE_INFINITY)).toBe(NULL_DISPLAY);
    expect(formatDuration(Number.NEGATIVE_INFINITY)).toBe(NULL_DISPLAY);
  });
});

describe("formatCountdown", () => {
  it("matches formatDuration for a positive value", () => {
    expect(formatCountdown(89)).toBe("1min 29s");
  });

  it("clamps negative input to zero rather than going negative", () => {
    expect(formatCountdown(-30)).toBe("0s");
  });

  it("never shows milliseconds or a sign prefix", () => {
    expect(formatCountdown(0.4)).toBe("0s");
    expect(formatCountdown(45)).toBe("45s");
  });

  it("returns an em dash for non-finite input", () => {
    expect(formatCountdown(Number.NaN)).toBe(NULL_DISPLAY);
    expect(formatCountdown(Number.POSITIVE_INFINITY)).toBe(NULL_DISPLAY);
  });
});

describe("formatIrlDuration", () => {
  it("uses a 24-hour day where formatDuration uses Kerbin's six", () => {
    // The reason the two exist separately. A reading taken yesterday is one
    // day old on the wall calendar and four days old on Kerbin, and the second
    // answer is nonsense in a staleness badge.
    const oneRealDay = 24 * 60 * 60;
    expect(formatIrlDuration(oneRealDay)).toBe("1d");
    expect(formatDuration(oneRealDay)).toBe("4d");
  });

  it("agrees with formatDuration below a day, where the ladders are shared", () => {
    for (const seconds of [0.4, 1, 45, 90, 3600, 5400]) {
      expect(formatIrlDuration(seconds)).toBe(formatDuration(seconds));
    }
  });

  it("has no year rung: a stale record reads in days", () => {
    // 428 real days. `formatDuration` would say "1y 63d" off Kerbin's
    // 426-day year, which says nothing useful about a recording on a disk.
    expect(formatIrlDuration(428 * 24 * 60 * 60)).toBe("428d");
  });

  it("returns an em dash for non-finite input", () => {
    expect(formatIrlDuration(Number.NaN)).toBe(NULL_DISPLAY);
    expect(formatIrlDuration(Number.POSITIVE_INFINITY)).toBe(NULL_DISPLAY);
  });
});
