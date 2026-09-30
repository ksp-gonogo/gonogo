import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { RegisteredUnit, SitrepUnit } from "@ksp-gonogo/sitrep-sdk";
import { registerUnit, setKspCalendar, value } from "@ksp-gonogo/sitrep-sdk";
import { afterEach, describe, expect, it } from "vitest";
import { NULL_DISPLAY } from "./NullValue";
import {
  formatGroupKey,
  formatQuantity,
  kindOfUnit,
  LADDERS,
  ladderPosition,
  pinGroupKey,
  quantityScale,
  separatingDecimals,
  setQuantityLocale,
  unitScaleKey,
  writeQuantity,
} from "./units";

/*
 * The units the extension tests below teach the kit, declared the way an Uplink
 * declares them. Registration goes through the SDK: there is no kit-side call.
 */
declare module "@ksp-gonogo/sitrep-sdk" {
  interface UnitDeclarations {
    quux: {
      kind: "dataRate";
      dim: { readonly quux: 1 };
      ratio: 1;
      ladder: "quuxes";
    };
    blorp: {
      kind: "data";
      dim: { readonly blorp: 1 };
      ratio: 1;
      ladder: "blorps";
    };
    "EC/s": {
      kind: "resourceRate";
      dim: { readonly ec: 1; readonly s: -1 };
      ratio: 1;
      ladder: "resourceRate";
    };
    qx: { kind: "hugeThing"; dim: { readonly qx: 1 }; ratio: 1 };
    "kerbals/hour": {
      kind: "crewFlow";
      dim: { readonly kerbal: 1; readonly s: -1 };
      ratio: number;
      ladder: "crewFlow";
    };
    zorp: {
      kind: "dataRate";
      dim: { readonly zorp: 1 };
      ratio: 1;
      ladder: "zorps";
    };
  }
}

/**
 * `registerUnit` as a separately compiled Uplink reaches it, for the tests of what
 * happens when two bundles disagree: one compilation cannot declare both.
 */
const registerFromAnotherBundle = (unit: RegisteredUnit): void => {
  Reflect.apply(registerUnit, undefined, [unit]);
};

/** A 24-hour day and a 365-day year, what RSS and `KERBIN_TIME` off both give. */
const EARTH_CALENDAR = {
  minute: 60,
  hour: 3600,
  day: 86_400,
  year: 365 * 86_400,
};

