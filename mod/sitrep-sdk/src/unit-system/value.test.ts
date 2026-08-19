import { describe, expect, it } from "vitest";
import { UNIT_DEFINITIONS } from "./definitions";
import * as Dim from "./dimension";
import {
  hydrate,
  isValue,
  type UnknownUnit,
  type Value,
  value,
  vectorMagnitude,
} from "./value";

describe("dimension arithmetic", () => {
  it("subtracts exponents, so repeated division recurses", () => {
    // The whole reason for exponent maps. String-splitting would have given
    // "m/s/s", which is not a symbol anyone writes and cannot compare equal to
    // an acceleration produced any other way.
    const distance = value("m", 1_000);
    const time = value("s", 10);
    expect(distance.dividedBy(time).dividedBy(time).unit).toBe("m/s²");
  });

  it("flattens parenthesisation", () => {
    // (kg·m/s²)/m² and Pa are the same map, so they compare equal without
    // anyone declaring that they should.
    const force = value("N", 100);
    const area = value("m²", 4);
    expect(force.dividedBy(area).unit).toBe("Pa");
  });

  it("renders a multi-term denominator with brackets", () => {
    // "kg/m·s²" would read as (kg/m)·s², a different dimension.
    expect(Dim.formatDimension({ kg: 1, m: -1, s: -2 })).toBe("kg/(m·s²)");
    expect(Dim.formatDimension({ m: 1, s: -2 })).toBe("m/s²");
  });

  it("holds no zero exponents anywhere in the table", () => {
    // Structural equality is what gates `plus`, and `{m:1}` would not equal
    // `{m:1, s:0}`. Every operation normalises; this pins the hand-written
    // source they start from.
    const withZeros = Object.entries(UNIT_DEFINITIONS)
      .filter(([, def]) => Object.values(def.dim).some((e) => e === 0))
      .map(([symbol]) => symbol);
    expect(withZeros).toEqual([]);
  });
});

describe("plus and minus", () => {
  it("allows the same dimension under different names", () => {
    // W and J/s are the same thing spelled twice.
    expect(value("W", 5).plus(value("J/s", 3)).magnitude).toBe(8);
    expect(value("W", 5).plus(value("J/s", 3)).unit).toBe("W");
  });

  it("refuses torque plus energy, from either side", () => {
    // Same dimension, unrelated quantities, and both declare `coincidentWith`.
    // The message names the two kinds rather than the dimension they agree on,
    // because "kg·m²/s² is not kg·m²/s²" is what the old dimension check would
    // have had to say and it explains nothing.
    expect(() => value("N·m", 5).plus(value("J", 3))).toThrow(
      /torque and energy share the dimension/,
    );
    expect(() => value("J", 3).plus(value("N·m", 5))).toThrow(
      /energy and torque share the dimension/,
    );
  });

  it("refuses to convert, order or equate a torque against an energy", () => {
    expect(() => value("J", 1).in("N·m")).toThrow(/unrelated quantities/);
    expect(() => value("J", 1).lessThan(value("N·m", 2))).toThrow(
      /unrelated quantities/,
    );
    // `equals` is total, so it answers rather than throwing. One joule is not
    // one newton metre, and it used to say it was.
    expect(value("J", 1).equals(value("N·m", 1))).toBe(false);
  });

  it("still multiplies and divides across the coincidental pair", () => {
    // A torque times an angle is work; an energy over a torque is the angle
    // swept. The refusal is scoped to the additive surface for this reason.
    expect(value("N·m", 5).times(2).magnitude).toBe(10);
    expect(value("J", 10).dividedBy(value("N·m", 2)).magnitude).toBe(5);
  });

  it("converts to base before combining, and keeps the left unit", () => {
    // 2h + 120s = 7320s worth, expressed in hours because the left operand is.
    const total = value("h", 2).plus(value("s", 120));
    expect(total.unit).toBe("h");
    expect(total.magnitude).toBeCloseTo(2.0333333, 6);
    expect(total.in("s").magnitude).toBeCloseTo(7_320, 6);
  });

  it("refuses a different dimension", () => {
    expect(() => value("m", 5).plus(value("s", 35))).toThrow(
      /Cannot add m and s/,
    );
  });

  it("names both dimensions when it refuses", () => {
    expect(() => value("kW", 1).plus(value("K", 1))).toThrow(/kg·m²\/s³/);
  });
});

describe("times and dividedBy", () => {
  it("is total: any dimension over any dimension", () => {
    // rep/f is coherent even though nothing surfaces it. Refusing combinations
    // would be an exception list, and exception lists rot.
    const perFund = value("rep", 10).dividedBy(value("funds", 100));
    expect(perFund.magnitude).toBeCloseTo(0.1, 10);
    expect(perFund.unit).toBe("rep/funds");
  });

  it("prefers a declared name over a natural composition", () => {
    // A computed power reads as W, not kg·m²/s³, because that is what people
    // write. Only ratio-1 units are eligible: a computed value is in base units
    // by construction, so rendering it as kW would be off by a thousand.
    const power = value("N", 10).times(value("m", 2)).per(value("s", 4));
    expect(power.unit).toBe("W");
    expect(power.magnitude).toBeCloseTo(5, 10);
  });

  it("converts both operands to base first", () => {
    // 1 km over 1 min is 16.67 m/s, not 1.
    const speed = value("km", 1).dividedBy(value("min", 1));
    expect(speed.unit).toBe("m/s");
    expect(speed.magnitude).toBeCloseTo(16.6667, 4);
  });

  it("scales by a bare number without touching the unit", () => {
    expect(value("kW", 3).times(2)).toMatchObject({ magnitude: 6, unit: "kW" });
  });
});

