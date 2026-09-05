import { describe, expect, it } from "vitest";
import { type CommsDegrade, Quality } from "./__generated__/contract";
import { degradeRating, degradeRatingOf } from "./comms-degrade";
import type { Reading } from "./reading";
import { value } from "./unit-system/value";

/**
 * A payload built the way the wire hydrates one: a real `Value` on the rating,
 * a real `Quality` on the meta, and no assertion anywhere. The generated type is
 * the whole shape, so anything this file can construct is something the mod can
 * actually send, and a field that changed shape would fail here at compile time
 * rather than being cast past.
 */
const payloadOf = (
  level: number | undefined,
  modelId = "some-rule",
): CommsDegrade => ({
  modelId,
  modelName: "Some rule",
  level: level === undefined ? undefined : value("ratio", level),
  meta: { source: "vessel:abc", quality: Quality.Loaded },
});

/**
 * The client half of the `comms.degrade` promise: a rating a consumer can act
 * on, or nothing, with no third state and no substituted number.
 *
 * <p>The failure these replicate is what the camera feed does today over
 * `comms.signalStrength`: a bare 0..1 with no way to say "nobody measured
 * this", read as `1 - value`. When the value never arrives the feed keeps
 * whatever degrade it had, and when it arrives as a zero from a backend that
 * could not grade, the feed blacks out a picture that is arriving perfectly.
 * Every case below is one of those confusions made unrepresentable.</p>
 */
describe("degradeRatingOf: the payload read", () => {
  const payload = payloadOf;

  it("distinguishes a refusal to grade from a graded zero", () => {
    // The pair the whole design exists for. Both are legitimate answers from a
    // real install, and they are opposite instructions to a feed.
    const refused = degradeRatingOf(payload(undefined, "unknown"));
    const pristine = degradeRatingOf(payload(0));

    expect(refused).toBeUndefined();
    expect(pristine).toEqual({
      level: 0,
      modelId: "some-rule",
      modelName: "Some rule",
    });
  });

  it("carries whichever rule graded it alongside the number", () => {
    // Not decoration: two backends grade by different physics, so a consumer
    // acting on 0.4 is entitled to know which 0.4 it is. The ids here are
    // deliberately NOT a shipped backend's: what is under test is that the id
    // arrives unchanged whatever it is, and naming a real one would make an SDK
    // test read as though the SDK knew that backend.
    expect(degradeRatingOf(payload(0.4, "rule-a"))?.modelId).toBe("rule-a");
    expect(degradeRatingOf(payload(0.4, "rule-b"))?.modelId).toBe("rule-b");
  });

  it("clamps a finite rating that arrived outside the scale", () => {
    // A client can be talking to an older or third-party build, so the 0..1
    // promise is kept again here rather than trusted.
    expect(degradeRatingOf(payload(1.4))?.level).toBe(1);
    expect(degradeRatingOf(payload(-0.25))?.level).toBe(0);

    // The boundaries are in range and untouched, which is what makes it a
    // clamp rather than an exclusion.
    expect(degradeRatingOf(payload(0))?.level).toBe(0);
    expect(degradeRatingOf(payload(1))?.level).toBe(1);
    expect(degradeRatingOf(payload(0.5))?.level).toBe(0.5);
  });

  it("treats a non-finite rating as ungraded rather than clamping it", () => {
    /*
     * Asymmetric with the clamp above, and deliberately: a NaN is arithmetic
     * that did not run, so there is no end it overshot, and a NaN that survived
     * would fail every comparison silently and read as "not degraded".
     */
    for (const bad of [
      Number.NaN,
      Number.POSITIVE_INFINITY,
      Number.NEGATIVE_INFINITY,
    ]) {
      expect(degradeRatingOf(payload(bad))).toBeUndefined();
    }
  });

  it("answers nothing for a payload that never arrived", () => {
    expect(degradeRatingOf(undefined)).toBeUndefined();
  });
});

describe("degradeRating: the reading read", () => {
  const graded = payloadOf(0.7, "some-rule");

  it("returns nothing while no rating has arrived", () => {
    // Three distinct reasons to have no rating, one answer, because a consumer
    // has the same thing to do about all three: keep doing what it was doing.
    const pending: Reading<CommsDegrade> = { state: "pending" };
    const unowned: Reading<CommsDegrade> = { state: "unowned" };
    const absent: Reading<CommsDegrade> = {
      state: "absent",
      atUt: value("ut", 100),
    };

    expect(degradeRating(pending)).toBeUndefined();
    expect(degradeRating(unowned)).toBeUndefined();
    expect(degradeRating(absent)).toBeUndefined();
  });

  it("returns the rating for an observed reading", () => {
    const reading: Reading<CommsDegrade> = {
      state: "observed",
      value: graded,
      atUt: value("ut", 100),
    };

    expect(degradeRating(reading)?.level).toBe(0.7);
  });

  it("still returns a STALE rating rather than dropping it", () => {
    // Deliberate, and the one judgement call in this file. A grading held
    // through an outage is the last thing anyone knows about the link, and
    // dropping it leaves a feed with no quality at exactly the moment quality
    // matters. What says the link is DOWN is comms.link, not this.
    const reading: Reading<CommsDegrade> = {
      state: "stale",
      value: graded,
      asOfUt: value("ut", 100),
      grade: "last-before-blackout",
    };

    expect(degradeRating(reading)?.level).toBe(0.7);
  });
});
