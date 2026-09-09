import { afterEach, describe, expect, it } from "vitest";
import { assertGuardsRegistered, isUnit, unitGuard } from "./guards";
import { registerUnit, resetUnitRegistry } from "./registry";
import { value } from "./value";

afterEach(() => {
  // Registry is module state; a unit registered here would otherwise be
  // visible to every later test in the process.
  resetUnitRegistry();
});

describe("unitGuard", () => {
  it("matches its own token and nothing else", () => {
    const isOxygen = unitGuard("Oxygen:u");

    expect(isOxygen(value("Oxygen:u", 10))).toBe(true);
    expect(isOxygen(value("Food:u", 10))).toBe(false);
  });

  it("returns false for a symbol nobody registered, rather than throwing", () => {
    // A profile without snacks is a legitimate game, not an error. The guard
    // has to be usable before anyone knows whether the resource is present,
    // which is the whole reason it exists.
    expect(unitGuard("Snacks:u")(value("Oxygen:u", 1))).toBe(false);
  });

  it("narrows, so the arithmetic behind it is real", () => {
    registerUnit({
      symbol: "Oxygen:u",
      kind: "resourceAmount",
      dimension: { resOxygen: 1 },
    });
    const isOxygen = unitGuard("Oxygen:u");
    const candidate = value("Oxygen:u", 10);

    if (!isOxygen(candidate)) {
      throw new Error("guard should have matched");
    }
    const total = candidate.plus(value("Oxygen:u", 5));
    expect(total.magnitude).toBe(15);
    expect(total.unit).toBe("Oxygen:u");
  });

  it("checks identity, which does not cost compatibility", () => {
    // `kg` and `t` share a dimension and must go on combining after a narrow.
    // The guard being an identity test is what makes it a useful question;
    // it is not meant to answer "could these be added".
    const isKg = unitGuard("kg");
    expect(isKg(value("t", 2))).toBe(false);

    const mass = value("kg", 500);
    expect(mass.plus(value("t", 1)).magnitude).toBe(1500);
  });
});

describe("isUnit", () => {
  it("matches the unit it is asked about and nothing else", () => {
    expect(isUnit(value("m/s", 4), "m/s")).toBe(true);
    expect(isUnit(value("m/s", 4), "km/h")).toBe(false);
  });

  it("takes the unit as an argument, which is what unitGuard cannot do", () => {
    // The whole reason this exists beside `unitGuard`: the symbol is a
    // parameter here, so a caller handed a unit at runtime can ask about it.
    const ask = (unit: string) => isUnit(value("°", 12), unit);

    expect(ask("°")).toBe(true);
    expect(ask("rad")).toBe(false);
  });

  it("checks identity, so a compatible unit is still not a match", () => {
    // Same rule as `unitGuard`, and for the same reason: kilograms and tonnes
    // go on combining after a narrow, but neither IS the other.
    expect(isUnit(value("t", 2), "kg")).toBe(false);
  });

  it("is false for an unregistered symbol rather than throwing", () => {
    // A guard's typo and a resource the player's profile lacks are the same
    // observation from here, exactly as for `unitGuard`.
    expect(isUnit(value("Oxygen:u", 1), "Oxgyen:u")).toBe(false);
  });
});

describe("assertGuardsRegistered", () => {
  it("passes when every guarded symbol is registered", () => {
    registerUnit({
      symbol: "Oxygen:u",
      kind: "resourceAmount",
      dimension: { resOxygen: 1 },
    });
    expect(() => assertGuardsRegistered(["Oxygen:u"])).not.toThrow();
  });

  it("names the typo, which is the whole point", () => {
    registerUnit({
      symbol: "Oxygen:u",
      kind: "resourceAmount",
      dimension: { resOxygen: 1 },
    });
    // The failure this exists to catch: a guard that is always false, behind
    // which the code simply never runs and nothing errors.
    expect(() => assertGuardsRegistered(["Oxgyen:u"])).toThrow(/Oxgyen:u/);
  });

  it("reports every missing symbol at once, not just the first", () => {
    expect(() => assertGuardsRegistered(["A:u", "B:u"])).toThrow(/A:u, B:u/);
  });

  it("is happy with an empty list", () => {
    expect(() => assertGuardsRegistered([])).not.toThrow();
  });
});
