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
      for (const tags of allRailTags()) {
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
 * The renderer table, asked the question that is worth asking of it: not "do
 * the four rows we know about work" but "which of the eight can nothing draw".
 *
 * A test that checked the known rows would pass forever while a declarable
 * combination silently rendered nothing, which is the failure this whole
 * vocabulary exists to make visible. So the assertion is on the WHOLE gap: the
 * unrepresented set is named exactly, and adding a renderer or a new axis value
 * fails here until the list is updated deliberately.
 */
describe("which combinations have a renderer", () => {
  /**
   * The three the rail can draw today, and the one renderer each maps to. Named
   * rather than derived from the table, so this is an independent statement of
   * the same fact and not a copy of it agreeing with itself.
   */
  const DRAWN: ReadonlyArray<[RailTagKey, RailRenderer]> = [
    ["command/discrete/acked", "in-flight-row"],
    ["command/continuous/acked", "continuous-strip"],
    ["telemetry/continuous/fire-and-forget", "continuous-strip"],
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

  /*
   * The five nothing draws, named so the gap is a fact on the record rather
   * than an accident. Four of them are combinations no producer can currently
   * make either: `Sitrep.Contract/CommandResult.cs` rules that a command's
   * result is always delivered, so `command/*​/fire-and-forget` has no way to
   * arise, and telemetry has no reply channel at all, so
   * `telemetry/*​/acked` has none either.
   *
   * The FIFTH is the one that matters, and it is the fourth row of the table in
   * `railTags.ts`: `telemetry/discrete/fire-and-forget`, a science result sent
   * home. That is declarable today (`railTagsForTelemetry("discrete")` returns
   * exactly it) and nothing draws it. That is deliberate: the arrival rail it
   * would need is separately queued work, and until it exists an entry carrying
   * these tags is reported and marked rather than quietly missing.
   */
  const UNDRAWN: readonly RailTagKey[] = [
    "command/discrete/fire-and-forget",
    "command/continuous/fire-and-forget",
    "telemetry/discrete/acked",
    "telemetry/discrete/fire-and-forget",
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

  it("answers null rather than a fallback renderer for an undrawn row", () => {
    const scienceHome: RailTags = {
      direction: "telemetry",
      continuity: "discrete",
      delivery: "fire-and-forget",
    };
    // Emphatically not `in-flight-row`. Falling back to the discrete queue is
    // what the rail did before the axes had names, and it drew the entry as a
    // discrete acked command: wrong in a way that looks right.
    expect(railRendererFor(scienceHome)).toBeNull();
  });
});
