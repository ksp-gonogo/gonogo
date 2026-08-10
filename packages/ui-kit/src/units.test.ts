import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { SitrepUnit } from "@ksp-gonogo/sitrep-sdk";
import { value } from "@ksp-gonogo/sitrep-sdk";
import { describe, expect, it } from "vitest";
import { NULL_DISPLAY } from "./NullValue";
import {
  formatQuantity,
  kindOfUnit,
  registerUnit,
  setQuantityLocale,
  writeQuantity,
} from "./units";

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
    // The other half, and the reason "%" is its own token rather than a
    // convention on "ratio": a value KSP already hands over as 0..100 must
    // pass through untouched. Multiplying it again gives 6250%, and dividing
    // a ratio by mistake gives 0.62%. Both look plausible enough on screen to
    // survive review, which is exactly why they cannot share a token.
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
    // "1" means audited and dimensionless; absent means nobody has said yet.
    // Both render bare, but they must not be conflated in the model.
    expect(kindOfUnit("1")).toBe("dimensionless");
    expect(kindOfUnit(undefined)).toBeUndefined();
    expect(formatQuantity(0.0167, "1").symbol).toBe("");
  });

  it("keeps degrees and radians apart", () => {
    // KSP mixes them, which is why the contract declares which one it sends.
    expect(kindOfUnit("°")).toBe("planeAngle");
    expect(kindOfUnit("rad")).toBe("planeAngle");
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
      value: "12,400.0",
      symbol: "m",
    });
  });

  it("ladders from the unit the field is actually in, not from the base unit", () => {
    // The contract carries what KSP sends, and KSP sends tonnes and kN. A
    // ladder keyed on kilograms compares a TONNE magnitude against KILOGRAM
    // thresholds, so 5 t fell to the bottom rung and rendered "5.00 kg": a
    // 1000x error under a label that looks entirely plausible. This is the
    // exact failure the module exists to prevent, so it is pinned here.
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
    // 2500 t is 2.5 kt: normalising to base must not cost the ladder its climb.
    expect(formatQuantity(2500, "t")).toMatchObject({
      value: "2.50",
      symbol: "kt",
    });
    // And back down: 0.4 t is 400 kg.
    expect(formatQuantity(0.4, "t")).toMatchObject({
      value: "400.00",
      symbol: "kg",
    });
  });

  it("climbs the energy-rate ladder from the kW the contract declares", () => {
    // Heat flux arrives in kW (KSP's thermal API), so the ladder's watt base
    // has to be normalised through before a rung is chosen. A reentry heat
    // shield runs to several thousand kW, and ThermalStatus's hand-rolled
    // formatter carried the MW rung that made that readable; dropping it in
    // the migration would put peak reentry flux back to four digits of kW.
    expect(formatQuantity(842.3, "kW")).toMatchObject({
      value: "842.3",
      symbol: "kW",
    });
    expect(formatQuantity(2400, "kW")).toMatchObject({
      value: "2.4",
      symbol: "MW",
    });
    // And down below the declared unit: 0.25 kW is 250 W.
    expect(formatQuantity(0.25, "kW")).toMatchObject({
      value: "250.0",
      symbol: "W",
    });
  });

  it("labels a planetary mass on the right prefix tier", () => {
    // Kerbin, 5.2915e22 kg. SystemView's hand-rolled ladder applied GRAM
    // thresholds to a KILOGRAM value and called this "52.91 Zg", one whole
    // tier low. Note what that bug looked like: the DIGITS were right and only
    // the label was wrong, which is exactly why it survived being read. The
    // symbols here are gram-based but every threshold is in kg, so the
    // mistake has nowhere to live.
    // "52.92", not "52.91": the number is exactly half way and `toFixed`, which
    // this used before `Intl`, rounds the BINARY value. 52.915 is stored a
    // hair under 52.915, so it went down. `Intl` rounds the decimal, which is
    // the answer a reader gets doing it by hand. (`(1.005).toFixed(2)` is
    // "1.00" for the same reason.)
    expect(formatQuantity(5.2915e22, "kg")).toMatchObject({
      value: "52.92",
      symbol: "Yg",
    });
  });

  it("writes a gravitational parameter in scientific notation", () => {
    // Kerbin's mu. "3531600000000" is unreadable and there is no prefix anyone
    // writes for 1e12 m³/s², so the notation the literature uses wins.
    const out = formatQuantity(3.5316e12, "m³/s²");
    expect(out.value).toBe("3.532×10¹²");
    expect(out.symbol).toBe("m³/s²");
  });

  it("uses real superscripts, not the programmer's e-form", () => {
    // "3.5e12" reads as part of the number to anyone who isn't a programmer.
    expect(formatQuantity(3.5316e12, "m³/s²").value).not.toContain("e");
    expect(formatQuantity(0.00042, "m", { scale: "scientific" }).value).toBe(
      "4.200×10⁻⁴",
    );
  });

  it("has a zero for scientific notation, which has no exponent", () => {
    // log10(0) is -Infinity, so this is the one input the general path cannot
    // compute at all.
    expect(formatQuantity(0, "m³/s²").value).toBe("0");
  });

  it("shows a duration as composite KSP time, not as a decimal ladder", () => {
    // Time climbs by 60 and 6 and 426, and reads two tiers at once. A KSP day
    // is 6h, which is exactly the kind of thing a hand-rolled ladder gets wrong.
    expect(formatQuantity(8100, "s")).toMatchObject({
      value: "2h 15min",
      // Interleaved with the number, so there is no symbol to pull out.
      symbol: "",
    });
    expect(formatQuantity(21_600, "s").value).toBe("1d");
  });

  it("still gives raw seconds when asked not to scale", () => {
    // The escape hatch: "never" means the plain base-unit number, which opts out
    // of the composite presentation as well as of any ladder.
    expect(formatQuantity(8100, "s", { scale: "never" })).toMatchObject({
      value: "8100",
      symbol: "s",
    });
  });

  it("shows kelvin as Celsius on request, offset and all", () => {
    // The presentation half of "SI on the wire": the field IS kelvin, the
    // operator READS Celsius, and neither one has to lie about it. An offset
    // conversion is also precisely what a multiplicative ladder cannot do.
    expect(formatQuantity(300, "K", { as: "°C" })).toMatchObject({
      value: "27",
      symbol: "°C",
    });
  });

  it("shows an acceleration in gees on request", () => {
    // 9.80665 m/s², the SI definition. KSP uses a single global constant for
    // this rather than a per-body value, and Kerbin's surface gravity is 9.81,
    // so the two readings coincide.
    expect(formatQuantity(29.42, "m/s²", { as: "g" })).toMatchObject({
      value: "3.00",
      symbol: "g",
    });
  });

  it("refuses a cross-kind presentation unit rather than inventing a number", () => {
    // Asking for a length in kelvin is a bug, not a preference. Converting it
    // would produce a wrong number under a right-looking label, which is the
    // exact failure this module exists to prevent, so the true unit survives.
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
    // The drift this catches: someone adds a token to Sitrep.Contract.Units,
    // the codegen happily emits it, and every value carrying it renders with
    // the raw token appended, so a readout reads "4200 kbit/s" one release and
    // "4200 someNewToken" the next. Nothing else would have failed.
    //
    // Read out of the generated file rather than restated here, so this cannot
    // pass by being updated in lockstep with the thing it is checking.
    // Resolved from cwd rather than import.meta.url: this suite runs under
    // jsdom, where import.meta.url is not a file: URL and fileURLToPath throws.
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
    // A rung is not a unit. `Mbit/s` and `kt` never appear in the contract and
    // have no entry in the model, but formatQuantity hands one back and the
    // caller then asks what it measures. That answer is derived from the
    // ladder rather than stored, so this checks the derivation covers every
    // rung rather than checking a table someone remembered to extend.
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
    ];
    expect(rungs.filter((r) => kindOfUnit(r) === undefined)).toEqual([]);
    expect(kindOfUnit("Mbit/s")).toBe("dataRate");
    expect(kindOfUnit("Yg")).toBe("mass");
  });

  it("names a kind for a presentation-only unit reached by conversion", () => {
    // The contract deliberately has no Celsius token, so `°C` is named in
    // exactly one place: the conversion table. That is enough to say it is a
    // temperature, and it means no table has to repeat it.
    expect(kindOfUnit("°C")).toBe("temperature");
  });

  it("stores no first-party kind of its own", () => {
    // The point of the generated table. Every kind ui-kit can answer comes
    // from the model, a ladder, or a conversion; a hand-written first-party
    // map is what drifted last time and there is no longer one to drift.
    const src = readFileSync(join(process.cwd(), "src/units.ts"), "utf8");
    expect(src).not.toMatch(/const KIND_BY_SYMBOL/);
  });

  it("agrees with the SDK on what each unit's kind is CALLED", () => {
    // The drift the coverage check above could not see. It only asked whether
    // a token had SOME kind, so the two tables were free to disagree on the
    // name, and seven of them did: kW was `energyRate` here and `power` there,
    // ° was `angle` against `planeAngle`, ratio was `fraction`.
    //
    // That matters because kind is the key the conditional-props system uses.
    // `format="date"` is offerable on a time and a type error on a length
    // because both sides agree on the string "time". Two spellings of one kind
    // means an Uplink's `declare module` augmentation silently targets nothing.
    //
    // Read out of the SDK source rather than restated here, for the same
    // reason as the coverage check: a hand-copied expectation passes by being
    // updated in lockstep with the thing it is checking.
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
    // The `dim: { ... }` sub-object has to be consumed explicitly. An earlier
    // version used `\{[^}]*kind:` and matched NOTHING, because the negated
    // class stops at dim's own closing brace: it passed with a divergence
    // deliberately reintroduced, which is why the count is asserted below.
    const entries = [
      ...table.matchAll(
        /^\s*"?([^":\s]+)"?:\s*\{\s*dim:\s*\{[^}]*\}[^}]*kind:\s*"(\w+)"/gm,
      ),
    ];
    expect(entries.length).toBeGreaterThan(30);

    for (const entry of entries) {
      const [, symbol, sdkKind] = entry;
      const uiKind = kindOfUnit(symbol);
      // A unit the SDK declares and ui-kit has no opinion on is fine: the SDK
      // carries base units (W, J, N·m, km, min) that never reach a readout.
      if (uiKind !== undefined && uiKind !== sdkKind) {
        mismatches.push(`${symbol}: ui-kit=${uiKind} sdk=${sdkKind}`);
      }
    }
    expect(mismatches).toEqual([]);
  });
});

