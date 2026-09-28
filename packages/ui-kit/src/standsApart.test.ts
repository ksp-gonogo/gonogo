import { value } from "@ksp-gonogo/sitrep-sdk";
import { describe, expect, it } from "vitest";
import {
  placedOnScale,
  standsApart,
  writtenAs,
  writtenQuantity,
} from "./standsApart";

describe("standsApart", () => {
  it("holds a quantity that writes the same as the observation to be the same figure", () => {
    expect(
      standsApart(value("m", 250_000), value("m", 250_004), writtenQuantity()),
    ).toBe(false);
  });

  it("holds a quantity that differs in the last place written to stand apart", () => {
    expect(
      standsApart(value("m", 250_000), value("m", 250_120), writtenQuantity()),
    ).toBe(true);
  });

  it("answers at each unit's own precision", () => {
    const apart = (from: number, to: number, unit: "°" | "m") =>
      standsApart(value(unit, from), value(unit, to), writtenQuantity());
    // A tenth of a unit is inside a kilometre's written place and outside a degree's.
    expect(apart(250_000, 250_040, "m")).toBe(false);
    expect(apart(40, 40.04, "°")).toBe(true);
    expect(apart(40, 40.004, "°")).toBe(false);
  });

  it("answers at the precision the caller pinned", () => {
    const at = (decimals: number) =>
      standsApart(
        value("°", 40),
        value("°", 40.4),
        writtenQuantity({ decimals }),
      );
    expect(at(0)).toBe(false);
    expect(at(1)).toBe(true);
  });

  it("compares any figure through the writer that draws it", () => {
    const whole = writtenAs((n: number) => n.toFixed(0));
    expect(standsApart(50, 49.97, whole)).toBe(false);
    expect(standsApart(20, 17, whole)).toBe(true);
  });

  it("holds any figure beside no observation to stand apart", () => {
    const whole = writtenAs((n: number) => n.toFixed(0));
    expect(standsApart(null, 17, whole)).toBe(true);
    expect(standsApart(undefined, 17, whole)).toBe(true);
  });

  it("holds several figures to stand apart where any one does", () => {
    const scale = placedOnScale();
    expect(standsApart(0.5, [0.496, 0.504], scale)).toBe(false);
    expect(standsApart(0.5, [0.496, 0.53], scale)).toBe(true);
  });

  it("places figures on a scale clamped to it, one percent of it apart", () => {
    const scale = placedOnScale();
    expect(standsApart(1, [1.4], scale)).toBe(false);
    expect(standsApart(0.5, [0.511], scale)).toBe(true);
  });

  it("measures the short way round a scale whose ends meet", () => {
    expect(standsApart(0.998, [0.004], placedOnScale({ wraps: true }))).toBe(
      false,
    );
    expect(standsApart(0.998, [0.004], placedOnScale())).toBe(true);
  });
});