describe("comparison", () => {
  it("compares across units of one dimension", () => {
    expect(value("h", 1).compare(value("min", 90))).toBe(-1);
    expect(value("km", 1).equals(value("m", 1_000))).toBe(true);
  });

  it("is false, not a throw, across dimensions", () => {
    // equals is a question, and the answer to "is 5m the same as 5s" is no.
    expect(value("m", 5).equals(value("s", 5))).toBe(false);
  });

  it("compares against a bare number by magnitude", () => {
    expect(value("kW", 3).equals(3)).toBe(true);
  });
});

describe("dimensionless units", () => {
  it("adds a percentage to a ratio correctly", () => {
    // 50% + 0.5 is 1.0, expressed as 100%. Both are dimensionless and the
    // ratios differ, which is exactly what stops one being read as the other.
    const total = value("%", 50).plus(value("ratio", 0.5));
    expect(total.unit).toBe("%");
    expect(total.magnitude).toBeCloseTo(100, 10);
  });

  it("keeps a count out of the dimensionless bucket", () => {
    // Adding three crew to a 0.5 ratio is nonsense; collapsing count into
    // dimensionless is what would have allowed it.
    expect(() => value("count", 3).plus(value("ratio", 0.5))).toThrow();
  });
});

describe("collisions the catalog has to survive", () => {
  it("keeps absorbed dose apart from angle per second", () => {
    // `rad` is a plane angle AND, in `rad/s`, an absorbed dose. Declaring the
    // compound outright is what stops it decomposing into angle-per-second,
    // which is rpm's dimension and would have compared equal.
    expect(() => value("rad/s", 1).plus(value("rpm", 1))).toThrow();
  });

  it("keeps g-force apart from a gram it never has to mean", () => {
    // Our own ladder starts mass at kg, so bare `g` is only ever acceleration
    // in the first-party set.
    expect(UNIT_DEFINITIONS.g.kind).toBe("acceleration");
  });
});

describe("serialisation", () => {
  it("survives JSON as magnitude and unit", () => {
    // The reason this is not `class Value extends Number`: JSON.stringify of a
    // Number object yields the bare primitive and the unit vanishes. Stations
    // receive these over PeerJS.
    expect(JSON.stringify(value("kW", 3.4))).toBe(
      '{"magnitude":3.4,"unit":"kW"}',
    );
  });

  it("costs two own properties", () => {
    expect(Object.keys(value("kW", 1))).toEqual(["magnitude", "unit"]);
  });

  it("hydrates a value that crossed a serialisation boundary", () => {
    const plain = JSON.parse(JSON.stringify(value("h", 2)));
    expect(typeof plain.plus).toBe("undefined");
    expect(hydrate(plain).plus(value("s", 120)).in("s").magnitude).toBeCloseTo(
      7_320,
      6,
    );
  });

  it("passes non-values through untouched", () => {
    expect(hydrate("hello")).toBe("hello");
    expect(hydrate(null)).toBe(null);
    expect(isValue({ magnitude: 1 })).toBe(false);
  });
});

describe("units outside the catalog", () => {
  it("treats an unknown symbol as its own base", () => {
    // An Uplink's symbol stays usable: it adds to itself, it renders, it
    // divides. What it does not do is get guessed at.
    expect(value("widgets", 2).plus(value("widgets", 3)).magnitude).toBe(5);
    expect(() => value("widgets", 2).plus(value("m", 3))).toThrow();
    expect(value("widgets", 6).dividedBy(value("s", 2)).unit).toBe("widgets/s");
  });

  it("UnknownUnit is a compile-time brand only; the runtime never sees it", () => {
    // `UnknownUnitBrand` is a `declare const`, which TypeScript never emits,
    // and `UnknownUnit`/`CombinableWith` are type aliases, which are erased
    // entirely. So a value born with an "unknown" unit is, at runtime,
    // exactly the same object `value()` always produced: two own properties
    // and the shared prototype. `CombinableWith` blocks `.plus` on it at
    // compile time; nothing changes below that line. `as` stands in here for
    // the narrowing a real boundary (a decoder, an Uplink adapter) would do
    // before choosing to combine two values it cannot statically vouch for.
    const a = value("Klevin", 300) as Value<UnknownUnit>;
    const b = value("Klevin", 12) as Value<UnknownUnit>;
    expect(a.plus(b as never).magnitude).toBe(312);
    expect(Object.getPrototypeOf(a)).toBe(Object.getPrototypeOf(value("m", 1)));
  });
});