/** The rules whose inversion produces a plausible-looking readout that is quietly false. */
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
    expect(formatQuantity(3412, "m/s")).toMatchObject({
      value: "3412.0",
      symbol: "m/s",
    });
  });

  it("holds the higher rung near a boundary, so a hovering value does not flicker", () => {
    const held = formatQuantity(999.6, "m", { heldSymbol: "km" });
    expect(held.symbol).toBe("km");
    // Far enough below and it does drop back, so the hold is not permanent.
    expect(formatQuantity(400, "m", { heldSymbol: "km" }).symbol).toBe("m");
  });

  it("scales up promptly when climbing", () => {
    expect(formatQuantity(1000, "m", { heldSymbol: "m" }).symbol).toBe("km");
  });

  it("multiplies a fraction but never a percentage", () => {
    expect(formatQuantity(0.42, "ratio")).toMatchObject({
      value: "42",
      symbol: "%",
    });
    // A value KSP already hands over as 0-100 passes through untouched.
    expect(formatQuantity(62.5, "%")).toMatchObject({
      value: "62.5",
      symbol: "%",
    });
  });

  it("renders an undeclared unit bare rather than guessing", () => {
    const out = formatQuantity(12.5, undefined);
    expect(out.symbol).toBe("");
    expect(out.value).toContain("12.5");
  });

  it("treats explicit dimensionless as distinct from absent", () => {
    // "1" means dimensionless and absent means nobody has said: both render bare but are distinct in the model.
    expect(kindOfUnit("1")).toBe("dimensionless");
    expect(kindOfUnit(undefined)).toBeUndefined();
    expect(formatQuantity(0.0167, "1").symbol).toBe("");
  });

  it("keeps degrees and radians apart", () => {
    expect(kindOfUnit("°")).toBe("planeAngle");
    expect(kindOfUnit("rad")).toBe("planeAngle");
    expect(formatQuantity(0.5, "rad").symbol).toBe("rad");
    expect(formatQuantity(28.5, "°").symbol).toBe("°");
  });

  it("never scales a temperature", () => {
    expect(formatQuantity(3200, "K")).toMatchObject({
      value: "3200",
      symbol: "K",
    });
  });

  it("honours scale: never", () => {
    expect(formatQuantity(12_400, "m", { scale: "never" })).toMatchObject({
      value: "12,400.0",
      symbol: "m",
    });
  });

  it("ladders from the unit the field is actually in, not from the base unit", () => {
    // A tonne magnitude compared against kilogram thresholds would render "5.00 kg".
    expect(formatQuantity(5, "t")).toMatchObject({
      value: "5.00",
      symbol: "t",
    });
    expect(formatQuantity(250, "kN")).toMatchObject({
      value: "250.0",
      symbol: "kN",
    });
  });

  it("still climbs from a non-base unit", () => {
    expect(formatQuantity(2500, "t")).toMatchObject({
      value: "2.50",
      symbol: "kt",
    });
    expect(formatQuantity(0.4, "t")).toMatchObject({
      value: "400.00",
      symbol: "kg",
    });
  });

  it("climbs the energy-rate ladder from the kW the contract declares", () => {
    // Heat flux arrives in kW, and reentry runs to several thousand of them.
    expect(formatQuantity(842.3, "kW")).toMatchObject({
      value: "842.3",
      symbol: "kW",
    });
    expect(formatQuantity(2400, "kW")).toMatchObject({
      value: "2.4",
      symbol: "MW",
    });
    expect(formatQuantity(0.25, "kW")).toMatchObject({
      value: "250.0",
      symbol: "W",
    });
  });

  it("climbs the byte ladder from the MB an Uplink declares", () => {
    expect(formatQuantity(12.5, "MB")).toMatchObject({
      value: "12.5",
      symbol: "MB",
    });
    // Decimal rungs: a binary ladder would call this "4.0 GB".
    expect(formatQuantity(4096, "MB")).toMatchObject({
      value: "4.1",
      symbol: "GB",
    });
    expect(formatQuantity(0.002, "MB")).toMatchObject({
      value: "2.0",
      symbol: "KB",
    });
    expect(formatQuantity(0.000004, "MB")).toMatchObject({
      value: "4.0",
      symbol: "B",
    });
  });

  it("keeps a data size commensurable with an antenna's bits", () => {
    // A value in `bit` climbs the byte rungs rather than sitting at seven digits of bits.
    expect(formatQuantity(8e6, "bit")).toMatchObject({
      value: "1.0",
      symbol: "MB",
    });
    expect(formatQuantity(4e6, "bit")).toMatchObject({
      value: "500.0",
      symbol: "KB",
    });
    expect(formatQuantity(5, "bit")).toMatchObject({
      value: "5.0",
      symbol: "bit",
    });
  });

  it("is the decimal byte family, not the binary one", () => {
    // 1 KB is 8e3 bit, matching `kbit/s` on the rate ladder.
    expect(formatQuantity(8000, "bit")).toMatchObject({
      value: "1.0",
      symbol: "KB",
    });
    expect(formatQuantity(8192, "bit")).toMatchObject({
      value: "1.0",
      symbol: "KB",
    });
    expect(formatQuantity(8 * 1024 ** 3, "bit")).toMatchObject({
      value: "1.1",
      symbol: "GB",
    });
  });

  it("ladders on the ladder a unit declares, not on its kind", () => {
    // Two ladders share a kind and stay convertible while each keeps its own rungs.
    registerUnit({
      symbol: "quux",
      kind: "dataRate",
      dimension: { quux: 1 },
      ratio: 1,
      ladder: "quuxes",
      rungs: [
        { from: 1, symbol: "quux", per: 1 },
        { from: 1e3, symbol: "kquux", per: 1e3 },
      ],
    });
    expect(formatQuantity(2500, "quux")).toMatchObject({ symbol: "kquux" });
    // The kind's own ladder is untouched by the ladder that borrowed its kind.
    expect(formatQuantity(4.2e6, "bit/s")).toMatchObject({
      symbol: "Mbit/s",
    });
  });

  it("refuses to let two declarations disagree about one symbol", () => {
    // Same symbol and meaning from two mods is fine; different meanings would render by load order.
    const blorp = {
      symbol: "blorp",
      kind: "data",
      dimension: { blorp: 1 },
      ratio: 1,
      ladder: "blorps",
    } as const;
    registerUnit(blorp);
    registerUnit(blorp);
    expect(() =>
      registerFromAnotherBundle({ ...blorp, ladder: "otherBlorps" }),
    ).toThrow(/already declared/);
    registerUnit({ ...blorp, rungs: [{ from: 0, symbol: "blorp", per: 1 }] });
    expect(() =>
      registerUnit({ ...blorp, rungs: [{ from: 0, symbol: "blorp", per: 2 }] }),
    ).toThrow(/different ones/);
  });

  it("keeps the bit rate ladder for a bit rate", () => {
    expect(formatQuantity(4.2e6, "bit/s")).toMatchObject({
      value: "4.2",
      symbol: "Mbit/s",
    });
  });

  it("lets a caller pin a byte rung against the ladder", () => {
    // A rung is not a declared unit, so `format="MB"` resolves its ratio out of the ladder.
    expect(formatQuantity(4096, "MB", { format: "MB" })).toMatchObject({
      value: "4096.0",
      symbol: "MB",
    });
    expect(formatQuantity(0.002, "MB", { format: "B" })).toMatchObject({
      value: "2000.0",
      symbol: "B",
    });
    expect(formatQuantity(12.5, "MB", { format: "B" })).toMatchObject({
      value: "12,500,000.0",
      symbol: "B",
    });
  });

  it("labels a planetary mass on the right prefix tier", () => {
    /*
     * Kerbin, 5.2915e22 kg: gram-based symbols on kilogram thresholds. "52.92",
     * not "52.91", because `Intl` rounds the decimal where `toFixed` rounds the
     * binary value stored a hair under the half.
     */
    expect(formatQuantity(5.2915e22, "kg")).toMatchObject({
      value: "52.92",
      symbol: "Yg",
    });
  });

  it("writes a gravitational parameter in scientific notation", () => {
    const out = formatQuantity(3.5316e12, "m³/s²");
    expect(out.value).toBe("3.532×10¹²");
    expect(out.symbol).toBe("m³/s²");
  });

  it("uses real superscripts, not the programmer's e-form", () => {
    expect(formatQuantity(3.5316e12, "m³/s²").value).not.toContain("e");
    expect(formatQuantity(0.00042, "m", { scale: "scientific" }).value).toBe(
      "4.200×10⁻⁴",
    );
  });

  it("has a zero for scientific notation, which has no exponent", () => {
    // log10(0) is -Infinity, so this is the one input the general path cannot compute at all.
    expect(formatQuantity(0, "m³/s²").value).toBe("0");
  });

  it("shows a duration as composite KSP time, not as a decimal ladder", () => {
    // A KSP day is 6h.
    expect(formatQuantity(8100, "s")).toMatchObject({
      value: "2h 15min",
      symbol: "",
    });
    expect(formatQuantity(21_600, "s").value).toBe("1d");
  });

  it("still gives raw seconds when asked not to scale", () => {
    expect(formatQuantity(8100, "s", { scale: "never" })).toMatchObject({
      value: "8100",
      symbol: "s",
    });
  });

  it("shows kelvin as Celsius on request, offset and all", () => {
    expect(formatQuantity(300, "K", { as: "°C" })).toMatchObject({
      value: "27",
      symbol: "°C",
    });
  });

  it("shows an acceleration in gees on request", () => {
    expect(formatQuantity(29.42, "m/s²", { as: "g" })).toMatchObject({
      value: "3.00",
      symbol: "g",
    });
  });

  it("refuses a cross-kind presentation unit rather than inventing a number", () => {
    expect(formatQuantity(12_400, "m", { as: "K" })).toMatchObject({
      value: "12.4",
      symbol: "km",
    });
  });

  it("degrades to the null display rather than printing NaN", () => {
    expect(formatQuantity(undefined, "m").value).toBe(NULL_DISPLAY);
    expect(formatQuantity(Number.NaN, "m").value).toBe(NULL_DISPLAY);
    expect(formatQuantity(null, "m").value).toBe(NULL_DISPLAY);
  });
});

