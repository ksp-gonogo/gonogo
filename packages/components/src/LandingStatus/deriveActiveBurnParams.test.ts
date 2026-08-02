import { describe, expect, it } from "vitest";
import { deriveActiveBurnParams } from "./index";

/**
 * The suicide-burn solve must use the ACTIVE engine's specific impulse, not a
 * whole-vessel multi-stage average. `dv.summary.totalDvActual` is the sum across
 * ALL stages, so deriving ve from it is wrong on a multi-stage craft, these
 * tests pin that the active stage (`dv.stages[currentStage]`) is preferred and
 * that the whole-vessel path is only a fallback.
 */
describe("deriveActiveBurnParams", () => {
  it("uses the ACTIVE stage, not the whole-vessel total", () => {
    // A weak lander stage (active) sitting on a big spent booster. The vessel
    // total ΔV is huge, but only the active stage flies the landing burn.
    const stages = [
      { stage: 0, dvActual: 200, startMass: 5, endMass: 3 }, // active lander
      { stage: 1, dvActual: 3000, startMass: 40, endMass: 8 }, // booster
    ];
    const params = deriveActiveBurnParams(
      stages,
      0,
      { totalMass: 5, dryMass: 3 },
      { totalDvActual: 3200 }, // whole-vessel sum, must NOT be used
    );
    // ve from the ACTIVE stage: 200 / ln(5/3) ≈ 391.5 m/s.
    expect(params.exhaustVelocity).toBeCloseTo(200 / Math.log(5 / 3), 3);
    expect(params.burnoutMass).toBe(3);
    // A whole-vessel derivation off totalDvActual would be far higher, prove
    // we're nowhere near it (that would grossly over-state the landing engine).
    expect(params.exhaustVelocity as number).toBeLessThan(1000);
  });

  it("falls back to whole-vessel dv.summary when no per-stage data", () => {
    const params = deriveActiveBurnParams(
      undefined,
      undefined,
      { totalMass: 5, dryMass: 3 },
      { totalDvActual: 900 },
    );
    // Single-stage lander: total == active, so the fallback is exact.
    expect(params.exhaustVelocity).toBeCloseTo(900 / Math.log(5 / 3), 3);
    expect(params.burnoutMass).toBe(3);
  });

  it("falls back to totalDvVac when totalDvActual is absent", () => {
    const params = deriveActiveBurnParams(
      undefined,
      undefined,
      { totalMass: 4, dryMass: 2 },
      { totalDvVac: 800 },
    );
    expect(params.exhaustVelocity).toBeCloseTo(800 / Math.log(4 / 2), 3);
    expect(params.burnoutMass).toBe(2);
  });

  it("returns nothing usable when neither source is present", () => {
    expect(
      deriveActiveBurnParams(undefined, undefined, undefined, undefined),
    ).toEqual({});
    // Active stage present but malformed (no masses) → no rocket params.
    expect(
      deriveActiveBurnParams(
        [{ stage: 0, dvActual: 200 }],
        0,
        undefined,
        undefined,
      ),
    ).toEqual({});
  });

  it("prefers the active stage even when a whole-vessel fallback exists", () => {
    const stages = [{ stage: 2, dvActual: 150, startMass: 3, endMass: 2 }];
    const params = deriveActiveBurnParams(
      stages,
      2,
      { totalMass: 3, dryMass: 2 },
      { totalDvActual: 5000 },
    );
    expect(params.exhaustVelocity).toBeCloseTo(150 / Math.log(3 / 2), 3);
    expect(params.burnoutMass).toBe(2);
  });
});