/**
 * The non-dimensional tokens. These exist so the contract can DECLARE a
 * non-quantity rather than skip it, which is what makes a coverage gate
 * possible; the presentation rules below are what stop that declaration from
 * leaking onto the screen as a word.
 */
describe("non-dimensional units", () => {
  it("shows a count as an integer with no symbol", () => {
    // "12 count" is not a readout. The token names a category, so it renders
    // with an empty symbol and the caller supplies its own label.
    expect(formatQuantity(12, "count")).toMatchObject({
      value: "12",
      symbol: "",
    });
  });

  it("rounds a count to an integer, where a dimensionless number keeps decimals", () => {
    // The reason `count` is not `"1"`. Both are unitless; only one of them is
    // integral, and "3.00 crew" is wrong in a way "3.00 Mach" is not.
    expect(formatQuantity(3.4, "count").value).toBe("3");
    expect(formatQuantity(3.4, "1").value).toBe("3.40");
  });

  it("shows an identifier bare and never scales it", () => {
    // An id is a label. Climbing a ladder would turn flightID 1234 into
    // "1.2 k-something", which is not the same identifier.
    expect(formatQuantity(1234, "id")).toMatchObject({
      value: "1234",
      symbol: "",
    });
  });

  it("keeps resource units, because that one IS a readable symbol", () => {
    // The exception among the placeholders: "35.6 units" is how KSP itself
    // reads, so this token does not get an empty display.
    expect(formatQuantity(35.6, "units")).toMatchObject({
      value: "35.6",
      symbol: "units",
    });
  });

  it("prints no symbol for the type-shaped tokens", () => {
    // text / flag / enum reach a numeric formatter only by accident, but if
    // one does, it must not append the word "flag" to the number.
    for (const token of ["text", "flag", "enum", "n/a"]) {
      expect(formatQuantity(1, token).symbol).toBe("");
    }
  });

  it("still distinguishes a declared non-quantity from an undeclared field", () => {
    // Both render bare, and they are NOT the same statement: "n/a" is someone
    // saying there is nothing to say, `undefined` is nobody having looked. The
    // rung carries the difference through, which is what a coverage tool reads.
    expect(formatQuantity(5, "n/a").rung).toBe("n/a");
    expect(formatQuantity(5, undefined).rung).toBe("");
  });
});

