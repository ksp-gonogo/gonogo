import { describe, expect, it } from "vitest";
import { classifyRegime, deriveDelayClocks } from "./clocks";

describe("classifyRegime", () => {
  it("no-path when the one-way delay is absent", () => {
    expect(classifyRegime(null, 60)).toBe("no-path");
    expect(classifyRegime(undefined, 60)).toBe("no-path");
    expect(classifyRegime(Number.NaN, 60)).toBe("no-path");
  });

  it("live at zero / negligible delay (LAN, Kerbin-local)", () => {
    expect(classifyRegime(0, 60)).toBe("live");
    expect(classifyRegime(0.4, 60)).toBe("live"); // round-trip 0.8s
  });

  it("staged when the round-trip fits inside the descent", () => {
    // Mun ~4s one-way => 8s round-trip, descent ~40s: one decision fits.
    expect(classifyRegime(4, 40)).toBe("staged");
  });

  it("autonomous when the round-trip swamps the descent", () => {
    // A 30s round-trip against a 20s descent: no decision fits.
    expect(classifyRegime(15, 20)).toBe("autonomous");
  });

  it("falls back to an absolute cut when the descent window is unknown", () => {
    expect(classifyRegime(4, null)).toBe("staged"); // 8s round-trip
    expect(classifyRegime(3000, null)).toBe("autonomous"); // Duna-scale
  });
});

describe("deriveDelayClocks", () => {
  it("no path => no clocks, no-path regime", () => {
    const c = deriveDelayClocks({
      oneWaySeconds: null,
      suicideBurnCountdown: 30,
      timeToImpact: 50,
    });
    expect(c.regime).toBe("no-path");
    expect(c.oneWaySeconds).toBeNull();
    expect(c.commitInSeconds).toBeNull();
    expect(c.blindInSeconds).toBeNull();
    expect(c.committed).toBe(false);
    expect(c.blind).toBe(false);
  });

  it("staged Mun descent: commit margin = countdown - N, blind = impact - 2N", () => {
    const c = deriveDelayClocks({
      oneWaySeconds: 4,
      suicideBurnCountdown: 30,
      timeToImpact: 50,
    });
    expect(c.regime).toBe("staged");
    expect(c.roundTripSeconds).toBe(8);
    expect(c.commitInSeconds).toBe(26); // 30 - 4
    expect(c.committed).toBe(false);
    expect(c.blindInSeconds).toBe(42); // 50 - 8
    expect(c.blind).toBe(false);
  });

  it("committed once the countdown drops within the one-way delay", () => {
    const c = deriveDelayClocks({
      oneWaySeconds: 4,
      suicideBurnCountdown: 2,
      timeToImpact: 20,
    });
    expect(c.commitInSeconds).toBe(-2);
    expect(c.committed).toBe(true);
  });

  it("blind once impact is within the round-trip", () => {
    const c = deriveDelayClocks({
      oneWaySeconds: 4,
      suicideBurnCountdown: null,
      timeToImpact: 6,
    });
    expect(c.blindInSeconds).toBe(-2); // 6 - 8
    expect(c.blind).toBe(true);
  });

  it("live regime still yields clocks (zero delay => margins equal the raw times)", () => {
    const c = deriveDelayClocks({
      oneWaySeconds: 0,
      suicideBurnCountdown: 10,
      timeToImpact: 40,
    });
    expect(c.regime).toBe("live");
    expect(c.commitInSeconds).toBe(10);
    expect(c.blindInSeconds).toBe(40);
  });

  it("no burn solution => commit clock is null but the blind clock still runs", () => {
    const c = deriveDelayClocks({
      oneWaySeconds: 2,
      suicideBurnCountdown: null,
      timeToImpact: 30,
    });
    expect(c.commitInSeconds).toBeNull();
    expect(c.blindInSeconds).toBe(26);
  });
});
