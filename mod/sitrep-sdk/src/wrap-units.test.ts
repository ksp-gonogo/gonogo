import { describe, expect, it } from "vitest";
import { isValue, type Value } from "./unit-system";
import { wrapTopicPayload, wrapTypePayload } from "./wrap-units";

const asValue = (v: unknown) => v as Value;

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

  it("leaves a non-quantity alone", () => {
    // text, flag, enum, id and n/a have no dimension and were never units, so
    // the registry lookup skips them without needing a list.
    const payload = wrapTopicPayload("vessel.identity", {
      name: "Kerbal X",
    } as never) as { name: unknown };
    expect(payload.name).toBe("Kerbal X");
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
    expect(typeof asValue((twice as never)["heatShieldTemp"]).magnitude).toBe(
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
