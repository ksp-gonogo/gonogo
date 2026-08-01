import { describe, expect, it } from "vitest";
import { NULL_DISPLAY } from "./NullValue";
import { formatQuantity, kindOfUnit } from "./units";

/**
 * These pin the rules that a naive implementation gets wrong. Each one exists
 * because getting it backwards produces a plausible-looking readout that is
 * quietly false, which is the failure mode a dashboard cannot afford.
 */
describe("formatQuantity", () => {
  it("climbs the length ladder", () => {
    expect(formatQuantity(940, "m")).toMatchObject({
      value: "940.0",
      symbol: "m",
    });
    expect(formatQuantity(12_400, "m")).toMatchObject({
      value: "12.4",
      symbol: "km",
    });
    expect(formatQuantity(84_160_000, "m")).toMatchObject({
      value: "84.2",
      symbol: "Mm",
    });
  });

  it("does not scale a speed, because delta-v is read in m/s", () => {
    // "3.4 km/s" in a burn plan is correct and useless. There is deliberately
    // no speed ladder, so a large speed stays in the unit operators read.
    expect(formatQuantity(3412, "m/s")).toMatchObject({
      value: "3412.0",
      symbol: "m/s",
    });
  });

  it("holds the higher rung near a boundary, so a hovering value does not flicker", () => {
    // A vessel sitting at 999.6 m: without hysteresis this alternates between
    // "1.0 km" and "999.6 m" every frame and reads as a broken instrument.
    const held = formatQuantity(999.6, "m", { heldSymbol: "km" });
    expect(held.symbol).toBe("km");
    // Far enough below and it does drop back, so the hold is not permanent.
    expect(formatQuantity(400, "m", { heldSymbol: "km" }).symbol).toBe("m");
  });

  it("scales up promptly when climbing", () => {
    // The hold only ever keeps a HIGHER rung. Coming up through a boundary must
    // not be damped, or the readout lags the vehicle.
    expect(formatQuantity(1000, "m", { heldSymbol: "m" }).symbol).toBe("km");
  });

  it("multiplies a fraction but never a percentage", () => {
    // The classic dashboard unit bug: 0.42 shown as 42%, and an already-percent
    // value shown as 4200%. They are different units, never one.
    expect(formatQuantity(0.42, "ratio")).toMatchObject({
      value: "42",
      symbol: "%",
    });
  });

  it("renders an undeclared unit bare rather than guessing", () => {
    const out = formatQuantity(12.5, undefined);
    expect(out.symbol).toBe("");
    expect(out.value).toContain("12.5");
  });

  it("treats explicit dimensionless as distinct from absent", () => {
    // "1" means audited and dimensionless; absent means nobody has said yet.
    // Both render bare, but they must not be conflated in the model.
    expect(kindOfUnit("1")).toBe("dimensionless");
    expect(kindOfUnit(undefined)).toBeUndefined();
    expect(formatQuantity(0.0167, "1").symbol).toBe("");
  });

  it("keeps degrees and radians apart", () => {
    // KSP mixes them, which is why the contract declares which one it sends.
    expect(kindOfUnit("°")).toBe("angle");
    expect(kindOfUnit("rad")).toBe("angle");
    expect(formatQuantity(0.5, "rad").symbol).toBe("rad");
    expect(formatQuantity(28.5, "°").symbol).toBe("°");
  });

  it("never scales a temperature", () => {
    // No prefix convention here, and a Celsius display would be an offset
    // conversion that a multiplicative ladder cannot express.
    expect(formatQuantity(3200, "K")).toMatchObject({
      value: "3200",
      symbol: "K",
    });
  });

  it("honours scale: never", () => {
    expect(formatQuantity(12_400, "m", { scale: "never" })).toMatchObject({
      value: "12400.0",
      symbol: "m",
    });
  });

  it("degrades to the null display rather than printing NaN", () => {
    expect(formatQuantity(undefined, "m").value).toBe(NULL_DISPLAY);
    expect(formatQuantity(Number.NaN, "m").value).toBe(NULL_DISPLAY);
    expect(formatQuantity(null, "m").value).toBe(NULL_DISPLAY);
  });
});