describe("catalog coverage", () => {
  it("knows a kind for every token the contract can declare", () => {
    /*
     * Read out of the generated file, so a new contract token with no kind
     * fails here. Resolved from cwd because under jsdom import.meta.url is not
     * a file: URL.
     */
    const src = readFileSync(
      join(process.cwd(), "../../mod/sitrep-sdk/src/__generated__/units.ts"),
      "utf8",
    );
    const known = src.slice(
      src.indexOf("export type KnownSitrepUnit ="),
      src.indexOf("export type SitrepUnit ="),
    );
    const tokens = [...known.matchAll(/\| "([^"]+)"/g)].map((m) => m[1]);

    expect(tokens.length).toBeGreaterThan(0);
    expect(tokens.filter((t) => kindOfUnit(t) === undefined)).toEqual([]);
  });

  it("names a kind for every LADDER RUNG, not just every unit", () => {
    // A rung is not a declared unit, so its kind is derived from the ladder.
    const rungs = [
      "km",
      "Mm",
      "Gm",
      "Tm",
      "t",
      "kt",
      "Tg",
      "Yg",
      "MN",
      "mPa",
      "kbit/s",
      "Mbit/s",
      "Gbit/s",
      "B",
      "KB",
      "MB",
      "GB",
    ];
    expect(rungs.filter((r) => kindOfUnit(r) === undefined)).toEqual([]);
    expect(kindOfUnit("Mbit/s")).toBe("dataRate");
    expect(kindOfUnit("Yg")).toBe("mass");
    expect(kindOfUnit("MB")).toBe("data");
    expect(kindOfUnit("GB")).toBe("data");
  });

  it("names a kind for a presentation-only unit reached by conversion", () => {
    // `°C` is named only by the conversion table.
    expect(kindOfUnit("°C")).toBe("temperature");
  });

  it("stores no first-party kind of its own", () => {
    const src = readFileSync(join(process.cwd(), "src/units.ts"), "utf8");
    expect(src).not.toMatch(/const KIND_BY_SYMBOL/);
  });

  it("agrees with the SDK on what each unit's kind is CALLED", () => {
    // The kind NAME is the key the conditional-props system uses, so ui-kit and the SDK must spell every kind alike.
    const src = readFileSync(
      join(
        process.cwd(),
        "../../mod/sitrep-sdk/src/unit-system/definitions.ts",
      ),
      "utf8",
    );
    const table = src.slice(
      src.indexOf("export const UNIT_DEFINITIONS = {"),
      src.indexOf("} as const satisfies"),
    );

    const mismatches: string[] = [];
    // The `dim: { ... }` sub-object is consumed explicitly, since a negated class would stop at its closing brace; the count below proves the pattern matches.
    const entries = [
      ...table.matchAll(
        /^\s*"?([^":\s]+)"?:\s*\{\s*dim:\s*\{[^}]*\}[^}]*kind:\s*"(\w+)"/gm,
      ),
    ];
    expect(entries.length).toBeGreaterThan(30);

    for (const entry of entries) {
      const [, symbol, sdkKind] = entry;
      const uiKind = kindOfUnit(symbol);
      // A unit the SDK declares and ui-kit has no opinion on is fine: the SDK carries base units (W, J, N·m, km, min) that never reach a readout.
      if (uiKind !== undefined && uiKind !== sdkKind) {
        mismatches.push(`${symbol}: ui-kit=${uiKind} sdk=${sdkKind}`);
      }
    }
    expect(mismatches).toEqual([]);
  });
});

