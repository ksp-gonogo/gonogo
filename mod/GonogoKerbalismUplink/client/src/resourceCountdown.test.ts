import type { TopicPayload } from "@ksp-gonogo/sitrep-sdk";
import { Quality, value } from "@ksp-gonogo/sitrep-sdk";
import { describe, expect, it } from "vitest";
import type { KerbalismLifeSupport } from "./__generated__/contract";
import { timeToEmptySeconds } from "./ecosystem";
import {
  RESOURCE_RATE_HORIZON_SECONDS,
  reckonResourceLevels,
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
 * 1. **The model advances a LEVEL, never a time.** There is no time-to-empty on
 *    this wire or anywhere else in the tree, so any consumer of it still
 *    divides by the rate itself, and what the division buys is the staleness
 *    correction and nothing else
 * 2. **It carries no uncertainty about the rate.** `reckonResourceLevels`
 *    offers no `bandAt`, deliberately and for reasons `resourceReckoning.ts`
 *    sets out at length: the honest interval here is neither a bound nor a
 *    sigma, so there is none. A countdown off it is a point estimate, which is
 *    what the hand-rolled one already is
 * 3. **The clamp at zero still says "empty NOW", and the horizon only bounds
 *    how long it can say it.** A level that reaches its floor inside the
 *    horizon reckons as zero, and a countdown off zero is the flat claim that
 *    the craft is out. Past the horizon the model withdraws BY NAME instead,
 *    which is the one thing a countdown genuinely gains from it, and the
 *    reason the withdrawal is worth having where the level is not
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
  it("hits zero inside the horizon and reads empty NOW from there", () => {
    // 100 units at 0.1/s empties 1000 s past the stamp, and the horizon does
    // not reach for another 200 s, so the clamp bites while the model is still
    // answering. The craft has a full tank as far as the last observation
    // knows, and a countdown off the reckoned level says it is out.
    expect(1100).toBeLessThan(RESOURCE_RATE_HORIZON_SECONDS);
    expect(reckonedCountdown(1000 + 1100)).toBe(0);
    expect(timeToEmptySeconds("Food", LIFE_SUPPORT, STORED)).toBeCloseTo(1000);
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
