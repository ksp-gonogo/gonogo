import { describe, expect, it } from "vitest";
import { deriveActiveBurnParams } from "./index";

/**
 * The suicide-burn solve must use the ACTIVE engine's specific impulse, not a
 * whole-vessel multi-stage average. `dv.summary.totalDvActual` is the total
 * across ALL stages, so deriving ve from it is wrong on a multi-stage craft;
 * these tests pin that the active stage (`DELTA_V_BUDGET.activeStage`) is
 * preferred and that the whole-vessel path is only a fallback.
 *
 * Rows are the normalised `DeltaVStage` shape, so an absent figure is `NaN`
 * rather than missing: that is what the wire means by "the sim had no figure",
 * and the guards under test read it with `Number.isFinite`.
 */
/** A normalised row with `NaN` everywhere the case does not care about. */
function row(fields: {
  deltaVActual?: number;
  deltaVVac?: number;
  startMass?: number;
  endMass?: number;
}) {
  return {
    deltaVActual: fields.deltaVActual ?? Number.NaN,
    deltaVVac: fields.deltaVVac ?? Number.NaN,
    startMass: fields.startMass ?? Number.NaN,
    endMass: fields.endMass ?? Number.NaN,
  };
}
describe("deriveActiveBurnParams", () => {
  it("uses the ACTIVE stage, not the whole-vessel total", () => {
    // A weak lander stage (active) sitting on a big spent booster. The vessel
    // total ΔV is huge, but only the active stage flies the landing burn.
    const params = deriveActiveBurnParams(
      row({ deltaVActual: 200, startMass: 5, endMass: 3 }),
      { totalMass: 5, dryMass: 3 },
      3200, // whole-vessel total, must NOT be used
      undefined,
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
      null,
      { totalMass: 5, dryMass: 3 },
      900,
      undefined,
    );
    // Single-stage lander: total == active, so the fallback is exact.
    expect(params.exhaustVelocity).toBeCloseTo(900 / Math.log(5 / 3), 3);
    expect(params.burnoutMass).toBe(3);
  });

  it("falls back to totalDvVac when totalDvActual is absent", () => {
    const params = deriveActiveBurnParams(
      null,
      { totalMass: 4, dryMass: 2 },
      undefined,
      800,
    );
    expect(params.exhaustVelocity).toBeCloseTo(800 / Math.log(4 / 2), 3);
    expect(params.burnoutMass).toBe(2);
  });

  it("returns nothing usable when neither source is present", () => {
    expect(
      deriveActiveBurnParams(null, undefined, undefined, undefined),
    ).toEqual({});
    // Active stage present but malformed (no masses) → no rocket params.
    expect(
      deriveActiveBurnParams(
        row({ deltaVActual: 200 }),
        undefined,
        undefined,
        undefined,
      ),
    ).toEqual({});
  });

  it("prefers the active stage even when a whole-vessel fallback exists", () => {
    const params = deriveActiveBurnParams(
      row({ deltaVActual: 150, startMass: 3, endMass: 2 }),
      { totalMass: 3, dryMass: 2 },
      5000,
      undefined,
    );
    expect(params.exhaustVelocity).toBeCloseTo(150 / Math.log(3 / 2), 3);
    expect(params.burnoutMass).toBe(2);
  });
});