/** The non-dimensional tokens must never leak onto the screen as a word. */
describe("non-dimensional units", () => {
  it("shows a count as an integer with no symbol", () => {
    expect(formatQuantity(12, "count")).toMatchObject({
      value: "12",
      symbol: "",
    });
  });

  it("rounds a count to an integer, where a dimensionless number keeps decimals", () => {
    expect(formatQuantity(3.4, "count").value).toBe("3");
    expect(formatQuantity(3.4, "1").value).toBe("3.40");
  });

  it("shows an identifier bare and never scales it", () => {
    expect(formatQuantity(1234, "id")).toMatchObject({
      value: "1234",
      symbol: "",
    });
  });

  it("keeps resource units, because that one IS a readable symbol", () => {
    // "35.6 units" is how KSP itself reads, so this token keeps its display.
    expect(formatQuantity(35.6, "units")).toMatchObject({
      value: "35.6",
      symbol: "units",
    });
  });

  it("prints no symbol for the type-shaped tokens", () => {
    for (const token of ["text", "flag", "enum", "n/a"]) {
      expect(formatQuantity(1, token).symbol).toBe("");
    }
  });

  it("still distinguishes a declared non-quantity from an undeclared field", () => {
    // Both render bare; the rung carries the difference between "nothing to say" and "nobody looked".
    expect(formatQuantity(5, "n/a").rung).toBe("n/a");
    expect(formatQuantity(5, undefined).rung).toBe("");
  });
});

/** The extension point, using only what a third-party Uplink can import, with a unit and a KIND this package has never heard of. */
describe("registerUnit", () => {
  it("renders an unknown unit bare rather than dropping it", () => {
    // A unit nobody taught the kit still renders; it just cannot scale or round.
    const out = formatQuantity(1234.5, "widgets/fortnight");
    expect(out.symbol).toBe("widgets/fortnight");
    expect(out.value).toContain("1234.5");
  });

  it("gives a third-party unit a kind, a precision and a ladder", () => {
    // "resourceRate" is not in KnownQuantityKind, and must still type-check.
    registerUnit({
      symbol: "EC/s",
      kind: "resourceRate",
      dimension: { ec: 1, s: -1 },
      ratio: 1,
      decimals: 2,
      ladder: "resourceRate",
      rungs: [
        { from: 0, symbol: "EC/s", per: 1 },
        { from: 1e3, symbol: "kEC/s", per: 1e3 },
      ],
    });

    expect(kindOfUnit("EC/s")).toBe("resourceRate");
    expect(formatQuantity(4.5, "EC/s")).toMatchObject({
      value: "4.50",
      symbol: "EC/s",
    });
    expect(formatQuantity(2500, "EC/s")).toMatchObject({
      value: "2.50",
      symbol: "kEC/s",
    });
  });

  it("lets a third party opt into scientific notation", () => {
    registerUnit({
      symbol: "qx",
      kind: "hugeThing",
      dimension: { qx: 1 },
      ratio: 1,
      scientific: true,
    });
    expect(formatQuantity(4.2e15, "qx").value).toBe("4.200×10¹⁵");
  });

  it("carries an Uplink's own unit end to end, wire type to rendered string", () => {
    // `SitrepUnit` is open, so a unit the contract never names can be declared, taught to the kit and formatted.
    const declared: SitrepUnit = "kerbals/hour";

    expect(formatQuantity(1500, declared).symbol).toBe("kerbals/hour");

    registerUnit({
      symbol: "kerbals/hour",
      kind: "crewFlow",
      dimension: { kerbal: 1, s: -1 },
      ratio: 1 / 3600,
      decimals: 1,
      ladder: "crewFlow",
      rungs: [
        { from: 0, symbol: "kerbals/hour", per: 1 },
        { from: 1e3, symbol: "kkerbals/hour", per: 1e3 },
      ],
    });

    expect(kindOfUnit(declared)).toBe("crewFlow");
    expect(formatQuantity(1500, declared)).toMatchObject({
      value: "1.5",
      symbol: "kkerbals/hour",
    });
  });

  it("does not disturb the built-ins it sits beside", () => {
    expect(formatQuantity(12_400, "m")).toMatchObject({
      value: "12.4",
      symbol: "km",
    });
    expect(formatQuantity(300, "K", { as: "°C" }).value).toBe("27");
  });
});

