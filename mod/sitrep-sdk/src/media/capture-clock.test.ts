import { describe, expect, it } from "vitest";
import { type CaptureClockSample, captureUtStamper } from "./capture-clock";

const UNKNOWN: CaptureClockSample = { ut: null, warpRate: 1, atMs: 0 };

describe("captureUtStamper", () => {
  it("stamps a frame it cannot date so that it is never released, not as UT 0", () => {
    const stamp = captureUtStamper();

    // UT 0 is before every view time, so a frame stamped with it plays at once, ahead of the delayed telemetry.
    expect(stamp(UNKNOWN, 500)).toBe(Number.POSITIVE_INFINITY);
  });

  it("carries the clock forward from its last sample", () => {
    const stamp = captureUtStamper();

    expect(stamp({ ut: 1000, warpRate: 4, atMs: 2000 }, 2500)).toBe(1002);
  });

  it("holds the last time it knew when the clock is lost", () => {
    const stamp = captureUtStamper();
    stamp({ ut: 1000, warpRate: 1, atMs: 2000 }, 2500);

    expect(stamp(UNKNOWN, 9000)).toBe(1000.5);
  });
});
