import { describe, expect, it } from "vitest";
import type { TopicId } from "./topics";
import { isValue, type Value, value } from "./unit-system";
import { registerTopicUnits } from "./units";
import {
  hydratePayload,
  wrapTopicPayload,
  wrapTypePayload,
} from "./wrap-units";

const asValue = (v: unknown) => v as Value;

// A name-keyed map of same-unit readings, registered rather than named out of
// this assembly's generated map.
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
    // The key is a resource name and must survive untouched: it is data, not a
    // property name, so nothing may camel-case it.
    expect(Object.keys(payload.rates)).toContain("ElectricCharge");
    // A present ZERO is a real reading (in balance), not an absence.
    expect(asValue(payload.rates.Nitrogen).magnitude).toBe(0);
  });

  it("wrapping a map twice leaves it alone", () => {
    // Same idempotence the scalar and list cases have, and for the same
    // reason: a payload can be re-decoded on reconnect.
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
    // text, flag, enum, id and n/a have no dimension and were never units, so
    // the registry lookup skips them without needing a list.
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
    const payload = wrapTopicPayload("system.bodies", {
      bodies: [{ radius: 600_000 }, { radius: 200_000 }],
    } as never) as { bodies: Array<{ radius: Value }> };
    expect(payload.bodies.map((b) => b.radius.unit)).toEqual(["m", "m"]);
    expect(payload.bodies[1].radius.magnitude).toBe(200_000);
  });

  it("follows a MAP of nested shapes, value by value", () => {
    // `VesselPart.resources` is keyed by resource name. Treating the map
    // itself as one payload looked for `amount` on the map, found nothing,
    // and left every per-part flow bare.
    const payload = wrapTopicPayload("vessel.parts", {
      parts: [{ resources: { ElectricCharge: { amount: 120, flow: -0.5 } } }],
    } as never) as {
      parts: Array<{ resources: Record<string, { amount: Value }> }>;
    };
    const ec = payload.parts[0].resources.ElectricCharge;
    expect(ec.amount.unit).toBe("units");
    expect(ec.amount.magnitude).toBe(120);
  });

  it("puts the unit inside a sequence of readings", () => {
    // A terrain profile is a list of distances, not one distance.
    const payload = wrapTopicPayload("vessel.landing", {
      terrainPatch: [120, 140, 160],
    } as never) as { terrainPatch: Value[] };
    expect(payload.terrainPatch.every(isValue)).toBe(true);
    expect(payload.terrainPatch[1].unit).toBe("m");
  });

  it("carries a Vec3's unit onto its leaves", () => {
    // The unit is declared on the PARENT, because one canonical Vec3 shape is
    // reused at sites carrying three different units. The map propagates it
    // onto dotted leaf keys, and this is the runtime side of Vec3Of.
    const payload = wrapTypePayload("DockAlignment", {
      relativePosition: { x: 1, y: 2, z: 3 },
      relativeVelocity: { x: 0.4, y: 0, z: 0 },
    }) as {
      relativePosition: { x: Value; y: Value; z: Value };
      relativeVelocity: { x: Value };
    };
    expect(payload.relativePosition.x.unit).toBe("m");
    expect(payload.relativePosition.z.magnitude).toBe(3);
    expect(payload.relativeVelocity.x.unit).toBe("m/s");
  });

  it("survives an absent optional field", () => {
    const payload = wrapTopicPayload("vessel.thermal", {} as never) as Record<
      string,
      unknown
    >;
    expect(payload.heatShieldTemp).toBeUndefined();
  });

  it("is idempotent, because a payload can be decoded twice", () => {
    // A reconnect re-decodes. Wrapping an already-wrapped value must not
    // produce a Value whose magnitude is a Value.
    const once = wrapTopicPayload("vessel.thermal", {
      heatShieldTemp: 1_200,
    } as never);
    const twice = wrapTopicPayload("vessel.thermal", once);
    expect(typeof asValue((twice as never).heatShieldTemp).magnitude).toBe(
      "number",
    );
  });

  it("wraps every element of an array topic", () => {
    // An array Topic's unit entry describes the ELEMENT's fields, which is
    // what a consumer indexes into.
    const payload = wrapTypePayload("ResourceAmount", [
      { current: 100, max: 200, active: true },
      { current: 50, max: 200, active: false },
    ]) as Array<{ current: Value; active: unknown }>;
    expect(payload.every((entry) => isValue(entry.current))).toBe(true);
    // And the flag beside them is left alone.
    expect(payload[0].active).toBe(true);
  });

  it("passes a non-object through untouched", () => {
    expect(wrapTopicPayload("vessel.thermal", null as never)).toBe(null);
    expect(wrapTopicPayload("vessel.thermal", 42 as never)).toBe(42);
  });
});

