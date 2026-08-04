import { describe, expect, it } from "vitest";
import {
  GENERATED_TOPIC_SHAPES,
  GENERATED_TOPIC_UNITS,
  GENERATED_TYPE_SHAPES,
  GENERATED_TYPE_UNITS,
} from "./__generated__/units";
import descriptor from "./__generated__/units.json" with { type: "json" };
import { getAllKnownTopicIds, isTopicId, type TopicPayloadMap } from "./topics";

/**
 * `units.json` and `units.ts` come out of ONE reflection pass, and this is
 * what keeps that true.
 *
 * The JSON exists because every other piece of unit knowledge in this design
 * is a TypeScript artifact and none of it survives the wire: a consumer in
 * another language receives `{"heatShieldFlux": 3400.0}` with no way to learn
 * it is kilowatts. So the map is emitted a second time as data, for a
 * generator in another language, for a test that wants the contract without
 * importing the SDK, and for the mod to serve beside the telemetry socket.
 *
 * Two outputs of one pass is exactly the arrangement that drifts, though: a
 * later change to the TS emitter that misses the JSON one produces a
 * descriptor that is quietly a version behind, and the consumers who need it
 * most are the ones least able to notice. Comparing them field-for-field is
 * cheap and catches that at the moment it happens.
 */
describe("the unit descriptor matches the generated TypeScript", () => {
  it("carries the same units per type", () => {
    expect(descriptor.types).toEqual(GENERATED_TYPE_UNITS);
  });

  it("carries the same units per topic", () => {
    expect(descriptor.topics).toEqual(GENERATED_TOPIC_UNITS);
  });

  it("carries the same nested shapes per type", () => {
    expect(descriptor.typeShapes).toEqual(GENERATED_TYPE_SHAPES);
  });

  it("carries the same nested shapes per topic", () => {
    expect(descriptor.topicShapes).toEqual(GENERATED_TOPIC_SHAPES);
  });

  it("lists every token the maps actually use in its vocabulary", () => {
    // The vocabulary is the closed first-party catalog (`Sitrep.Contract
    // .Units`), and the codegen already refuses a token outside it. This
    // asserts the other direction: that the catalog the descriptor PUBLISHES
    // covers what the descriptor USES, so a consumer can resolve every unit
    // it will actually meet from this one document.
    const used = new Set<string>();
    for (const fields of Object.values(descriptor.topics)) {
      for (const unit of Object.values(fields)) used.add(unit);
    }
    for (const fields of Object.values(descriptor.types)) {
      for (const unit of Object.values(fields)) used.add(unit);
    }
    const vocabulary = new Set(descriptor.vocabulary);
    expect([...used].filter((u) => !vocabulary.has(u))).toEqual([]);
  });
});

describe("system.units: the stream describing its own units", () => {
  it("is a Topic a consumer can subscribe to", () => {
    // The mod reflects the descriptor off Sitrep.Contract at startup and
    // serves it here. A TypeScript consumer does not need it (the generated
    // maps and the decode-time wrap already give it `Value`s); it exists so
    // that anyone else who can reach the stream can reach its units.
    expect(isTopicId("system.units")).toBe(true);
    expect(getAllKnownTopicIds()).toContain("system.units");
  });

  it("carries the document this package ships, as JSON text", () => {
    // The payload is a STRING, not a structured shape: the document describes
    // this contract's own types, so a contract type for it would sit inside
    // the thing it describes. Round-tripping the committed file through
    // JSON.parse is what a non-TypeScript consumer does with the wire value.
    const overWire: TopicPayloadMap["system.units"] =
      JSON.stringify(descriptor);
    expect(JSON.parse(overWire)).toEqual(descriptor);
  });
});