describe("ordering", () => {
  const anHour = value("h", 1);
  const ninetyMinutes = value("min", 90);

  it("converts before comparing, so the bigger unit does not win by default", () => {
    // 1 h has a magnitude of 1 and 90 min has a magnitude of 90. Comparing the
    // magnitudes says the hour is smaller; comparing the QUANTITIES says it is
    // shorter, which happens to agree here and would not for 2 h against 120 s.
    expect(anHour.lessThan(ninetyMinutes)).toBe(true);
    expect(anHour.greaterThan(ninetyMinutes)).toBe(false);
    expect(value("h", 2).greaterThan(value("s", 120))).toBe(true);
  });

  it("has the inclusive forms agree with themselves", () => {
    const same = value("min", 60);
    expect(anHour.lessThanOrEqual(same)).toBe(true);
    expect(anHour.greaterThanOrEqual(same)).toBe(true);
    expect(anHour.lessThan(same)).toBe(false);
    expect(anHour.greaterThan(same)).toBe(false);
  });

  it("still exposes compare, for a sort comparator", () => {
    // The one place the -1/0/1 shape is the right answer.
    const sorted = [value("h", 2), value("min", 30), value("s", 45)].sort(
      (a, b) => a.compare(b),
    );
    expect(sorted.map((v) => v.unit)).toEqual(["s", "min", "h"]);
  });

  it("refuses to order across dimensions", () => {
    expect(() => value("m", 5).lessThan(value("s", 5) as never)).toThrow();
  });
});

describe("sign", () => {
  it("needs no operand, because zero needs no unit", () => {
    // Every unit of a dimension is a pure multiple of its base, so zero is
    // zero in all of them. This is the most common comparison in the codebase:
    // a resource rate being negative is what makes it a drain.
    expect(value("units/s", -0.32).isNegative()).toBe(true);
    expect(value("units/s", -0.32).isPositive()).toBe(false);
    expect(value("m/s", 12).isPositive()).toBe(true);
    expect(value("m", 0).isZero()).toBe(true);
  });

  it("agrees with itself whatever unit the zero is written in", () => {
    expect(value("h", 0).isZero()).toBe(true);
    expect(value("s", 0).isZero()).toBe(true);
    expect(value("km", 0).isZero()).toBe(true);
  });
});

describe("abs", () => {
  it("drops the sign and keeps the unit", () => {
    const drift = value("m", -14.2).abs();
    expect(drift.magnitude).toBe(14.2);
    expect(drift.unit).toBe("m");
  });

  it("returns the same value when there is nothing to do", () => {
    // No allocation for the common case.
    const positive = value("m", 14.2);
    expect(positive.abs()).toBe(positive);
  });
});

describe("min and max", () => {
  it("converts first, which is the whole point", () => {
    // Math.max(1h, 90min) via valueOf compares 1 against 90 and returns the 90
    // MINUTES, which is the shorter duration. This is the same hazard as
    // comparing .magnitude, and the reason these exist at all.
    const naive = Math.max(value("h", 1).valueOf(), value("min", 90).valueOf());
    expect(naive).toBe(90); // the wrong one, in the wrong unit

    expect(value("h", 1).max(value("min", 90)).unit).toBe("min");
    expect(value("h", 2).max(value("min", 90)).unit).toBe("h");
  });

  it("returns the operand, so the unit it was expressed in survives", () => {
    const anHour = value("h", 1);
    expect(anHour.min(value("min", 90))).toBe(anHour);
  });

  it("refuses across dimensions", () => {
    expect(() => value("m", 5).max(value("s", 5) as never)).toThrow();
  });
});

describe("vectorMagnitude", () => {
  it("returns a value in the unit the components share", () => {
    const relativePosition = {
      x: value("m", 3),
      y: value("m", 4),
      z: value("m", 0),
    };
    const distance = vectorMagnitude(relativePosition);
    expect(distance.magnitude).toBe(5);
    expect(distance.unit).toBe("m");
  });

  it("carries a velocity's unit, not a length's", () => {
    // The point of returning a Value rather than a number: a closing rate is
    // a speed, and the next thing that touches it should know.
    const relativeVelocity = {
      x: value("m/s", 0),
      y: value("m/s", 0),
      z: value("m/s", -2.4),
    };
    expect(vectorMagnitude(relativeVelocity).unit).toBe("m/s");
    expect(vectorMagnitude(relativeVelocity).magnitude).toBeCloseTo(2.4, 10);
  });

  it("is a free function because a vector has no prototype", () => {
    // wrapTopicPayload replaces the leaves and leaves the parent a plain
    // object, so a decoded vector cannot carry a method. Constructing one by
    // hand from decoded parts has to work identically.
    const decoded = JSON.parse(
      JSON.stringify({ x: value("m", 6), y: value("m", 8), z: value("m", 0) }),
    );
    expect(vectorMagnitude(decoded).magnitude).toBe(10);
  });
});
