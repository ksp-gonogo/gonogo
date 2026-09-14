import { afterEach, describe, expect, it, vi } from "vitest";
import {
  displaySymbol,
  lookupUnit,
  namespaceOf,
  onUnitRegistered,
  type RegisteredUnit,
  registerUnit,
  resetUnitRegistry,
} from "./registry";
import { value } from "./value";

declare module "./declarations" {
  interface UnitDeclarations {
    snacks: { kind: "snacks"; dim: { readonly snack: 1 }; ratio: 1 };
    kSnack: { kind: "snacks"; dim: { readonly snack: 1 }; ratio: 1000 };
    "snacks/s": {
      kind: "snackFlow";
      dim: { readonly snack: 1; readonly s: -1 };
      ratio: 1;
    };
    crumbs: {
      kind: "crumbs";
      dim: { readonly crumb: 1 };
      ratio: 1;
      ladder: "crumbs";
    };
    x: { kind: "x"; dim: { readonly m: 1 }; ratio: number };
    u: { kind: "resourceUnits"; dim: { readonly u: 1 }; ratio: 1 };
    "grocer:g": { kind: "mass"; dim: { readonly kg: 1 }; ratio: 0.001 };
    "grocer:m": { kind: "munchies"; dim: { readonly mn: 1 }; ratio: 1 };
  }
}

/**
 * `registerUnit` as a SECOND, separately compiled Uplink reaches it.
 *
 * Two bundles never share a program, so each one's declaration type-checks on its
 * own and they can still disagree at runtime. The policy below is about that case,
 * which one compilation cannot express, so these calls step around the type.
 */
const registerFromAnotherBundle = (unit: RegisteredUnit): void => {
  Reflect.apply(registerUnit, undefined, [unit]);
};

afterEach(() => {
  resetUnitRegistry();
  vi.restoreAllMocks();
});

