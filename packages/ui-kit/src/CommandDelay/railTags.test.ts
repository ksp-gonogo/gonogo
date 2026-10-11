import { describe, expect, it } from "vitest";
import {
  allRailTags,
  type RailContinuity,
  type RailDelivery,
  type RailDirection,
  type RailRenderer,
  type RailTagKey,
  type RailTags,
  railDrawsReturnLeg,
  railFlow,
  railMark,
  railRendererFor,
  railTagKey,
  railToneToken,
  unrepresentedRailTags,
} from "./railTags";

/**
 * Each accessor reads ONE axis. Checked by holding one axis and sweeping the
 * other two: if the answer moves, something else is being read.
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
      for (const tags of allRailTags()) {
        const key = tags[axis];
        const answer = read(tags);
        if (byAxisValue.has(key)) {
          expect(byAxisValue.get(key)).toEqual(answer);
        } else {
          byAxisValue.set(key, answer);
        }
      }
      // It must also DISCRIMINATE, since a constant would satisfy the loop above.
      expect(new Set(Array.from(byAxisValue.values())).size).toBe(2);
    });
  }
});

describe("the axis product", () => {
  it("enumerates every combination of the three axes, once each", () => {
    const all = allRailTags();
    expect(all).toHaveLength(8);
    expect(new Set(all.map(railTagKey)).size).toBe(8);
  });

  it("spells a combination the way the renderer table is keyed", () => {
    expect(
      railTagKey({
        direction: "telemetry",
        continuity: "continuous",
        delivery: "fire-and-forget",
      }),
    ).toBe("telemetry/continuous/fire-and-forget");
  });
});

/**
 * The renderer table, asserted on the WHOLE gap: the unrepresented set is named
 * exactly, so adding a renderer or an axis value fails here until the list is
 * updated deliberately.
 */
describe("which combinations have a renderer", () => {
  // Named rather than derived from the table, so it is an independent statement of the same fact.
  const DRAWN: ReadonlyArray<[RailTagKey, RailRenderer]> = [
    ["command/discrete/acked", "in-flight-row"],
    ["command/continuous/acked", "continuous-strip"],
    ["telemetry/continuous/fire-and-forget", "continuous-strip"],
    ["telemetry/discrete/fire-and-forget", "in-flight-row"],
  ];

  for (const [key, renderer] of DRAWN) {
    it(`draws ${key} with ${renderer}`, () => {
      const [direction, continuity, delivery] = key.split("/");
      expect(
        railRendererFor({
          direction: direction as RailDirection,
          continuity: continuity as RailContinuity,
          delivery: delivery as RailDelivery,
        }),
      ).toBe(renderer);
    });
  }

  // The four nothing draws, and no producer can make: a command's result is always delivered, and telemetry has no reply channel.
  const UNDRAWN: readonly RailTagKey[] = [
    "command/discrete/fire-and-forget",
    "command/continuous/fire-and-forget",
    "telemetry/discrete/acked",
    "telemetry/continuous/acked",
  ];

  it("names exactly the combinations nothing draws", () => {
    expect(unrepresentedRailTags().map(railTagKey).sort()).toEqual(
      [...UNDRAWN].sort(),
    );
  });

  it("accounts for all eight combinations either way", () => {
    expect(DRAWN.length + UNDRAWN.length).toBe(allRailTags().length);
  });

  it("draws a science result sent home in the same queue a command's row is in", () => {
    const scienceHome: RailTags = {
      direction: "telemetry",
      continuity: "discrete",
      delivery: "fire-and-forget",
    };
    expect(railRendererFor(scienceHome)).toBe(
      railRendererFor({
        ...scienceHome,
        direction: "command",
        delivery: "acked",
      }),
    );
  });

  it("answers null rather than a fallback renderer for an undrawn row", () => {
    // Not `in-flight-row`: a discrete-queue fallback would look right and be wrong.
    expect(
      railRendererFor({
        direction: "telemetry",
        continuity: "discrete",
        delivery: "acked",
      }),
    ).toBeNull();
  });
});
