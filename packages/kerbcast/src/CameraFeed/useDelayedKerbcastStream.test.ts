import { describe, expect, it } from "vitest";
import {
  type CaptureClockSample,
  interpolateCaptureUt,
} from "./useDelayedKerbcastStream";

describe("interpolateCaptureUt", () => {
  it("returns null when there is no clock (ut === null)", () => {
    const s: CaptureClockSample = { ut: null, warpRate: 1, atMs: 1000 };
    expect(interpolateCaptureUt(s, 5000)).toBeNull();
  });

  it("advances UT by wall-clock elapsed at 1x warp", () => {
    // sampled UT 100s at wall t=1000ms; 2000ms later (2s) at 1x → 102s
    const s: CaptureClockSample = { ut: 100, warpRate: 1, atMs: 1000 };
    expect(interpolateCaptureUt(s, 3000)).toBeCloseTo(102, 6);
  });

  it("scales the forward interpolation by the warp rate", () => {
    // 2s wall elapsed at 50x → 100 UT-seconds advanced → 100 + 100 = 200
    const s: CaptureClockSample = { ut: 100, warpRate: 50, atMs: 1000 };
    expect(interpolateCaptureUt(s, 3000)).toBeCloseTo(200, 6);
  });

  it("treats a zero/absent warp rate as 1x", () => {
    const s: CaptureClockSample = { ut: 100, warpRate: 0, atMs: 1000 };
    expect(interpolateCaptureUt(s, 3000)).toBeCloseTo(102, 6);
  });

  it("clamps negative elapsed (clock skew) to the sampled UT, never interpolating backwards", () => {
    const s: CaptureClockSample = { ut: 100, warpRate: 10, atMs: 5000 };
    expect(interpolateCaptureUt(s, 1000)).toBe(100);
  });

  it("returns the sampled UT exactly at the sample instant", () => {
    const s: CaptureClockSample = { ut: 42.5, warpRate: 4, atMs: 2000 };
    expect(interpolateCaptureUt(s, 2000)).toBe(42.5);
  });
});