describe("allocation cost", () => {
  it("stays proportional to the declared fields, not the payload", () => {
    // One object per wrapped scalar per sample. The design flagged this as
    // worth measuring before committing, so here is the shape of it: the count
    // is exactly the number of DECLARED quantity fields present, which means a
    // topic's cost is knowable from the contract rather than from traffic.
    let allocations = 0;
    const sample = { heatShieldTemp: 1_200, heatShieldFlux: 3_400 };
    for (const key of Object.keys(sample)) {
      const wrapped = wrapTopicPayload("vessel.thermal", {
        ...sample,
      } as never) as Record<string, unknown>;
      if (isValue(wrapped[key])) allocations++;
    }
    expect(allocations).toBe(2);
  });
});

describe("a hand-declared Topic whose payload is a reflected contract type", () => {
  it("wraps system.uplink.pending's entries", () => {
    // `ChannelEngine` declares this channel, not any one Uplink's contract, so
    // the generated maps are keyed by a `[SitrepTopic]` that does not exist
    // for it. The type says `Value<"s">` either way, and before the
    // hand-declared fallback the runtime handed a bare number: the in-transit
    // strip read raw seconds and pointed its arrow the wrong way.
    const payload = {
      pending: [
        {
          id: "r1",
          command: "vessel.control.setThrottle",
          label: "throttle up",
          topic: "vessel.control",
          vantage: "ksc",
          dispatchedAt: 100,
          oneWaySeconds: 4,
        },
      ],
    };
    wrapTopicPayload("system.uplink.pending", payload);
    // The two time fields on one entry carry DIFFERENT time units, which is
    // the whole point of the split: `dispatchedAt` is the instant the command
    // left, `oneWaySeconds` is how long the trip takes.
    expect(payload.pending[0].dispatchedAt).toEqual(value("ut", 100));
    expect(payload.pending[0].oneWaySeconds).toEqual(value("s", 4));
    // Not a quantity, and not touched.
    expect(payload.pending[0].command).toBe("vessel.control.setThrottle");
  });
});

describe("hydratePayload: the structured-clone hop", () => {
  it("gives a cloned quantity its methods back", () => {
    // What PeerJS delivers to a station: the two fields, no prototype.
    const cloned = structuredClone({
      signalStrength: value("ratio", 0.25),
      vesselName: "Jeb's Ride",
      nested: { altitude: value("m", 1200) },
      list: [value("m/s", 5)],
    });
    expect(isValue(cloned.signalStrength)).toBe(true);
    expect(typeof (cloned.signalStrength as Value).lessThanOrEqual).not.toBe(
      "function",
    );

    hydratePayload(cloned);

    expect(cloned.signalStrength.lessThanOrEqual(value("ratio", 1))).toBe(true);
    expect(cloned.nested.altitude.magnitude).toBe(1200);
    expect(typeof cloned.nested.altitude.plus).toBe("function");
    expect(typeof cloned.list[0].plus).toBe("function");
    // Not a quantity, and not touched.
    expect(cloned.vesselName).toBe("Jeb's Ride");
  });

  it("is idempotent and leaves a live value alone", () => {
    const live = { altitude: value("m", 10) };
    const before = live.altitude;
    hydratePayload(live);
    expect(live.altitude).toBe(before);
  });
});