describe("registerUnit", () => {
  it("makes a new unit a full participant, not just a label", () => {
    // The point of the extension surface. An Uplink's symbol has to divide,
    // add and convert exactly as a first-party one does.
    registerUnit({
      symbol: "snacks",
      kind: "snacks",
      dimension: { snack: 1 },
      ratio: 1,
    });
    registerUnit({
      symbol: "snacks/s",
      kind: "snackFlow",
      dimension: { snack: 1, s: -1 },
      ratio: 1,
    });

    expect(value("snacks", 6).dividedBy(value("s", 2)).unit).toBe("snacks/s");
    expect(value("snacks", 2).plus(value("snacks", 3)).magnitude).toBe(5);
    // @ts-expect-error a registered unit plus metres: refused statically and at runtime
    expect(() => value("snacks", 2).plus(value("m", 3))).toThrow();
  });

  it("converts through a declared ratio, and the declaration lets the compiler see it", () => {
    registerUnit({
      symbol: "kSnack",
      kind: "snacks",
      dimension: { snack: 1 },
      ratio: 1_000,
    });
    registerUnit({
      symbol: "snacks",
      kind: "snacks",
      dimension: { snack: 1 },
      ratio: 1,
    });
    // Both units are declared, so the type layer knows they share a dimension
    // exactly as it knows `km` and `m` do.
    expect(value("kSnack", 2).plus(value("snacks", 500)).magnitude).toBeCloseTo(
      2.5,
      10,
    );
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

  it("will not register a unit nobody declared, or one that disagrees with its declaration", () => {
    expect(() =>
      registerFromAnotherBundle({
        symbol: "undeclared",
        kind: "undeclared",
        dimension: { q: 1 },
        ratio: 1,
      }),
    ).not.toThrow();

    const typeOnly = () => {
      // @ts-expect-error a symbol with no declaration cannot be registered
      registerUnit({ symbol: "nope", kind: "nope", dimension: {}, ratio: 1 });
      registerUnit({
        symbol: "snacks",
        // @ts-expect-error the declaration says `snacks`
        kind: "crisps",
        dimension: { snack: 1 },
        ratio: 1,
      });
      registerUnit({
        symbol: "kSnack",
        kind: "snacks",
        dimension: { snack: 1 },
        // @ts-expect-error the declaration says 1000
        ratio: 100,
      });
      // @ts-expect-error the declaration names a ladder, so the registration must
      registerUnit({
        symbol: "crumbs",
        kind: "crumbs",
        dimension: { crumb: 1 },
        ratio: 1,
      });
    };
    expect(typeOnly).toBeTypeOf("function");
  });

  it("refuses rungs with no ladder to hang them on", () => {
    expect(() =>
      registerFromAnotherBundle({
        symbol: "loose",
        kind: "loose",
        dimension: { loose: 1 },
        ratio: 1,
        rungs: [{ from: 0, symbol: "loose", per: 1 }],
      }),
    ).toThrow(/rungs and no ladder/);
  });
});

describe("onUnitRegistered", () => {
  it("replays what was accepted before it subscribed, then hears what follows", () => {
    registerUnit({
      symbol: "crumbs",
      kind: "crumbs",
      dimension: { crumb: 1 },
      ratio: 1,
      ladder: "crumbs",
      rungs: [{ from: 0, symbol: "crumbs", per: 1 }],
      word: "crumbs",
    });
    const heard: string[] = [];
    const stop = onUnitRegistered((unit) => heard.push(unit.symbol));
    registerUnit({
      symbol: "u",
      kind: "resourceUnits",
      dimension: { u: 1 },
      ratio: 1,
    });
    stop();
    registerUnit({
      symbol: "snacks",
      kind: "snacks",
      dimension: { snack: 1 },
      ratio: 1,
    });
    expect(heard).toEqual(["crumbs", "u"]);
  });

  it("does not forward a registration the model refused", () => {
    // The kit must never render a symbol as something the model does not
    // believe it is.
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const heard: RegisteredUnit[] = [];
    const stop = onUnitRegistered((unit) => heard.push(unit));
    registerFromAnotherBundle({
      symbol: "g",
      kind: "mass",
      dimension: { kg: 1 },
      ratio: 0.001,
    });
    stop();
    expect(heard).toEqual([]);
  });
});

describe("reserved symbols", () => {
  it("refuses m for anything but length", () => {
    // SI already resolved the metres/minutes collision, in favour of metres.
    // Left open, a mod declaring `m` for minutes would silently turn every
    // altitude on the dashboard into a duration.
    expect(() =>
      registerFromAnotherBundle({
        symbol: "m",
        kind: "time",
        dimension: { s: 1 },
        ratio: 60,
      }),
    ).toThrow(/Minutes are `min`/);
  });

  it("still allows the real one to be re-declared identically", () => {
    expect(() =>
      registerUnit({
        symbol: "m",
        kind: "length",
        dimension: { m: 1 },
        ratio: 1,
        ladder: "length",
      }),
    ).not.toThrow();
  });
});

describe("overlap policy", () => {
  it("is silent when two mods declare the same thing", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    registerUnit({
      symbol: "u",
      kind: "resourceUnits",
      dimension: { u: 1 },
      ratio: 1,
    });
    registerUnit({
      symbol: "u",
      kind: "resourceUnits",
      dimension: { u: 1 },
      ratio: 1,
    });
    expect(warn).not.toHaveBeenCalled();
  });

  it("is silent when they agree on the quantity and differ on the meaning", () => {
    // Same dimension, different kind. N·m and J are the first-party example:
    // the difference is display's business, not arithmetic's.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    registerUnit({
      symbol: "u",
      kind: "resourceUnits",
      dimension: { u: 1 },
      ratio: 1,
    });
    registerFromAnotherBundle({
      symbol: "u",
      kind: "snackUnits",
      dimension: { u: 1 },
      ratio: 1,
    });
    expect(warn).not.toHaveBeenCalled();
    expect(lookupUnit("u")?.kind).toBe("resourceUnits");
  });

  it("does not mistake a slash in a literal token for a compound", () => {
    // `n/a` says the field has no unit at all. Reading it as `n` divided by
    // `a` threw on every render of a widget that declared one, because
    // neither half is a unit and never will be. Composition is an offer: an
    // unresolvable one means "not a unit I know", the same as any other
    // unrecognised token.
    expect(lookupUnit("n/a")).toBeUndefined();
    expect(() => lookupUnit("n/a")).not.toThrow();
  });

  it("keeps the first and warns when the dimensions disagree", () => {
    // A value carries only its symbol, so one symbol cannot have two
    // dimensions and still answer whether two values can be added. One has to
    // win, and it is not a reason to break someone's install.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    registerFromAnotherBundle({
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
    // @ts-expect-error game seconds plus real seconds: refused statically and at runtime
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

describe("namespaced symbols", () => {
  it("lets two mods keep the same glyph and different dimensions", () => {
    // The collision the overlap policy could only half-answer. `g` is
    // acceleration first-party; a grocer mod wanting grams namespaces its
    // token, and the two are then simply different units.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    registerUnit({
      symbol: "grocer:g",
      kind: "mass",
      dimension: { kg: 1 },
      ratio: 0.001,
    });
    expect(warn).not.toHaveBeenCalled();

    // Grams add to grams, and refuse to add to gees. Under the bare-symbol
    // policy these would have summed to a meaningless number.
    expect(value("grocer:g", 500).plus(value("grocer:g", 250)).magnitude).toBe(
      750,
    );
    // @ts-expect-error a namespaced gram plus a gee: refused statically and at runtime
    expect(() => value("grocer:g", 500).plus(value("g", 2))).toThrow();
  });

  it("converts a namespaced unit against the first-party base", () => {
    registerUnit({
      symbol: "grocer:g",
      kind: "mass",
      dimension: { kg: 1 },
      ratio: 0.001,
    });
    // `grocer:g` is declared against the kg base, so the compiler accepts the
    // conversion for the reason the runtime performs it
    expect(value("grocer:g", 1_500).in("kg").magnitude).toBeCloseTo(1.5, 10);
  });

  it("displays the glyph, not the token", () => {
    // A token may be namespaced; the symbol an operator reads never is.
    expect(displaySymbol("grocer:g")).toBe("g");
    expect(displaySymbol("g")).toBe("g");
    expect(namespaceOf("grocer:g")).toBe("grocer");
    expect(namespaceOf("g")).toBeUndefined();
  });

  it("is the same mechanism irl: already uses", () => {
    // Real seconds and game seconds are the first-party instance of exactly
    // this problem: one glyph, two dimensions, and they must not add.
    expect(displaySymbol("irl:s")).toBe("s");
    expect(displaySymbol("irl:d")).toBe("d");
    // @ts-expect-error real seconds plus game seconds: refused statically and at runtime
    expect(() => value("irl:s", 1).plus(value("s", 1))).toThrow();
  });

  it("does not let a namespace hijack a reserved symbol", () => {
    // `m` is metres and cannot be redefined. `grocer:m` hijacks nothing, so an
    // Uplink is free to mean whatever it likes by it.
    expect(() =>
      registerFromAnotherBundle({
        symbol: "m",
        kind: "time",
        dimension: { s: 1 },
        ratio: 60,
      }),
    ).toThrow();
    expect(() =>
      registerUnit({
        symbol: "grocer:m",
        kind: "munchies",
        dimension: { mn: 1 },
        ratio: 1,
      }),
    ).not.toThrow();
  });

  it("tells a colliding registration exactly what to do instead", () => {
    // The residual risk is real and cannot be designed away: a value carries
    // only its token, so if a mod insists on the bare glyph there is no way to
    // tell its values apart from the first mod's. The warning says so.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    registerFromAnotherBundle({
      symbol: "g",
      kind: "mass",
      dimension: { kg: 1 },
      ratio: 0.001,
    });
    const message = String(warn.mock.calls[0][0]);
    expect(message).toMatch(/NAMESPACE IT: declare "<yourmod>:g"/);
    expect(message).toMatch(/will ADD when they should not/);
  });
});
