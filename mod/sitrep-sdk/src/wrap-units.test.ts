import { describe, expect, it } from "vitest";
import type { TopicId } from "./topics";
import { isValue, type Value, value } from "./unit-system";
import { registerTopicUnits } from "./units";
import {
  hydratePayload,
  wrapTopicPayload,
  wrapTypePayload,
} from "./wrap-units";

/** A wrapped field as the `Value` it must now be, or a failure saying what it is. */
const asValue = (v: unknown): Value => {
  if (!isValue(v)) {
    throw new Error(`expected a Value, got: ${JSON.stringify(v)}`);
  }
  return v;
};

// A name-keyed map of same-unit readings, registered rather than named out of this assembly's generated map.
//
// The form used to be exercised through a real core Topic, because the four
// fields carrying it all lived in Sitrep.Contract. They relocated into the
// Uplink that owns them (uplink-types-out-of-core plan), so core's generated
// output now contains no example of the form and this file cannot reach one
// without naming a mod: which is exactly what the relocation exists to stop a
// mod-agnostic file doing.
//
// Registering a synthetic Topic through the SDK's own public
// `registerTopicUnits` keeps the MECHANISM tested here, where it lives, and
// keeps it non-vacuous (a bare number would fail every assertion below). The
// real Topic's decode is asserted in the owning Uplink's client tests, driven
// through a live TelemetryClient. Both halves exist; neither names the other's
// business.
const MAP_TOPIC = "test.nameKeyedRates" as TopicId;
registerTopicUnits(MAP_TOPIC, { rates: "units/s" });

describe("wrapTopicPayload", () => {
  it("turns a declared quantity into a value that knows its unit", () => {
    // The runtime half of the contract's declaration. After this, nobody has
    // to name the unit again.
    const payload = wrapTopicPayload("vessel.thermal", {
      heatShieldTemp: 1_200,
    } as never) as { heatShieldTemp: Value };
    expect(isValue(payload.heatShieldTemp)).toBe(true);
    expect(payload.heatShieldTemp.unit).toBe("K");
    expect(payload.heatShieldTemp.magnitude).toBe(1_200);
  });

  it("wraps every VALUE of a name-keyed map of same-unit readings", () => {
    // A rate per resource NAME. Before this case existed, every name-keyed
    // channel's values were nested shapes (`vessel.resources` ->
    // ResourceAmount) whose own properties carried the units, so a map of bare
    // scalars had no case and arrived as raw numbers a consumer had to guess at.
    const payload = wrapTopicPayload(MAP_TOPIC, {
      rates: { Water: -0.000054, ElectricCharge: -0.1856, Nitrogen: 0 },
    } as never) as { rates: Record<string, Value> };

    expect(isValue(payload.rates.Water)).toBe(true);
    expect(payload.rates.Water.unit).toBe("units/s");
    expect(payload.rates.Water.magnitude).toBe(-0.000054);
    // The key is a resource name and must survive untouched: it is data, not a property name, so nothing may camel-case it.
    expect(Object.keys(payload.rates)).toContain("ElectricCharge");
    // A present ZERO is a real reading (in balance), not an absence.
    expect(asValue(payload.rates.Nitrogen).magnitude).toBe(0);
  });

  it("wrapping a map twice leaves it alone", () => {
    // Same idempotence the scalar and list cases have, and for the same reason: a payload can be re-decoded on reconnect.
    const once = wrapTopicPayload(MAP_TOPIC, {
      rates: { Water: -0.000054 },
    } as never);
    const twice = wrapTopicPayload(MAP_TOPIC, once);
    const rates = (twice as { rates: Record<string, Value> }).rates;
    expect(isValue(rates.Water)).toBe(true);
    expect(rates.Water.magnitude).toBe(-0.000054);
    expect(rates.Water.unit).toBe("units/s");
  });

  it("leaves a non-quantity alone", () => {
    // text, flag, enum, id and n/a have no dimension and were never units, so the registry lookup skips them without needing a list.
    const payload = wrapTopicPayload("vessel.identity", {
      name: "Kerbal X",
    } as never) as { name: unknown };
    expect(payload.name).toBe("Kerbal X");
  });

  it("does not mint a key for a field the frame omitted", () => {
    // A Topic sends a subset of its fields routinely, and the wrap runs over
    // the DECLARATION rather than over what arrived. Assigning unconditionally
    // gave every absent field an own property holding `undefined`: enough to
    // change `Object.keys`, make `"sma" in payload` true for something that
    // never came, and write nulls into a re-serialised frame. Two replay tests
    // caught it; this is the one that names it.
    const payload = wrapTopicPayload("vessel.orbit", {
      sma: 680_000,
    } as never) as Record<string, unknown>;
    expect(Object.keys(payload)).toEqual(["sma"]);
    expect("ecc" in payload).toBe(false);
  });

  it("follows a field that holds another payload shape", () => {
    // `vessel.target.orbit` is a whole VesselOrbit. The unit maps are flat per
    // shape, so its declared units were unreachable from the vessel.target
    // entry and `sma` arrived bare while the contract typed it Value<"m">.
    const payload = wrapTopicPayload("vessel.target", {
      orbit: { sma: 700_000, ecc: 0.01 },
    } as never) as { orbit: { sma: Value; ecc: Value } };
    expect(payload.orbit.sma.unit).toBe("m");
    expect(payload.orbit.sma.magnitude).toBe(700_000);
    expect(payload.orbit.ecc.unit).toBe("1");
  });

  it("follows a LIST of nested shapes, element by element", () => {
    const payload = wrapTopicPayload<{
      bodies: {
        index: number;
        radius: Value;
        atmosphere: { depth: Value };
        orbit: { sma: Value };
      }[];
    }>("system.bodies", {
      bodies: [
        {
          index: 1,
          radius: 600_000,
          atmosphere: { depth: 70_000 },
          orbit: { sma: 13_599_840_256 },
        },
      ],
    });
    const [kerbin] = payload.bodies;

    expect(asValue(kerbin?.radius).static).toBe(true);
    expect(asValue(kerbin?.atmosphere.depth).static).toBe(true);
    expect(asValue(kerbin?.orbit.sma).static).toBeUndefined();
  });

  it("keeps its stamp across the structured-clone hop and through JSON", () => {
    const decoded = wrapTypePayload("BodyEntry", {
      radius: 600_000,
    } as never) as {
      radius: Value;
    };
    const cloned = structuredClone(decoded);
    hydratePayload(cloned);
    const parsed = JSON.parse(JSON.stringify(decoded));
    hydratePayload(parsed);

    expect(cloned.radius.static).toBe(true);
    expect(typeof cloned.radius.plus).toBe("function");
    expect(parsed.radius.static).toBe(true);
  });

  it("is not a stamp arithmetic carries", () => {
    const decoded = wrapTypePayload("BodyEntry", {
      radius: 600_000,
    } as never) as {
      radius: Value<"m">;
    };

    expect(decoded.radius.plus(value("m", 1)).static).toBeUndefined();
  });
});
