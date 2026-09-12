import { describe, expect, it } from "vitest";
import { splitRawFieldSubtopic } from "./raw-field-split";

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
    // Both `alarm.scet` and `alarm.scet.fired` are Topics; the longer one wins,
    // which is the whole point: `alarm.scet` is an array with no `fired` field.
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
});
