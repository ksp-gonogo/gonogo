import { afterEach, describe, expect, it, vi } from "vitest";
import { lookupUnit, registerUnit, resetUnitRegistry } from "./registry";
import { value } from "./value";

afterEach(() => {
  resetUnitRegistry();
  vi.restoreAllMocks();
});

describe("registerUnit", () => {
  it("makes a new unit a full participant, not just a label", () => {
    // The point of the extension surface. An Uplink's symbol has to divide,
    // add and convert exactly as a first-party one does.
    registerUnit({ symbol: "snacks", kind: "snacks", dimension: { snack: 1 } });
    registerUnit({
      symbol: "snacks/s",
      kind: "snackFlow",
      of: "snacks",
      per: "s",
    });

    expect(value("snacks", 6).dividedBy(value("s", 2)).unit).toBe("snacks/s");
    expect(value("snacks", 2).plus(value("snacks", 3)).magnitude).toBe(5);
    expect(() => value("snacks", 2).plus(value("m", 3))).toThrow();
  });

  it("throws naming the component it could not find", () => {
    // A compound built on a symbol nobody registered is a typo. Saying so at
    // registration beats rendering nonsense three screens later.
    expect(() =>
      registerUnit({ symbol: "u/s", kind: "flow", of: "u", per: "s" }),
    ).toThrow(/component "u" is not a registered unit/);
  });

  it("converts through a declared ratio", () => {
    registerUnit({
      symbol: "kSnack",
      kind: "snacks",
      dimension: { snack: 1 },
      ratio: 1_000,
    });
    registerUnit({ symbol: "snacks", kind: "snacks", dimension: { snack: 1 } });
    expect(value("kSnack", 2).plus(value("snacks", 500)).magnitude).toBeCloseTo(
      2.5,
      10,
    );
  });

  it("refuses a dimension and components together", () => {
    expect(() =>
      registerUnit({
        symbol: "x",
        kind: "x",
        dimension: { m: 1 },
        of: "m",
        per: "s",
      }),
    ).toThrow(/Pick one/);
  });

  it("refuses a ratio that is not a usable multiplier", () => {
    expect(() =>
      registerUnit({
        symbol: "x",
        kind: "x",
        dimension: { m: 1 },
        ratio: 0,
      }),
    ).toThrow(/finite non-zero/);
  });
});

describe("reserved symbols", () => {
  it("refuses m for anything but length", () => {
    // SI already resolved the metres/minutes collision, in favour of metres.
    // Left open, a mod declaring `m` for minutes would silently turn every
    // altitude on the dashboard into a duration.
    expect(() =>
      registerUnit({
        symbol: "m",
        kind: "time",
        dimension: { s: 1 },
        ratio: 60,
      }),
    ).toThrow(/Minutes are `min`/);
  });

  it("still allows the real one to be re-declared identically", () => {
    expect(() =>
      registerUnit({ symbol: "m", kind: "length", dimension: { m: 1 } }),
    ).not.toThrow();
  });
});

describe("overlap policy", () => {
  it("is silent when two mods declare the same thing", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    registerUnit({ symbol: "u", kind: "resourceUnits", dimension: { u: 1 } });
    registerUnit({ symbol: "u", kind: "resourceUnits", dimension: { u: 1 } });
    expect(warn).not.toHaveBeenCalled();
  });

  it("is silent when they agree on the quantity and differ on the meaning", () => {
    // Same dimension, different kind. N·m and J are the first-party example:
    // the difference is display's business, not arithmetic's.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    registerUnit({ symbol: "u", kind: "resourceUnits", dimension: { u: 1 } });
    registerUnit({ symbol: "u", kind: "snackUnits", dimension: { u: 1 } });
    expect(warn).not.toHaveBeenCalled();
    expect(lookupUnit("u")?.kind).toBe("resourceUnits");
  });

  it("keeps the first and warns when the dimensions disagree", () => {
    // A value carries only its symbol, so one symbol cannot have two
    // dimensions and still answer whether two values can be added. One has to
    // win, and it is not a reason to break someone's install.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    registerUnit({
      symbol: "g",
      kind: "mass",
      dimension: { kg: 1 },
      ratio: 0.001,
    });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toMatch(/already registered/);
    // g stays acceleration, as the first-party catalog declares it.
    expect(lookupUnit("g")?.kind).toBe("acceleration");
  });

  it("lets a later alias parse without ever rendering", () => {
    // J/s is registered after W and shares its dimension. A computed power
    // renders as W because first registration wins.
    expect(value("N", 1).times(value("m", 1)).per(value("s", 1)).unit).toBe(
      "W",
    );
    expect(lookupUnit("J/s")).toBeDefined();
  });
});

describe("real time is a different dimension from game time", () => {
  it("refuses to add a real duration to a game duration", () => {
    // Not restrictive, correct. They are related by the warp rate, which
    // varies: "in one hour IRL, how much game time passes" is a
    // multiplication, and a system that let them add would give an answer that
    // is only right at 1x warp.
    expect(() => value("s", 60).plus(value("irl:s", 60))).toThrow(
      /Cannot add s and irl:s/,
    );
  });

  it("climbs its own calendar", () => {
    // A KSP day is 6 hours and a real one is 24. Both are declared, and which
    // you get follows from the value rather than from the widget.
    expect(value("d", 1).in("h").magnitude).toBeCloseTo(6, 10);
    expect(value("irl:d", 1).in("irl:h").magnitude).toBeCloseTo(24, 10);
  });

  it("adds within its own calendar", () => {
    expect(value("irl:h", 1).plus(value("irl:min", 30)).magnitude).toBeCloseTo(
      1.5,
      10,
    );
  });
});
