import { describe, expect, it } from "vitest";
import { deriveActiveBurnParams } from "./burnParams";

/**
 * The suicide-burn solve uses the ACTIVE engine's specific impulse, with the whole-vessel multi-stage total only as a fallback.
 * Rows are the normalised `DeltaVStage` shape, so an absent figure is `NaN`.
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
    // A weak active lander stage on a big spent booster: only the active stage flies the landing burn.
    const params = deriveActiveBurnParams(
      row({ deltaVActual: 200, startMass: 5, endMass: 3 }),
      { totalMass: 5, dryMass: 3 },
      3200, // whole-vessel total, must NOT be used
      undefined,
    );
    // ve from the active stage: 200 / ln(5/3), about 391.5 m/s.
    expect(params.exhaustVelocity).toBeCloseTo(200 / Math.log(5 / 3), 3);
    expect(params.burnoutMass).toBe(3);
    // A whole-vessel derivation would be far higher.
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
    // Active stage present but malformed (no masses): no rocket params.
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
