import { describe, expect, it } from "vitest";
import { type SuicideBurnInputs, solveSuicideBurn } from "./solveLanding";

/**
 * The worked Mun case from the clean-room spec (Appendix A). A craft on a
 * standard low-Mun descent carries ~540 m/s of mostly-HORIZONTAL velocity. The
 * old vertical-only model reported "burn now -> touchdown at 0 m/s" and a
 * T-53.8s countdown; both are wrong in the fatal (late) direction. The
 * full-vector solve must kill the whole surface-speed vector.
 */
const MUN_DESCENT: SuicideBurnInputs = {
  heightFromTerrain: 5_000,
  altitudeAsl: 5_000,
  verticalSpeed: -50, // descending at 50 m/s
  surfaceSpeed: 540, // full vector, mostly horizontal
  mu: 6.5138e10,
  bodyRadius: 200_000,
  availableThrust: 20, // kN
  totalMass: 1, // t -> aMax = 20 m/s^2
};

describe("solveSuicideBurn — full-vector Mun descent (spec Appendix A)", () => {
  const s = solveSuicideBurn(MUN_DESCENT);

  it("is a solved vacuum descent", () => {
    expect(s.state).toBe("vacuum-solved");
  });

  it("gravity resolves to ~1.55 m/s^2", () => {
    expect(s.gravity).toBeCloseTo(1.55, 2);
  });

  it("splits velocity into vertical and (dominant) horizontal", () => {
    expect(s.verticalSpeed).toBeCloseTo(50, 5);
    // sqrt(540^2 - 50^2) = 537.7 — horizontal is the one that kills you.
    expect(s.horizontalSpeed).toBeCloseTo(537.7, 1);
  });

  it("does NOT report a survivable burn-now touchdown (the fatal-direction fix)", () => {
    // Old vertical-only model said 0. Full vector: sqrt(540^2 - 2*18.45*5000) ~ 327 m/s.
    expect(s.bestSpeedAtImpact).not.toBe(0);
    expect(s.bestSpeedAtImpact).toBeCloseTo(327, 0);
  });

  it("says ignite now — the burn no longer fits the remaining altitude", () => {
    // burnDistance = 540^2/(2*18.45) ~ 7902 m > 5000 m -> ignition altitude negative.
    expect(s.ignitionAltitude).not.toBeNull();
    expect(s.ignitionAltitude as number).toBeLessThan(0);
    expect(s.suicideBurnCountdown).toBe(0);
  });

  it("prices the burn on the full vector: ~29 s, ~585 m/s dV", () => {
    expect(s.burnDuration).toBeCloseTo(29.3, 0);
    expect(s.burnDeltaV).toBeCloseTo(585, -1);
  });

  it("no-burn impact speed uses the full surface-speed vector", () => {
    // sqrt(540^2 + 2*1.55*5000) ~ 554 m/s
    expect(s.speedAtImpact).toBeCloseTo(554, 0);
    expect(s.timeToImpact).toBeCloseTo(54.3, 0);
  });
});

describe("solveSuicideBurn — near-vertical hover descent", () => {
  // Small horizontal component: the burn fits, countdown is positive.
  const s = solveSuicideBurn({
    ...MUN_DESCENT,
    surfaceSpeed: 51, // ~10 m/s horizontal
  });

  it("burn fits: best touchdown is 0 m/s", () => {
    expect(s.bestSpeedAtImpact).toBe(0);
  });

  it("has a positive ignition altitude and a real countdown", () => {
    expect(s.ignitionAltitude as number).toBeGreaterThan(0);
    expect(s.suicideBurnCountdown as number).toBeGreaterThan(0);
  });
});

describe("solveSuicideBurn — gating", () => {
  it("not-descending when climbing", () => {
    const s = solveSuicideBurn({ ...MUN_DESCENT, verticalSpeed: 5 });
    expect(s.state).toBe("not-descending");
    expect(s.suicideBurnCountdown).toBeNull();
    expect(s.burnDeltaV).toBeNull();
  });

  it("not-descending when already at/below terrain", () => {
    const s = solveSuicideBurn({ ...MUN_DESCENT, heightFromTerrain: 0 });
    expect(s.state).toBe("not-descending");
  });

  it("no-solution when body radius/mu are unknown", () => {
    const s = solveSuicideBurn({ ...MUN_DESCENT, bodyRadius: undefined });
    expect(s.state).toBe("no-solution");
  });

  it("keeps impact numbers but nulls the burn when thrust cannot beat gravity", () => {
    // aMax = 1 kN / 1 t = 1 m/s^2 < g (1.55) — cannot decelerate.
    const s = solveSuicideBurn({ ...MUN_DESCENT, availableThrust: 1 });
    expect(s.state).toBe("vacuum-solved");
    expect(s.speedAtImpact).not.toBeNull();
    expect(s.bestSpeedAtImpact).toBeNull();
    expect(s.burnDeltaV).toBeNull();
    expect(s.suicideBurnCountdown).toBeNull();
  });

  it("tolerates a surfaceSpeed below verticalSpeed (never negative horizontal)", () => {
    const s = solveSuicideBurn({ ...MUN_DESCENT, surfaceSpeed: 10 });
    expect(s.horizontalSpeed).toBe(0);
  });
});