describe("formatQuantity, null handling", () => {
  it("still degrades to the null display", () => {
    expect(formatQuantity(undefined, "m").value).toBe(NULL_DISPLAY);
    expect(formatQuantity(Number.NaN, "m").value).toBe(NULL_DISPLAY);
    expect(formatQuantity(null, "m").value).toBe(NULL_DISPLAY);
  });
});

describe("a reading below a ladder's lowest rung", () => {
  // Walks LADDERS, so a ladder added later is held to this too.
  const lowest = Object.entries(LADDERS).map(
    ([name, rungs]) => [name, rungs[0].symbol] as const,
  );

  it.each(
    lowest,
  )("the %s ladder writes it scientifically instead of rounding it to zero", (_name, symbol) => {
    for (const planted of [3e-12, -3e-12]) {
      const out = formatQuantity(planted, symbol);
      expect(out.value).toContain("×10⁻");
      expect(out.value).not.toMatch(/^-?0([.,]0*)?$/);
      expect(out.symbol).toBe(symbol);
    }
  });

  it.each(
    lowest,
  )("the %s ladder still writes an exact zero as zero", (_n, s) => {
    expect(formatQuantity(0, s).value).toMatch(/^0([.,]0*)?$/);
  });

  it("keeps a reading the lowest rung can show in fixed notation", () => {
    expect(formatQuantity(0.3, "m").value).toBe("0.3");
    expect(formatQuantity(0.004, "mPa").value).toBe("4.000×10⁻³");
    expect(formatQuantity(0.006, "mPa").value).toBe("0.01");
  });

  it("follows the caller's decimals for its significant figures", () => {
    expect(formatQuantity(2e-9, "kg/m³", { decimals: 3 })).toMatchObject({
      value: "2.000×10⁻⁶",
      symbol: "g/m³",
    });
  });
});

describe("the attach rule is one rule", () => {
  it("writeQuantity attaches exactly what <Unit> attaches", () => {
    // Anything in ATTACHED_SYMBOLS goes hard against the number, as `<Unit>` writes it.
    expect(writeQuantity(value("°", 8), { decimals: 1 })).toBe("8.0°");
    // Everything else keeps SI's space, including the degree-Celsius pair.
    expect(writeQuantity(value("°C", 20), { decimals: 0 })).toBe("20 °C");
    expect(writeQuantity(value("m/s", 5), { decimals: 0 })).toBe("5 m/s");
  });

  it("attaches a currency mark, which SI does not govern", () => {
    expect(writeQuantity(value("funds", 42_500))).toBe("42,500f");
    expect(writeQuantity(value("science", 12.5))).toBe("12.5sci");
  });
});

describe("the two time kinds", () => {
  it("ladders irl:s on a real day and s on Kerbin's", () => {
    const oneRealDay = 24 * 60 * 60;
    expect(formatQuantity(oneRealDay, "irl:s").value).toBe("1d");
    expect(formatQuantity(oneRealDay, "s").value).toBe("4d");
  });

  it("carries no symbol, because the parts are inside the number", () => {
    expect(formatQuantity(90, "irl:s").symbol).toBe("");
    expect(writeQuantity(value("irl:s", 90))).toBe("1min 30s");
  });
});

