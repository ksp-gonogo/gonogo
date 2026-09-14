import type { TopicPayload } from "@ksp-gonogo/sitrep-sdk";
import { Quality, value } from "@ksp-gonogo/sitrep-sdk";
import { describe, expect, it } from "vitest";
import type { KerbalismLifeSupport } from "./__generated__/contract";
import { timeToEmptySeconds } from "./ecosystem";
import {
  RESOURCE_RATE_HORIZON_SECONDS,
  reckonResourceLevels,
  resourceBoundaryCrossings,
} from "./resourceReckoning";

/**
 * Why the Ship Systems countdown is not read off the forward model over
 * `vessel.resources`.
 *
 * The two work off the same amount/rate pair, and the model corrects the level
 * for Kerbalism's own accumulator lag, which `timeToEmptySeconds` does not, so
 * it reads at a glance like the countdown should simply be taken from the
 * reckoned level. The reasons it is not are arithmetic rather than taste, and
 * they are pinned here because a survey of the two files cannot see any of
 * them: this was nominated as a duplication on exactly that reading.
 *
 * 1. **The model's LEVEL is still not a time.** A countdown taken off the
 *    reckoned level divides by the rate itself, and what the division buys is
 *    the staleness correction and nothing else. The model does now publish a
 *    time, but not that one: `resourceBoundaryCrossings` is the moment a level
 *    leaves the range it can occupy, and it is the same division off the same
 *    observed level, so taking it would not move the number. What it would buy
 *    is an ANCHOR (a UT, against seconds from a moment the widget never states)
 *    and the other end of the range, which `timeToEmptySeconds` does not cover
 * 2. **It carries no uncertainty about the rate.** `reckonResourceLevels`
 *    offers no `bandAt`, deliberately and for reasons `resourceReckoning.ts`
 *    sets out at length: the honest interval here is neither a bound nor a
 *    sigma, so there is none. A countdown off it is a point estimate, which is
 *    what the hand-rolled one already is
 * 3. **It withdraws where the widget's countdown keeps counting.** This used to
 *    be the sharpest reason and is now the weakest: the model clamped a crossed
 *    level at its boundary and went on reporting "empty NOW" on a craft whose
 *    last observation saw a full tank. It no longer does. It stops modelling
 *    that level at the crossing and hands back the observation, so what a
 *    consumer gets past the crossing is an absence plus the crossing UT, and
 *    the widget's own number is what still fills the row
 *
 * This argument was first written against `kerbalism.resourceProjection`, a
 * derived channel carrying the same model plus a two-scenario band. That
 * channel is deleted: the reckoner supersedes it, nothing ever read it, and its
 * band never became this model's, so the band arm of the argument went with it
 * and the other two are sharper without it.
 */

const AMOUNTS: TopicPayload<"vessel.resources"> = {
  resources: {
    Food: {
      current: value("units", 100),
      max: value("units", 400),
      active: true,
    },
  },
  meta: { source: "test", quality: Quality.Loaded },
};

/** Food draining at 0.1/s, Kerbalism's accumulators last advanced at UT 1000. */
const LIFE_SUPPORT = {
  asOfUt: value("ut", 1000),
  rates: { Food: value("units/s", -0.1) },
} satisfies KerbalismLifeSupport;

/** What the widget's own countdown is handed: the last OBSERVED levels. */
const STORED = { Food: 100 };

/**
 * The model's answer at one view time, off the pure entry point rather than a
 * store. `reckonResourceLevels` is lifted out of the registration precisely so
 * a caller can inspect what it offers; that the registration elects it is
 * pinned next door in `resourceReckoning.test.ts`.
 */
function modelAt(viewUt: number) {
  const answer = reckonResourceLevels(AMOUNTS, LIFE_SUPPORT, viewUt);
  if ("declined" in answer) {
    throw new Error(`the model declined: ${answer.declined.reason}`);
  }
  return answer;
}

/** A countdown read off the reckoned level, the way a consumer would take it. */
function reckonedCountdown(viewUt: number): number {
  const level = modelAt(viewUt).reckon(viewUt).resources.Food.current.magnitude;
  return level / -LIFE_SUPPORT.rates.Food.magnitude;
}

describe("what the forward model would add to a countdown", () => {
  it("is the staleness correction, and it is the whole of it", () => {
    // 600 s past the accumulator stamp at -0.1/s off 100 units: the level
    // reckons to 40, so the countdown off it is 400 s.
    const handRolled = timeToEmptySeconds("Food", LIFE_SUPPORT, STORED);

    expect(handRolled).toBeCloseTo(1000);
    expect(reckonedCountdown(1600)).toBeCloseTo(
      (handRolled ?? Number.NaN) - 600,
    );
  });

  it("says nothing about the rate, which is the uncertainty a countdown has", () => {
    // The premise this was nominated on is that the modelled path carries
    // uncertainty the hand-rolled one structurally cannot. It carries none:
    // this model offers no band at all, so both paths answer with one number.
    expect(modelAt(1600).bandAt).toBeUndefined();
  });
});

describe("what reading the countdown off the model would cost", () => {
  it("stops modelling inside the horizon rather than reading empty NOW", () => {
    // 100 units at 0.1/s empties 1000 s past the stamp, and the horizon does
    // not reach for another 200 s. So the level leaves its range while the
    // model is still inside the interval it answers over, and it withdraws
    // there rather than pinning at zero. The widget's own countdown runs off
    // the observation and not the view time, so it is unaffected.
    expect(1100).toBeLessThan(RESOURCE_RATE_HORIZON_SECONDS);
    expect(() => reckonedCountdown(1000 + 1100)).toThrow(
      "the model declined: beyond-horizon",
    );
    expect(timeToEmptySeconds("Food", LIFE_SUPPORT, STORED)).toBeCloseTo(1000);
  });

  it("publishes a crossing that is the widget's own division, differently anchored", () => {
    // Reason 1, pinned. The model's time-to-boundary and the widget's
    // countdown are the same arithmetic over the same observed level.
    // Switching would not change the number: what the crossing adds is the
    // anchor Kerbalism measured, and an answer at the other end of the range.
    const crossing = resourceBoundaryCrossings(AMOUNTS, LIFE_SUPPORT)[0];
    if (crossing === undefined) throw new Error("no crossing was published");

    expect(crossing.boundary).toBe("floor");
    expect(crossing.atUt.magnitude - LIFE_SUPPORT.asOfUt.magnitude).toBeCloseTo(
      timeToEmptySeconds("Food", LIFE_SUPPORT, STORED) ?? Number.NaN,
    );
  });

  it("withdraws by name past the horizon rather than answering forever", () => {
    // The behaviour a countdown does want, and the reason this model is worth
    // asking at all even though its level is the wrong thing to divide.
    expect(RESOURCE_RATE_HORIZON_SECONDS).toBe(1200);
    const answer = reckonResourceLevels(AMOUNTS, LIFE_SUPPORT, 1000 + 7200);
    if (!("declined" in answer)) throw new Error("the model answered");

    expect(answer.declined.reason).toBe("beyond-horizon");
    expect(answer.declined.input).toBe("@kerbalism.lifesupport#rates");
  });
});
