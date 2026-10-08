import { describe, expect, it } from "vitest";
import {
  ASCENT_SECONDS,
  ascent,
  ascentFrames,
  throttleAt,
} from "../../scripts/navballAscentModel";

describe("gravity turn playback", () => {
  const states = ascent();

  it("lifts off vertical and ends well down toward the horizon without going under it", () => {
    expect(states[0].pitch).toBe(90);
    const last = states.at(-1);
    expect(last?.t).toBe(ASCENT_SECONDS);
    expect(last?.pitch).toBeLessThan(25);
    expect(last?.pitch).toBeGreaterThan(0);
  });

  it("pitches over once it is flying and never climbs back toward vertical", () => {
    for (let i = 1; i < states.length; i++) {
      expect(states[i].pitch).toBeLessThanOrEqual(states[i - 1].pitch + 0.05);
    }
    expect(states.find((s) => s.pitch < 90)?.speed).toBeGreaterThan(60);
  });

  it("climbs the whole way", () => {
    for (let i = 1; i < states.length; i++) {
      expect(states[i].altitude).toBeGreaterThan(states[i - 1].altitude);
    }
  });

  it("throttles back through max-Q and is at full throttle either side", () => {
    expect(throttleAt(100)).toBe(1);
    expect(throttleAt(10_000)).toBeLessThan(0.75);
    expect(throttleAt(30_000)).toBe(1);
    expect(Math.min(...states.map((s) => s.throttle))).toBeLessThan(0.75);
  });

  it("switches SAS on, then to prograde once the turn is under way", () => {
    expect(states[0].sas).toBe("off");
    expect(states.at(-1)?.sas).toBe("Prograde");
  });

  it("plays 30 to 60 seconds", () => {
    const seconds = ascentFrames().at(-1)?.seconds ?? 0;
    expect(seconds).toBeGreaterThanOrEqual(30);
    expect(seconds).toBeLessThanOrEqual(60);
  });
});