describe("thousands", () => {
  it("groups money from a thousand, where a measurement waits for five digits", () => {
    expect(formatQuantity(2340, "funds").value).toBe("2,340");
    expect(formatQuantity(2340, "K").value).toBe("2340");
  });

  it("separates more than four digits and leaves four alone", () => {
    expect(formatQuantity(3200, "K").value).toBe("3200");
    expect(formatQuantity(78_401, "funds").value).toBe("78,401");
    expect(formatQuantity(1_234_567, "funds").value).toBe("1,234,567");
  });

  it("keeps the decimals outside the grouping, and the sign outside both", () => {
    expect(formatQuantity(-78_401.25, "funds", { decimals: 2 }).value).toBe(
      "-78,401.25",
    );
  });

  it("groups after the ladder has chosen a rung, not before", () => {
    expect(formatQuantity(12_400, "m").value).toBe("12.4");
    expect(formatQuantity(12_400, "m", { scale: "never" }).value).toBe(
      "12,400.0",
    );
  });

  it("leaves a duration and a scientific reading alone", () => {
    expect(formatQuantity(86_400, "s").value).toBe("4d");
    expect(formatQuantity(12_400, "irl:s").value).toBe("3h 26min");
  });
});

describe("the compact scale", () => {
  it("shortens money from ten thousand to three significant figures and a suffix", () => {
    expect(formatQuantity(1_289_848, "funds", { scale: "compact" })).toEqual({
      value: "1.29M",
      symbol: "f",
      rung: "funds",
    });
    expect(formatQuantity(12_500, "funds", { scale: "compact" }).value).toBe(
      "12.5k",
    );
    expect(
      formatQuantity(-4_200_000_000, "funds", { scale: "compact" }).value,
    ).toBe("-4.2G");
  });

  it("writes every digit below ten thousand", () => {
    expect(formatQuantity(9_999, "funds", { scale: "compact" }).value).toBe(
      "9,999",
    );
  });

  it("carries a rounded figure into the next suffix rather than writing four digits", () => {
    expect(formatQuantity(999_600, "funds", { scale: "compact" }).value).toBe(
      "1M",
    );
    expect(formatQuantity(999_400, "funds", { scale: "compact" }).value).toBe(
      "999k",
    );
  });

  it("is auto for a kind that is not counted like money", () => {
    expect(formatQuantity(12_400, "m", { scale: "compact" })).toEqual(
      formatQuantity(12_400, "m"),
    );
    expect(formatQuantity(123_456, "K", { scale: "compact" })).toEqual(
      formatQuantity(123_456, "K"),
    );
  });

  it("writes the digits in the locale while the suffix stays put", () => {
    setQuantityLocale("de-DE");
    try {
      expect(
        formatQuantity(1_289_848, "funds", { scale: "compact" }).value,
      ).toBe("1,29M");
    } finally {
      setQuantityLocale("en-GB");
    }
  });
});

describe("the locale is named, not ambient", () => {
  it("groups by locale rather than by a hand-rolled comma", () => {
    setQuantityLocale("de-DE");
    try {
      // Grouping is the locale's job: German swaps both separators.
      expect(formatQuantity(1_234_567.5, "funds", { decimals: 1 }).value).toBe(
        "1.234.567,5",
      );
    } finally {
      setQuantityLocale("en-GB");
    }
    expect(formatQuantity(1_234_567.5, "funds", { decimals: 1 }).value).toBe(
      "1,234,567.5",
    );
  });

  it("defaults to a locale rather than reading the runtime's", () => {
    // So a render on one machine matches one on another.
    expect(formatQuantity(78_401, "funds").value).toBe("78,401");
  });
});

// J and N·m are dimensionally identical but different KINDS (energy and torque), so a format across them is refused.
describe("formatQuantity: a format across KINDS is refused, not applied", () => {
  it("keeps J as J when asked to show it as N·m", () => {
    const shown = formatQuantity(50, "J", { format: "N·m" });

    expect(shown.symbol).toBe("J");
    expect(shown.value).not.toContain("N·m");
  });

  it("keeps N·m as N·m when asked to show it as J", () => {
    expect(formatQuantity(50, "N·m", { format: "J" }).symbol).toBe("N·m");
  });

  it("still honours a format within the same kind", () => {
    expect(formatQuantity(12_400, "m", { format: "km" }).symbol).toBe("km");
  });
});

