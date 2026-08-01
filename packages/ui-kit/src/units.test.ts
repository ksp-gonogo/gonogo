import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { SitrepUnit } from "@ksp-gonogo/sitrep-sdk";
import { describe, expect, it } from "vitest";
import { NULL_DISPLAY } from "./NullValue";
import { formatQuantity, kindOfUnit, registerUnit } from "./units";

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

  it("labels a planetary mass on the right prefix tier", () => {
    // Kerbin, 5.2915e22 kg. SystemView's hand-rolled ladder applied GRAM
    // thresholds to a KILOGRAM value and called this "52.91 Zg", one whole
    // tier low. Note what that bug looked like: the DIGITS were right and only
    // the label was wrong, which is exactly why it survived being read. The
    // symbols here are gram-based but every threshold is in kg, so the
    // mistake has nowhere to live.
    expect(formatQuantity(5.2915e22, "kg")).toMatchObject({
      value: "52.91",
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
      value: "2h 15m",
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
