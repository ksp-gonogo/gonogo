import { describe, expect, it } from "vitest";
import {
  DEFAULT_RAIL_TAGS,
  type RailContinuity,
  type RailDelivery,
  type RailDirection,
  type RailTags,
  railDrawsReturnLeg,
  railFlow,
  railMark,
  railTagsOf,
  railToneToken,
  VOICE_RAIL_TAGS,
} from "./railTags";

const DIRECTIONS: RailDirection[] = ["command", "telemetry"];
const CONTINUITIES: RailContinuity[] = ["discrete", "continuous"];
const DELIVERIES: RailDelivery[] = ["acked", "fire-and-forget"];

function everyCombination(): RailTags[] {
  const out: RailTags[] = [];
  for (const direction of DIRECTIONS)
    for (const continuity of CONTINUITIES)
      for (const delivery of DELIVERIES)
        out.push({ direction, continuity, delivery });
  return out;
}

describe("railTagsOf", () => {
  it("gives an untagged handle the assumption the rail used to bake in", () => {
    expect(railTagsOf({})).toEqual({
      direction: "command",
      continuity: "discrete",
      delivery: "acked",
    });
    expect(railTagsOf({ shape: "discrete" })).toEqual(DEFAULT_RAIL_TAGS);
  });

  /*
   * The row most easily got wrong, and the reason this file exists: a stream
   * command's ack is the confirmed readback, and its deviance is expected
   * against actual. `ControlDelayStream` has drawn that since it shipped.
   */
  it("keeps a CONTINUOUS command ACKED", () => {
    expect(railTagsOf({ shape: "stream" })).toEqual({
      direction: "command",
      continuity: "continuous",
      delivery: "acked",
    });
    expect(railDrawsReturnLeg(railTagsOf({ shape: "stream" }))).toBe(true);
  });

  it("moves only the continuity axis for a stream shape", () => {
    const streamed = railTagsOf({ shape: "stream" });
    expect(streamed.direction).toBe(DEFAULT_RAIL_TAGS.direction);
    expect(streamed.delivery).toBe(DEFAULT_RAIL_TAGS.delivery);
  });

  it("lets an entry state one axis without restating the rest", () => {
    expect(railTagsOf({ tags: { direction: "telemetry" } })).toEqual({
      direction: "telemetry",
      continuity: "discrete",
      delivery: "acked",
    });
  });

  it("lets an explicit tag win over the shape it was derived from", () => {
    expect(
      railTagsOf({ shape: "stream", tags: { continuity: "discrete" } })
        .continuity,
    ).toBe("discrete");
  });

  it("tags the operator's voice telemetry, continuous, fire-and-forget", () => {
    expect(railTagsOf({ tags: VOICE_RAIL_TAGS })).toEqual(VOICE_RAIL_TAGS);
    expect(railMark(VOICE_RAIL_TAGS)).toBe("ribbon");
    expect(railDrawsReturnLeg(VOICE_RAIL_TAGS)).toBe(false);
    expect(railFlow(VOICE_RAIL_TAGS)).toBe("inbound");
  });
});

/**
 * The claim the model rests on: each accessor reads ONE axis. An accessor that
 * quietly started consulting a second would be a special case wearing the
 * vocabulary of a model, and every combination would stop composing.
 *
 * Checked by holding one axis and sweeping the other two: if the answer moves
 * while the axis it names is fixed, something else is being read.
 */
describe("each axis drives exactly one visual property", () => {
  const cases = [
    { axis: "continuity" as const, read: railMark },
    { axis: "delivery" as const, read: railDrawsReturnLeg },
    { axis: "direction" as const, read: railFlow },
    { axis: "direction" as const, read: railToneToken },
  ];

  for (const { axis, read } of cases) {
    it(`${read.name} reads ${axis} and nothing else`, () => {
      const byAxisValue = new Map<string, unknown>();
      for (const tags of everyCombination()) {
        const key = tags[axis];
        const answer = read(tags);
        if (byAxisValue.has(key)) {
          expect(byAxisValue.get(key)).toEqual(answer);
        } else {
          byAxisValue.set(key, answer);
        }
      }
      // And it must actually DISCRIMINATE on that axis: an accessor returning
      // one constant would satisfy the loop above while reading nothing.
      expect(new Set(Array.from(byAxisValue.values())).size).toBe(2);
    });
  }
});