describe("a duration is converted to seconds before it is laddered", () => {
  it("reads a value declared in days as days", () => {
    expect(formatQuantity(43, "d").value).toBe("43d");
  });

  it("reads a value declared in hours as hours", () => {
    expect(formatQuantity(2, "h").value).toBe("2h");
  });

  it("reads a value declared in minutes as minutes", () => {
    expect(formatQuantity(5, "min").value).toBe("5min");
  });

  it("reads a value declared in years as years", () => {
    expect(formatQuantity(1, "y").value).toBe("1y");
    expect(kindOfUnit("y")).toBe("time");
  });

  it("leaves a value already in seconds exactly as it was", () => {
    expect(formatQuantity(90, "s").value).toBe("1min 30s");
    expect(formatQuantity(928_800, "s").value).toBe("43d");
    expect(formatQuantity(8100, "s").value).toBe("2h 15min");
  });

  it("does the same for the wall-clock kind, which has the same rungs", () => {
    expect(formatQuantity(2, "irl:h").value).toBe("2h");
    expect(formatQuantity(1, "irl:d").value).toBe("1d");
    expect(formatQuantity(90, "irl:s").value).toBe("1min 30s");
  });

  it("still gives the raw magnitude when asked not to scale", () => {
    expect(formatQuantity(43, "d", { scale: "never" })).toMatchObject({
      value: "43",
      symbol: "d",
    });
  });
});

describe("a duration's rungs follow the calendar the game reported", () => {
  afterEach(() => {
    setKspCalendar();
  });

  it("re-sizes a day when the game says a day is 24 hours", () => {
    // Stock Kerbin: six-hour days, 426 to a year.
    expect(formatQuantity(43, "d").value).toBe("43d");
    expect(formatQuantity(1, "d", { format: "h" })).toMatchObject({
      value: "6",
      symbol: "h",
    });

    setKspCalendar(EARTH_CALENDAR);

    // Same 43 days, four times as long, 365 to a year.
    expect(formatQuantity(43, "d").value).toBe("43d");
    expect(formatQuantity(1, "d", { format: "h" })).toMatchObject({
      value: "24",
      symbol: "h",
    });
    expect(formatQuantity(1, "y").value).toBe("1y");
    expect(formatQuantity(365 * 86_400, "s").value).toBe("1y");
  });

  it("keeps the wall-clock kind on a real day whatever the game says", () => {
    setKspCalendar(EARTH_CALENDAR);
    expect(formatQuantity(1, "irl:d").value).toBe("1d");
    setKspCalendar({ day: 3600, hour: 600, minute: 10, year: 3600 * 100 });
    expect(formatQuantity(1, "irl:d").value).toBe("1d");
    expect(formatQuantity(24 * 3600, "irl:s").value).toBe("1d");
  });
});

describe("quantityScale", () => {
  it("settles one rung from the reference and holds it for every mark", () => {
    const scale = quantityScale(value("m", 5000));
    expect(scale.symbol).toBe("km");
    expect(scale.mark(5000)).toBe("5.0");
    expect(scale.mark(200)).toBe("0.2");
  });

  it("hands the symbol back APART, so a scale shows it once", () => {
    const scale = quantityScale(value("m", 5000));
    expect(scale.mark(1200)).not.toContain("km");
    expect(scale.symbol).toBe("km");
  });

  it("honours a pinned rung over the reference's own magnitude", () => {
    const scale = quantityScale(value("m", 5000), { format: "m" });
    expect(scale.symbol).toBe("m");
    expect(scale.rung).toBe("m");
  });

  it("reports an empty symbol for a kind that displays none", () => {
    expect(quantityScale(value("1", 3)).symbol).toBe("");
  });

  it("renders an absent mark as the null token rather than as a zero", () => {
    const scale = quantityScale(value("m", 5000));
    expect(scale.mark(null)).toBe(NULL_DISPLAY);
    expect(scale.mark(Number.NaN)).toBe(NULL_DISPLAY);
    expect(scale.mark(0)).toBe("0.0");
  });

  it("draws a bare scale when the reference never arrived, rather than throwing", () => {
    // An absent reference costs the header, not the marks.
    const scale = quantityScale(undefined);
    expect(scale.symbol).toBe("");
    expect(scale.mark(5)).toBe("5");
    expect(scale.mark(null)).toBe(NULL_DISPLAY);
  });
});

describe("unitScaleKey", () => {
  it("groups two units that climb one ladder", () => {
    expect(unitScaleKey("m")).toBe(unitScaleKey("km"));
    expect(unitScaleKey("kg")).toBe(unitScaleKey("t"));
  });

  it("separates two kinds of the same dimension", () => {
    expect(unitScaleKey("m")).not.toBe(unitScaleKey("m/s"));
  });

  // Bits and bytes share a kind and must never share RUNGS.
  it("separates two ladders that share a kind", () => {
    registerUnit({
      symbol: "zorp",
      kind: "dataRate",
      dimension: { zorp: 1 },
      ratio: 1,
      ladder: "zorps",
      rungs: [
        { from: 1, symbol: "zorp", per: 1 },
        { from: 1e3, symbol: "kzorp", per: 1e3 },
      ],
    });
    expect(unitScaleKey("zorp")).not.toBe(unitScaleKey("bit/s"));
  });

  // Durations, dates and scientific values report a rung nothing may be pinned to.
  it("has no key for a unit that never climbs", () => {
    expect(unitScaleKey("s")).toBeUndefined();
    expect(unitScaleKey("ut")).toBeUndefined();
    expect(unitScaleKey("m³/s²")).toBeUndefined();
    expect(unitScaleKey("funds")).toBeUndefined();
    expect(unitScaleKey("%")).toBeUndefined();
    expect(unitScaleKey(undefined)).toBeUndefined();
    expect(unitScaleKey("not a unit")).toBeUndefined();
  });
});

