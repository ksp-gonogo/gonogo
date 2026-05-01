import { describe, expect, it } from "vitest";
import {
  buildCurrentOrbit,
  computeBurnTrueAnomaly,
  computeMu,
  computeRelInc,
} from "./planning";

describe("computeMu", () => {
  it("uses vis-viva when orbitalSpeed/radius/sma are all finite", () => {
    // μ = v²·a·r / (2a − r). Pick LKO-ish numbers so μ ≈ Kerbin's.
    const sma = 700_000;
    const r = 700_000;
    const v = 2300;
    const result = computeMu(v, r, sma, undefined);
    // gravParameterFromState returns v²·a·r/(2a−r) → 2300² * 700000 * 700000 / 700000 = 2300² * 700000
    expect(result).toBeCloseTo((v * v * sma * r) / (2 * sma - r), 0);
  });

  it("falls back to Kepler's 3rd when vis-viva inputs are missing", () => {
    // 4π²a³/T².
    const sma = 700_000;
    const T = 3600;
    const result = computeMu(undefined, undefined, sma, T);
    expect(result).toBeCloseTo((4 * Math.PI ** 2 * sma ** 3) / (T * T), 0);
  });

  it("returns 0 when no formula has usable inputs", () => {
    expect(computeMu(undefined, undefined, undefined, undefined)).toBe(0);
    expect(computeMu(0, 0, 700_000, undefined)).toBe(0);
  });
});

describe("buildCurrentOrbit", () => {
  it("builds a CurrentOrbit when all fields are finite", () => {
    const orbit = buildCurrentOrbit({
      sma: 700_000,
      ecc: 0.01,
      ApR: 707_000,
      PeR: 693_000,
      timeToAp: 900,
      timeToPe: 1800,
    });
    expect(orbit).toEqual({
      sma: 700_000,
      eccentricity: 0.01,
      ApR: 707_000,
      PeR: 693_000,
      timeToAp: 900,
      timeToPe: 1800,
    });
  });

  it("returns null when any field is missing or non-finite", () => {
    expect(
      buildCurrentOrbit({
        sma: undefined,
        ecc: 0.01,
        ApR: 707_000,
        PeR: 693_000,
        timeToAp: 900,
        timeToPe: 1800,
      }),
    ).toBeNull();
    expect(
      buildCurrentOrbit({
        sma: Number.NaN,
        ecc: 0.01,
        ApR: 707_000,
        PeR: 693_000,
        timeToAp: 900,
        timeToPe: 1800,
      }),
    ).toBeNull();
  });
});

describe("computeRelInc", () => {
  it("returns 0 for coplanar same-LAN orbits", () => {
    expect(computeRelInc(30, 0, 30, 0)).toBeCloseTo(0, 5);
  });

  it("returns the inclination delta when LANs match", () => {
    const result = computeRelInc(0, 0, 45, 0);
    expect(result).toBeCloseTo(45, 5);
  });

  it("returns null when any input is missing", () => {
    expect(computeRelInc(undefined, 0, 0, 0)).toBeNull();
    expect(computeRelInc(0, undefined, 0, 0)).toBeNull();
  });
});

describe("computeBurnTrueAnomaly", () => {
  const orbit = {
    sma: 700_000,
    eccentricity: 0.01,
    ApR: 707_000,
    PeR: 693_000,
    timeToAp: 900,
    timeToPe: 1800,
  };

  it("returns 180° for custom-apo and 0° for custom-peri", () => {
    expect(
      computeBurnTrueAnomaly({
        preset: "custom-apo",
        currentOrbit: orbit,
        currentUT: 1000,
        mu: 3.5e12,
        trueAnomaly: 0,
        utMode: "relative",
        burnAtUT: 0,
        burnInSeconds: 60,
      }),
    ).toBe(180);
    expect(
      computeBurnTrueAnomaly({
        preset: "custom-peri",
        currentOrbit: orbit,
        currentUT: 1000,
        mu: 3.5e12,
        trueAnomaly: 0,
        utMode: "relative",
        burnAtUT: 0,
        burnInSeconds: 60,
      }),
    ).toBe(0);
  });

  it("returns null outside custom-* presets", () => {
    expect(
      computeBurnTrueAnomaly({
        preset: "circularize-apo",
        currentOrbit: orbit,
        currentUT: 1000,
        mu: 3.5e12,
        trueAnomaly: 0,
        utMode: "relative",
        burnAtUT: 0,
        burnInSeconds: 60,
      }),
    ).toBeNull();
  });

  it("returns null when telemetry isn't ready", () => {
    expect(
      computeBurnTrueAnomaly({
        preset: "custom-apo",
        currentOrbit: null,
        currentUT: 1000,
        mu: 3.5e12,
        trueAnomaly: 0,
        utMode: "relative",
        burnAtUT: 0,
        burnInSeconds: 60,
      }),
    ).toBeNull();
    expect(
      computeBurnTrueAnomaly({
        preset: "custom-apo",
        currentOrbit: orbit,
        currentUT: undefined,
        mu: 3.5e12,
        trueAnomaly: 0,
        utMode: "relative",
        burnAtUT: 0,
        burnInSeconds: 60,
      }),
    ).toBeNull();
  });

  it("returns null on custom-ut when burnUT is in the past", () => {
    expect(
      computeBurnTrueAnomaly({
        preset: "custom-ut",
        currentOrbit: orbit,
        currentUT: 1000,
        mu: 3.5e12,
        trueAnomaly: 0,
        utMode: "absolute",
        burnAtUT: 500,
        burnInSeconds: 0,
      }),
    ).toBeNull();
  });
});
