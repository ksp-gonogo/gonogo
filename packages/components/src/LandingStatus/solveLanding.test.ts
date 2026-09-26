import { describe, expect, it } from "vitest";
import { type SuicideBurnInputs, solveSuicideBurn } from "./solveLanding";

/** The worked Mun case: a low-Mun descent carries about 540 m/s of mostly horizontal velocity, which the full-vector solve must null. */
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
    // Full vector: sqrt(540^2 - 2*18.45*5000), about 327 m/s.
    expect(s.bestSpeedAtImpact).not.toBe(0);
    expect(s.bestSpeedAtImpact).toBeCloseTo(327, 0);
  });

  it("says ignite now: the burn no longer fits the remaining altitude", () => {
    // burnDistance = 540^2/(2*18.45), about 7902 m, above the vessel's 5000 m.
    expect(s.ignitionAltitude as number).toBeCloseTo(7902, -1);
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

/*
 * A straight-down descent on the constant-deceleration model, worked by hand:
 * g = 1.6 m/s^2 at r = 202 km, aMax = 20 kN / 5 t = 4, so aNet = 2.4 m/s^2.
 */
describe("solveSuicideBurn: where and when to ignite", () => {
  const G = 1.6;
  const R = 202_000;
  const H = 2000;
  const V = 40;
  const s = solveSuicideBurn({
    heightFromTerrain: H,
    altitudeAsl: H,
    verticalSpeed: -V,
    surfaceSpeed: V,
    mu: G * R * R,
    bodyRadius: R - H,
    availableThrust: 20,
    totalMass: 5,
  });
  // Stopping 40 m/s at 2.4 m/s^2 takes v^2 / 2a of height.
  const burnLength = (V * V) / (2 * 2.4);

  it("lights at the height the burn needs to stop the vessel", () => {
    expect(s.ignitionAltitude as number).toBeCloseTo(burnLength, 3);
  });

  it("counts down the ballistic fall from here to that height", () => {
    const coast = H - burnLength;
    // The positive root of 1/2 g t^2 + v t - coast = 0.
    const fall = (-V + Math.sqrt(V * V + 2 * G * coast)) / G;
    expect(s.suicideBurnCountdown as number).toBeCloseTo(fall, 3);
  });
});

/** The rocket-equation engine model: deceleration rises as mass falls, so the stopping distance is shorter than a constant-`aMax` estimate, and the burn is capped at the available dV. */
describe("solveSuicideBurn: rocket-equation engine model", () => {
  /*
   * The `high-speed-no-solution` render fixture: Mun, 12 km AGL, 350 m/s down and 100 m/s horizontal, 18 kN over 5 t (dry 3 t), 900 m/s dV, local TWR about 2.48.
   * ve = 900 / ln(5/3) = 1761.85 m/s (Isp about 179.6 s), and burnoutMass is the stage's dry 3 t.
   */
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
    // The optimal burn still arrives at terrain at about 278.5 m/s.
    expect(s.bestSpeedAtImpact as number).toBeGreaterThan(0.5);
    expect(s.bestSpeedAtImpact).toBeCloseTo(278.5, 0);
    // Fully nulling the vector (556 m/s) fits within 900: the limit is altitude, since stopping needs about 26 km.
    expect(s.burnDeltaV).toBeCloseTo(556, -1);
    expect(s.burnDuration).toBeCloseTo(132.4, 0);
    expect(s.suicideBurnCountdown).toBe(0); // past the ignition point
  });

  it("shortens the stopping distance vs the constant-decel fallback (mass loss)", () => {
    const rocket = solveSuicideBurn(HIGH_SPEED);
    // The same scenario without the engine inputs takes the constant-decel fallback.
    const constant = solveSuicideBurn({
      ...HIGH_SPEED,
      exhaustVelocity: undefined,
      burnoutMass: undefined,
    });
    // Both agree there is no vector, and the accurate model is less pessimistic.
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
    // 100 km of altitude but only about 200 m/s of stage dV, so the full-null burn (about 415 m/s) is never affordable: fuel is the wall.
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