describe("pinGroupKey", () => {
  it("gives a laddered kind the key every unit of it reports under", () => {
    expect(pinGroupKey("length")).toBe(formatGroupKey("m"));
    expect(pinGroupKey("length")).toBe(formatGroupKey("Mm"));
    expect(pinGroupKey("mass")).toBe(formatGroupKey("t"));
    expect(pinGroupKey("length")).not.toBe(pinGroupKey("mass"));
  });

  // `s` and `min` are one kind and two groups.
  it("gives a unit that never climbs a key of its own", () => {
    expect(pinGroupKey("s")).toBe(formatGroupKey("s"));
    expect(pinGroupKey("s")).not.toBe(pinGroupKey("min"));
    expect(pinGroupKey("%")).toBe(formatGroupKey("%"));
  });

  it("resolves a token it has no ladder for", () => {
    expect(pinGroupKey("zorp")).toBe(formatGroupKey("zorp"));
  });
});

describe("ladderPosition", () => {
  it("normalises a reading that arrived partway up its own ladder", () => {
    expect(ladderPosition(5, "t").base).toBe(5000);
    expect(ladderPosition(12, "km").base).toBe(12_000);
    expect(ladderPosition(340, "m").base).toBe(340);
  });

  it("reports a magnitude by size, so a negative reading compares by size", () => {
    expect(ladderPosition(-12, "km").base).toBe(12_000);
  });

  it("reports the rung the reading alone would climb to", () => {
    expect(ladderPosition(999, "m").rung).toBe("m");
    expect(ladderPosition(1000, "m").rung).toBe("km");
    expect(ladderPosition(5, "t").rung).toBe("t");
  });

  it("leaves a unit with no ladder alone", () => {
    expect(ladderPosition(47, "units")).toMatchObject({
      base: 47,
      rung: "units",
    });
    expect(ladderPosition(47, undefined).base).toBe(47);
  });
});

describe("separatingDecimals", () => {
  const metres = (...readings: number[]) =>
    readings.map((reading) => ({ reading, unit: "m" }));

  it("leaves the default alone when the readings already read apart", () => {
    expect(separatingDecimals(metres(10, 90))).toBeUndefined();
  });

  it("widens until readings the default collapses read differently", () => {
    // 6 700 km and 6 710 km both print as "6.7 Mm" at the default one decimal.
    expect(separatingDecimals(metres(6_700_000, 6_710_000))).toBeGreaterThan(1);
  });

  it("returns undefined for readings that agree rather than six decimals of noise", () => {
    expect(separatingDecimals(metres(42, 42))).toBeUndefined();
  });

  it("has nothing to separate in a group of one", () => {
    expect(separatingDecimals(metres(6_700_000))).toBeUndefined();
  });

  // Written out of order, so comparing members as given fails.
  it("widens for the closest pair of a group, whatever order they arrive in", () => {
    expect(
      separatingDecimals(metres(6_710_000, 1_000_000, 6_700_000)),
    ).toBeGreaterThan(1);
  });

  // Ordering by the raw number would put 5 t below 900 kg.
  it("orders a mixed-rung group by what its readings measure", () => {
    expect(
      separatingDecimals([
        { reading: 5, unit: "t" },
        { reading: 900, unit: "kg" },
      ]),
    ).toBeUndefined();
  });

  /** The next representable double above `v`: one ULP, not a chosen epsilon. */
  const nextAfter = (v: number): number => {
    const buf = new Float64Array([v]);
    new BigUint64Array(buf.buffer)[0] += 1n;
    return buf[0];
  };

  // Adjacent doubles are closer than any decimal count can show, and spending every digit on them claims a precision they lack.
  it("gives up rather than spending digits on ends it cannot separate", () => {
    const alongside = 65_286.8;
    expect(
      separatingDecimals(metres(alongside, nextAfter(alongside))),
    ).toBeUndefined();
  });

  // Indistinguishable to a reader, so they must not render differently.
  it("treats unseparable ends and equal ends the same way", () => {
    const alongside = 65_286.8;
    expect(separatingDecimals(metres(alongside, nextAfter(alongside)))).toBe(
      separatingDecimals(metres(alongside, alongside)),
    );
  });

  it("still widens for ends that a finer precision does separate", () => {
    expect(separatingDecimals(metres(65_286.8, 65_287.1))).toBe(4);
  });
});