/**
 * The extension point, tested from the outside in: everything below uses only
 * what a third-party Uplink can import, and a unit and a KIND this package has
 * never heard of.
 */
describe("registerUnit", () => {
  it("renders an unknown unit bare rather than dropping it", () => {
    // The fallback, and the reason registration is a ceiling rather than a
    // gate: a unit nobody taught the kit still reaches the operator. It just
    // cannot scale or round, because nothing knows what it measures.
    const out = formatQuantity(1234.5, "widgets/fortnight");
    expect(out.symbol).toBe("widgets/fortnight");
    expect(out.value).toContain("1234.5");
  });

  it("gives a third-party unit a kind, a precision and a ladder", () => {
    // An Uplink publishing a resource-rate topic the contract has never seen.
    // "resourceRate" is not in KnownQuantityKind, which is exactly the point:
    // a closed kind union would have made this a type error.
    registerUnit({
      symbol: "EC/s",
      kind: "resourceRate",
      decimals: 2,
      ladder: [
        { from: 0, symbol: "EC/s", per: 1 },
        { from: 1e3, symbol: "kEC/s", per: 1e3 },
      ],
    });

    expect(kindOfUnit("EC/s")).toBe("resourceRate");
    expect(formatQuantity(4.5, "EC/s")).toMatchObject({
      value: "4.50",
      symbol: "EC/s",
    });
    // And it climbs its own ladder, which is the half a bare fallback cannot do.
    expect(formatQuantity(2500, "EC/s")).toMatchObject({
      value: "2.50",
      symbol: "kEC/s",
    });
  });

  it("lets a third party opt into scientific notation", () => {
    registerUnit({ symbol: "qx", kind: "hugeThing", scientific: true });
    expect(formatQuantity(4.2e15, "qx").value).toBe("4.200×10¹⁵");
  });

  it("carries an Uplink's own unit end to end, wire type to rendered string", () => {
    // The seam, joined up. `SitrepUnit` is the type a wire payload's declared unit
    // arrives as, and it is open precisely so this line compiles: an Uplink cannot
    // add to `Sitrep.Contract.Units`, so if that type were closed it could never
    // declare a unit at all and this whole extension point would be decorative.
    //
    // Nothing about "kerbals/hour" exists anywhere in the contract. It goes in as a
    // declared unit, is taught to the kit here, and comes out formatted.
    const declared: SitrepUnit = "kerbals/hour";

    // Before registration it still renders, bare: the fallback is a floor.
    expect(formatQuantity(1500, declared).symbol).toBe("kerbals/hour");

    registerUnit({
      symbol: declared,
      kind: "crewFlow",
      decimals: 1,
      ladder: [
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
    // Registration is additive. A third party teaching the kit its own unit
    // must not be able to shift what metres or kelvin do.
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

describe("the attach rule is one rule", () => {
  it("writeQuantity attaches exactly what <Unit> attaches", () => {
    // These two disagreed: the component wrote `8.0°` and this wrote `8.0 °`,
    // so the same angle read differently in a readout and in the SVG label
    // beside it. Anything in ATTACHED_SYMBOLS goes hard against the number.
    expect(writeQuantity(value("°", 8), { decimals: 1 })).toBe("8.0°");
    // And everything else keeps SI's space, including the degree-Celsius pair
    // that looks like it should attach and does not.
    expect(writeQuantity(value("°C", 20), { decimals: 0 })).toBe("20 °C");
    expect(writeQuantity(value("m/s", 5), { decimals: 0 })).toBe("5 m/s");
  });

  it("attaches a currency mark, which SI does not govern", () => {
    // `42,500 f` would be a visible change to every funds readout in the app,
    // justified by a rule about SI units that a currency mark is not.
    expect(writeQuantity(value("funds", 42_500))).toBe("42,500f");
    expect(writeQuantity(value("science", 12.5))).toBe("12.5sci");
  });
});

describe("the two time kinds", () => {
  it("ladders irl:s on a real day and s on Kerbin's", () => {
    // One day of wall clock. The game-time kind reads it as four Kerbin days,
    // which is correct for a mission clock and nonsense for a staleness badge,
    // and the only thing keeping them apart is the unit on the value.
    const oneRealDay = 24 * 60 * 60;
    expect(formatQuantity(oneRealDay, "irl:s").value).toBe("1d");
    expect(formatQuantity(oneRealDay, "s").value).toBe("4d");
  });

  it("carries no symbol, because the parts are inside the number", () => {
    // Same reason `s` comes back bare: "2h 15min" cannot be split into a
    // value and a symbol the way "12.4" and "km" can.
    expect(formatQuantity(90, "irl:s").symbol).toBe("");
    expect(writeQuantity(value("irl:s", 90))).toBe("1min 30s");
  });
});

describe("thousands", () => {
  it("groups money from a thousand, where a measurement waits for five digits", () => {
    // SI's four-digit exemption is about technical readings. Money is written
    // with a comma from a thousand everywhere, and the first cut of this got
    // it wrong: a 2,340f balance came out as "2340f".
    expect(formatQuantity(2340, "funds").value).toBe("2,340");
    expect(formatQuantity(2340, "K").value).toBe("2340");
  });

  it("separates more than four digits and leaves four alone", () => {
    // SI's rule, and the reason a technical readout keeps its instrument look:
    // a four-digit temperature is a number you read off a gauge, a six-digit
    // funds balance is a number you count.
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
    // The ladder is why this almost never fires on a physical quantity: a
    // length long enough to need a comma climbs to a bigger unit first. It
    // only shows on a value the top rung cannot shrink.
    expect(formatQuantity(12_400, "m").value).toBe("12.4");
    expect(formatQuantity(12_400, "m", { scale: "never" }).value).toBe(
      "12,400.0",
    );
  });

  it("leaves a duration and a scientific reading alone", () => {
    // Both interleave their own notation into the number, and a comma inside
    // either one is noise rather than a separator.
    expect(formatQuantity(86_400, "s").value).toBe("4d");
    expect(formatQuantity(12_400, "irl:s").value).toBe("3h 26min");
  });
});

describe("the locale is named, not ambient", () => {
  it("groups by locale rather than by a hand-rolled comma", () => {
    setQuantityLocale("de-DE");
    try {
      // German swaps both separators. The point is not that anybody runs the
      // app this way, it is that grouping is `Intl`'s job now and the door is
      // open, where a hand-rolled comma had bolted it shut.
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
    // So a snapshot rendered on one machine matches one rendered on another,
    // and the visual baselines with them.
    expect(formatQuantity(78_401, "funds").value).toBe("78,401");
  });
});
