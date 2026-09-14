import { describe, expect, it } from "vitest";
import type { OrbitElements } from "./kepler";
import { orbitalPeriod } from "./propagation";

/**
 * Unit coverage for the orbit scalars `propagation.ts` derives from streamed
 * elements alone. Anything that advances elements to a future UT lives in
 * `orbit-trajectory.ts` and is covered there, against the propagation horizon
 * it consults.
 */

const MU_KERBIN = 3.5316e12;

/** A circular equatorial orbit of the given radius, phased by `mAtEpoch`. */
function circular(radius: number, mAtEpoch = 0): OrbitElements {
  return {
    sma: radius,
    ecc: 0,
    inc: 0,
    lan: 0,
    argPe: 0,
    meanAnomalyAtEpoch: mAtEpoch,
    epoch: 0,
    mu: MU_KERBIN,
  };
}

describe("orbitalPeriod", () => {
  it("matches 2π·sqrt(sma³/mu)", () => {
    const els = circular(700_000);
    const expected = 2 * Math.PI * Math.sqrt(700_000 ** 3 / MU_KERBIN);
    expect(orbitalPeriod(els)).toBeCloseTo(expected, 3);
  });

  it("is null for a non-bound sma", () => {
    expect(orbitalPeriod({ ...circular(700_000), sma: -1 })).toBeNull();
  });
});
