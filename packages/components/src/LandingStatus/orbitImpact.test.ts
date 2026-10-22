import type { OrbitElements } from "@ksp-gonogo/sitrep-sdk/spine";
import { describe, expect, it } from "vitest";
import { orbitImpactSeconds } from "./orbitImpact";

const MINMUS_RADIUS = 60_000;
const MINMUS_MU = 1.7658e9;

const base: OrbitElements = {
  sma: 200_000,
  ecc: 0.9,
  inc: 0,
  lan: 0,
  argPe: 0,
  meanAnomalyAtEpoch: 1,
  epoch: 0,
  mu: MINMUS_MU,
};

describe("orbitImpactSeconds", () => {
  it("is the time until a closed orbit whose periapsis is under the surface reaches it", () => {
    // Stepping this orbit second by second first drops under 60 km at 11003 s.
    expect(orbitImpactSeconds(base, MINMUS_RADIUS, 0)).toBeCloseTo(
      11_002.65,
      1,
    );
  });

  it("counts down as the clock moves on", () => {
    expect(orbitImpactSeconds(base, MINMUS_RADIUS, 1_000)).toBeCloseTo(
      10_002.65,
      1,
    );
  });

  it("is null for an orbit that stays above the surface", () => {
    expect(
      orbitImpactSeconds({ ...base, sma: 400_000, ecc: 0.5 }, MINMUS_RADIUS, 0),
    ).toBeNull();
  });

  it("is null once the craft is under the surface", () => {
    // Mean anomaly 0 is periapsis at 20 km.
    expect(
      orbitImpactSeconds({ ...base, meanAnomalyAtEpoch: 0 }, MINMUS_RADIUS, 0),
    ).toBeNull();
  });

  it("finds the impact on an open orbit before periapsis, and none after it", () => {
    const inbound: OrbitElements = {
      ...base,
      sma: -100_000,
      ecc: 1.4,
      meanAnomalyAtEpoch: -2,
    };
    const seconds = orbitImpactSeconds(inbound, MINMUS_RADIUS, 0);
    expect(seconds).not.toBeNull();
    expect(seconds).toBeGreaterThan(0);
    const outbound = { ...inbound, meanAnomalyAtEpoch: 2 };
    expect(orbitImpactSeconds(outbound, MINMUS_RADIUS, 0)).toBeNull();
  });
});
