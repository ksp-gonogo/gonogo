import { describe, expect, it } from "vitest";
import { splitRawFieldSubtopic } from "./raw-field-split";
import { registerDynamicTopicPrefix } from "./runtime-topic-registry";
import { registerBarePrimitiveTopic } from "./topics";

describe("splitRawFieldSubtopic", () => {
  it("leaves a whole Topic whole, at two segments or at three", () => {
    expect(splitRawFieldSubtopic("vessel.orbit")).toBeUndefined();
    expect(splitRawFieldSubtopic("alarm.scet.fired")).toBeUndefined();
    expect(splitRawFieldSubtopic("vessel.orbit.truth")).toBeUndefined();
    expect(splitRawFieldSubtopic("system.uplink.pending")).toBeUndefined();
  });

  it("splits a field path off the longest Topic id the key starts with", () => {
    expect(splitRawFieldSubtopic("vessel.orbit.sma")).toEqual({
      rawTopic: "vessel.orbit",
      fieldPath: ["sma"],
    });
    // Both `alarm.scet` and `alarm.scet.fired` are Topics; the longer one wins, which is the whole point: `alarm.scet` is an array with no `fired` field.
    expect(splitRawFieldSubtopic("alarm.scet.fired.firedAtUt")).toEqual({
      rawTopic: "alarm.scet.fired",
      fieldPath: ["firedAtUt"],
    });
    expect(splitRawFieldSubtopic("vessel.orbit.truth.position.x")).toEqual({
      rawTopic: "vessel.orbit.truth",
      fieldPath: ["position", "x"],
    });
  });

  it("walks a nested path in one go rather than resolving twice", () => {
    expect(
      splitRawFieldSubtopic("vessel.thermal.hottestPart.skinTemp"),
    ).toEqual({
      rawTopic: "vessel.thermal",
      fieldPath: ["hottestPart", "skinTemp"],
    });
  });

  it("falls back to the domain.channel split for a Topic this build never heard of", () => {
    /* An Uplink Topic, a synthetic test topic, a legacy flat key: none is in a
       generated list, and answering `undefined` for them would stop every one
       of their field reads resolving. */
    expect(splitRawFieldSubtopic("made.up.field")).toEqual({
      rawTopic: "made.up",
      fieldPath: ["field"],
    });
    expect(splitRawFieldSubtopic("made.up.nested.field")).toEqual({
      rawTopic: "made.up",
      fieldPath: ["nested", "field"],
    });
  });

  it("leaves a three-segment Topic a client package registered whole, and splits its fields off it", () => {
    registerBarePrimitiveTopic("planted.reliability.parts");
    expect(splitRawFieldSubtopic("planted.reliability.parts")).toBeUndefined();
    expect(splitRawFieldSubtopic("planted.reliability.parts.worst")).toEqual({
      rawTopic: "planted.reliability.parts",
      fieldPath: ["worst"],
    });
  });

  it("still splits a field off a fixed Topic that sits under a dynamic prefix", () => {
    expect(splitRawFieldSubtopic("fleet.silence.state")).toEqual({
      rawTopic: "fleet.silence",
      fieldPath: ["state"],
    });
    expect(splitRawFieldSubtopic("fleet.abc123.orbit")).toBeUndefined();
  });

  it("leaves every Topic under a registered dynamic prefix whole", () => {
    registerDynamicTopicPrefix("planted.forecast.");
    expect(splitRawFieldSubtopic("planted.forecast.250000")).toBeUndefined();
    expect(splitRawFieldSubtopic("planted.forecast.Kerbin.1")).toBeUndefined();
  });

  it("refuses a registration that would re-split a key already read", () => {
    expect(splitRawFieldSubtopic("planted.late.figure")).toEqual({
      rawTopic: "planted.late",
      fieldPath: ["figure"],
    });
    expect(() => registerBarePrimitiveTopic("planted.late.figure")).toThrow(
      /registered after "planted\.late\.figure" had already been read as a field of "planted\.late"/,
    );
    expect(() => registerDynamicTopicPrefix("planted.late.")).toThrow(
      /already been read/,
    );
  });

  it("accepts a registration that leaves every key already read where it was", () => {
    splitRawFieldSubtopic("planted.settled.a.b");
    expect(() => registerBarePrimitiveTopic("planted.settled")).not.toThrow();
    expect(() =>
      registerDynamicTopicPrefix("planted.elsewhere."),
    ).not.toThrow();
  });

  it.each([
    "planted.forecast",
    "planted.",
    "planted..forecast.",
    ".planted.forecast.",
  ])("refuses %j as a dynamic prefix", (prefix) => {
    expect(() => registerDynamicTopicPrefix(prefix)).toThrow(
      /at least two segments ending in "\."/,
    );
  });
});
