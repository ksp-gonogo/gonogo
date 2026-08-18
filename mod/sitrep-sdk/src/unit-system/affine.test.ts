import { describe, expect, it } from "vitest";
import { UNIT_DEFINITIONS } from "./definitions";
import { affineVectorUnitFor } from "./registry";
import { value } from "./value";

/**
 * The affine rules at RUNTIME, which is the half a type test cannot reach.
 *
 * `affine.test-d.ts` proves `ut.minus(ut)` is typed `Value<"s">`. That would be a lie
 * if the runtime still tagged the result `ut`, and it would be a quiet one: the type
 * would read `s`, the rendered token would read `ut`, and only a reader comparing the
 * two would notice. So the unit that comes back is asserted here, not assumed.
 *
 * The refusals are deliberately NOT tested here. They are compile-time only: nothing
 * throws at runtime for `ut.plus(ut)`, because the dimension genuinely does match and
 * `requireSameDimension` has no opinion about kind. A test asserting a throw would
 * pass today by accident of the type layer and would be testing nothing.
 */

describe("affine units at runtime", () => {
  it("returns the companion VECTOR unit for a point minus a point", () => {
    const gap = value("ut", 1_200).minus(value("ut", 1_000));
    // The unit is the assertion. A magnitude-only check would pass on the old
    // behaviour too, since 200 is 200 either way.
    expect(gap.unit).toBe("s");
    expect(gap.magnitude).toBe(200);
  });

  it("converts across duration rungs before differencing, as subtraction always did", () => {
    const gap = value("ut", 7_200).minus(value("ut", 0));
    expect(gap.unit).toBe("s");
    expect(gap.in("h").magnitude).toBe(2);
  });

  it("keeps the POINT unit when a vector is subtracted from a point", () => {
    const earlier = value("ut", 1_000).minus(value("s", 60));
    expect(earlier.unit).toBe("ut");
    expect(earlier.magnitude).toBe(940);
  });

  it("keeps the point unit when a vector is added to a point", () => {
    const later = value("ut", 1_000).plus(value("h", 1));
    expect(later.unit).toBe("ut");
    expect(later.magnitude).toBe(4_600);
  });

  it("leaves vector arithmetic exactly as it was", () => {
    const total = value("s", 60).minus(value("s", 10));
    expect(total.unit).toBe("s");
    expect(total.magnitude).toBe(50);
  });

  it("leaves a non-affine dimension's subtraction on the left operand's unit", () => {
    // The control. If `minus` had started rewriting units generally rather than
    // only for point-like ones, this is what would move.
    const work = value("J", 10).minus(value("N·m", 4));
    expect(work.unit).toBe("J");
    expect(work.magnitude).toBe(6);
  });
});

describe("the affine declaration and the runtime lookup agree", () => {
  /**
   * The type layer reads `affineVector` off `UNIT_DEFINITIONS`; the runtime reads it
   * through the registry. Two readers of one declaration is exactly where a drift
   * hides, so the agreement is asserted rather than assumed.
   */
  it("resolves a companion vector for every unit declaring one, and no other", () => {
    const declared = Object.entries(
      UNIT_DEFINITIONS as Record<string, { affineVector?: string }>,
    )
      .filter(([, def]) => def.affineVector !== undefined)
      .map(([token]) => token);

    // Non-vacuous: there IS an affine unit, so the loop below is doing work.
    expect(declared).toEqual(["ut"]);

    for (const token of declared) {
      const vector = affineVectorUnitFor(token);
      expect(vector).toBeDefined();
      const def = (
        UNIT_DEFINITIONS as Record<string, { kind: string; ratio: number }>
      )[vector as string];
      expect(def?.kind).toBe(
        (UNIT_DEFINITIONS as Record<string, { affineVector?: string }>)[token]
          ?.affineVector,
      );
      // Base rung only: a computed value is in base units by construction, so
      // resolving to `min` or `h` would be off by a factor.
      expect(def?.ratio).toBe(1);
    }
  });

  it("answers undefined for a unit that declares nothing", () => {
    expect(affineVectorUnitFor("s")).toBeUndefined();
    expect(affineVectorUnitFor("m")).toBeUndefined();
    // Including the two other multi-kind dimensions, which are not affine.
    expect(affineVectorUnitFor("J")).toBeUndefined();
    expect(affineVectorUnitFor("%")).toBeUndefined();
  });
});
