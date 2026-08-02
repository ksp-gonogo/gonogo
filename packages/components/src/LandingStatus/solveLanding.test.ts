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

describe("solveSuicideBurn: full-vector Mun descent (spec Appendix A)", () => {
  const s = solveSuicideBurn(MUN_DESCENT);

  it("is a solved vacuum descent", () => {
    expect(s.state).toBe("vacuum-solved");
  });

  it("gravity resolves to ~1.55 m/s^2", () => {
    expect(s.gravity).toBeCloseTo(1.55, 2);
  });

  it("splits velocity into vertical and (dominant) horizontal", () => {
    expect(s.verticalSpeed).toBeCloseTo(50, 5);
    // sqrt(540^2 - 50^2) = 537.7: horizontal is the one that kills you.
    expect(s.horizontalSpeed).toBeCloseTo(537.7, 1);
  });

  it("does NOT report a survivable burn-now touchdown (the fatal-direction fix)", () => {
    // Old vertical-only model said 0. Full vector: sqrt(540^2 - 2*18.45*5000) ~ 327 m/s.
    expect(s.bestSpeedAtImpact).not.toBe(0);
    expect(s.bestSpeedAtImpact).toBeCloseTo(327, 0);
  });

  it("says ignite now: the burn no longer fits the remaining altitude", () => {
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

describe("solveSuicideBurn: near-vertical hover descent", () => {
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

/**
 * The rocket-equation engine model (unlocked by `dryMass` + `availableDeltaV`).
 * As fuel burns the mass falls and the deceleration RISES, so the real stopping
 * distance is SHORTER than a constant-`aMax` estimate; the burn is also capped
 * at the available dV. Expected values are cross-checked against a brute-force
 * RK integration of ds/dt = g − F/m(t) (see scratchpad verify.mjs).
 */
describe("solveSuicideBurn: rocket-equation engine model", () => {
  // The `high-speed-no-solution` render fixture: Mun, 12 km AGL, 350 m/s down +
  // 100 m/s horizontal, 18 kN over 5 t (dry 3 t), 900 m/s dV. TWR ≈ 2.48 local.
  // ve = ΔV / ln(m0/mdry) = 900 / ln(5/3) = 1761.85 m/s (Isp ≈ 179.6 s), the
  // ACTIVE stage's effective exhaust velocity; burnoutMass = the stage's dry
  // (3 t). Same physical burn as before: the numbers below are unchanged.
  const HIGH_SPEED: SuicideBurnInputs = {
    heightFromTerrain: 12_000,
    altitudeAsl: 12_000,
    verticalSpeed: -350,
    surfaceSpeed: 364.0054944640259,
    mu: 65_138_398_000,
    bodyRadius: 200_000,
    availableThrust: 18,
    totalMass: 5,
    exhaustVelocity: 900 / Math.log(5 / 3),
    burnoutMass: 3,
  };

  it("is GENUINELY no-vector under the correct model: can't stop in 12 km", () => {
    const s = solveSuicideBurn(HIGH_SPEED);
    expect(s.state).toBe("vacuum-solved");
    // Optimal burn (mass loss + fuel) still arrives at terrain at ~278.5 m/s.
    expect(s.bestSpeedAtImpact as number).toBeGreaterThan(0.5);
    expect(s.bestSpeedAtImpact).toBeCloseTo(278.5, 0);
    // dV to fully null the vector (556 m/s) IS affordable within 900: the
    // limit is ALTITUDE, not fuel: you'd need ~26 km to stop.
    expect(s.burnDeltaV).toBeCloseTo(556, -1);
    expect(s.burnDuration).toBeCloseTo(132.4, 0);
    expect(s.suicideBurnCountdown).toBe(0); // past the ignition point
  });

  it("shortens the stopping distance vs the constant-decel fallback (mass loss)", () => {
    const rocket = solveSuicideBurn(HIGH_SPEED);
    // Same scenario WITHOUT the engine inputs → constant-decel fallback.
    const constant = solveSuicideBurn({
      ...HIGH_SPEED,
      exhaustVelocity: undefined,
      burnoutMass: undefined,
    });
    // Both agree it's no-vector, but the accurate model is less pessimistic.
    expect(constant.bestSpeedAtImpact).toBeCloseTo(284.4, 0);
    expect(
      (rocket.bestSpeedAtImpact as number) <
        (constant.bestSpeedAtImpact as number),
    ).toBe(true);
  });

  it("survivable burn → best touchdown 0 (Mun, 60 m/s @ 3 km, strong engine)", () => {
    const s = solveSuicideBurn({
      ...HIGH_SPEED,
      heightFromTerrain: 3_000,
      altitudeAsl: 3_000,
      verticalSpeed: -55,
      surfaceSpeed: 60,
    });
    expect(s.bestSpeedAtImpact).toBe(0);
    expect(s.burnDeltaV).toBeCloseTo(104.6, 0);
    expect(s.suicideBurnCountdown as number).toBeGreaterThan(0);
  });

  it("fuel-limited no-vector: can't null the vector even with altitude to spare", () => {
    // 100 km of altitude (not the limit) but a weak engine, only ~200 m/s of
    // stage dV (ve = 200/ln(5/3)), so the full-null burn (~415 m/s) can NEVER
    // be afforded: fuel is the wall, not altitude.
    const s = solveSuicideBurn({
      ...HIGH_SPEED,
      heightFromTerrain: 100_000,
      altitudeAsl: 100_000,
      exhaustVelocity: 200 / Math.log(5 / 3),
      burnoutMass: 3,
    });
    expect(s.burnDeltaV as number).toBeGreaterThan(200); // exceeds the budget
    expect(s.bestSpeedAtImpact as number).toBeGreaterThan(0.5);
    expect(s.bestSpeedAtImpact).toBeCloseTo(406, 0);
  });
});

describe("solveSuicideBurn: gating", () => {
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
    // aMax = 1 kN / 1 t = 1 m/s^2 < g (1.55), cannot decelerate.
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
