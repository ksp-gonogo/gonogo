import type { TopicPayload } from "@ksp-gonogo/sitrep-sdk";
import { Quality, value } from "@ksp-gonogo/sitrep-sdk";
import type { StreamFixture } from "@ksp-gonogo/sitrep-sdk/testing";
import { makeMeta, setupStreamFixture } from "@ksp-gonogo/sitrep-sdk/testing";
import { describe, expect, it } from "vitest";
import type { KerbalismLifeSupport } from "./__generated__/contract";
import { timeToEmptySeconds } from "./ecosystem";
import {
  KERBALISM_RESOURCE_PROJECTION_TOPIC,
  type KerbalismResourceProjection,
  kerbalismResourceProjectionChannel,
} from "./resourceProjection";
import {
  RESOURCE_RATE_HORIZON_SECONDS,
  reckonResourceLevels,
} from "./resourceReckoning";

/**
 * Why the Ship Systems countdown is not read off `kerbalism.resourceProjection`.
 *
 * The two work off the same amount/rate pair, and the projection carries a band
 * and an `asOfUt` correction that `timeToEmptySeconds` has neither of, so it
 * reads at a glance like the countdown should simply be taken from the modelled
 * channel. The three reasons it is not are arithmetic rather than taste, and
 * they are pinned here because a survey of the two files cannot see any of
 * them: this was nominated as a duplication on exactly that reading.
 *
 * 1. **The channel models a LEVEL, never a time.** There is no time-to-empty on
 *    this wire or anywhere else in the tree, so any consumer of it still
 *    divides by the rate itself
 * 2. **The band does not survive that division.** `lower`/`upper` bracket the
 *    level at the two named scenarios, and their width is `|rate| * elapsed`
 *    by construction, so dividing by the same `rate` gives a countdown bracket
 *    exactly `elapsed` seconds wide whatever the rate is. It expresses the
 *    staleness correction a second time and says nothing at all about how much
 *    the rate itself might be wrong, which is the uncertainty a countdown
 *    actually has
 * 3. **The channel imposes no horizon, deliberately, and a countdown is where
 *    that stops being safe.** A level that decays continuously is honest about
 *    itself through a widening band; a countdown clamps to zero at the crossing
 *    and then reads "empty" forever. The withdrawal for that lives on the
 *    reckoner over `vessel.resources`, not here (see `resourceReckoning.ts`)
 */

const CARRIED = [
  "vessel.resources",
  "kerbalism.lifesupport",
  KERBALISM_RESOURCE_PROJECTION_TOPIC,
];

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

function ingest(fixture: StreamFixture, topic: string, payload: unknown) {
  fixture.store.ingest(topic, {
    validAt: 1000,
    payload,
    meta: makeMeta({ validAt: 1000, deliveredAt: 1000 }),
    epoch: 0,
  });
}

/**
 * The projected Food record at one view time, off a real store rather than a
 * direct call, so the registration and the frame's frozen view time are part of
 * what is being pinned.
 */
function foodAt(
  viewUt: number,
  lifeSupport: KerbalismLifeSupport = LIFE_SUPPORT,
): KerbalismResourceProjection {
  const fixture = setupStreamFixture({
    carriedChannels: CARRIED,
    pinnedUt: viewUt,
  });
  fixture.store.registerDerivedChannel(kerbalismResourceProjectionChannel);
  ingest(fixture, "vessel.resources", AMOUNTS);
  ingest(fixture, "kerbalism.lifesupport", lifeSupport);
  fixture.store.beginFrame();
  const food = fixture.store
    .sample<{ resources: KerbalismResourceProjection[] }>(
      KERBALISM_RESOURCE_PROJECTION_TOPIC,
    )
    ?.payload?.resources.find((r) => r.name === "Food");
  if (!food) throw new Error("the projection carried no Food record");
  return food;
}

/** The countdown bracket the band implies: each end over the same rate. */
function countdownBracket(food: KerbalismResourceProjection) {
  const perSecond = -food.rate.magnitude;
  return {
    low: food.lower.magnitude / perSecond,
    high: food.upper.magnitude / perSecond,
  };
}

describe("what the modelled channel would add to a countdown", () => {
  it("is the elapsed correction, and it is the whole of it", () => {
    // 600 s past the anchor at -0.1/s off 100 units: the level band is
    // [40, 100] and the countdown bracket is [400 s, 1000 s].
    const food = foodAt(1600);
    const { low, high } = countdownBracket(food);
    const handRolled = timeToEmptySeconds("Food", LIFE_SUPPORT, STORED);

    expect(food.elapsed.magnitude).toBe(600);
    expect(handRolled).toBeCloseTo(1000);
    // The upper end IS the hand-rolled answer, because `upper` is the
    // observation the hand-rolled path divides. The lower end is that same
    // answer with the elapsed interval taken off it.
    expect(high).toBeCloseTo(handRolled ?? Number.NaN);
    expect(low).toBeCloseTo((handRolled ?? Number.NaN) - 600);
  });

  it("says nothing about the rate, which is the uncertainty a countdown has", () => {
    // The premise this was nominated on is that the modelled path carries
    // uncertainty the hand-rolled one structurally cannot. Divided by the rate
    // that produced it, the band is exactly the elapsed interval wide at any
    // rate, so what it carries is the correction over again and no more.
    const fast = foodAt(1600);
    const slow = foodAt(1600, {
      ...LIFE_SUPPORT,
      rates: { Food: value("units/s", -0.05) },
    });

    // The level bands differ by a factor of two, as the rates do.
    expect(fast.upper.magnitude - fast.lower.magnitude).toBeCloseTo(60);
    expect(slow.upper.magnitude - slow.lower.magnitude).toBeCloseTo(30);

    const fastWidth = countdownBracket(fast).high - countdownBracket(fast).low;
    const slowWidth = countdownBracket(slow).high - countdownBracket(slow).low;
    expect(fastWidth).toBeCloseTo(600);
    expect(slowWidth).toBeCloseTo(600);
    expect(slowWidth).toBeCloseTo(fastWidth);
  });
});

describe("what reading the countdown off the channel would cost", () => {
  it("hits zero at the crossing and stays there, with nothing to withdraw it", () => {
    // Two hours past an anchor on a craft carrying twenty minutes of food. The
    // channel still answers, because it imposes no horizon on purpose: a level
    // that decays continuously is honest through its widening band.
    const food = foodAt(1000 + 7200);
    expect(food.elapsed.magnitude).toBe(7200);
    expect(food.projected.magnitude).toBe(0);
    // A countdown off the clamped projection is the flat claim that the craft
    // is empty NOW. The band cannot qualify that: its other end is still the
    // hand-rolled answer, so the bracket has widened to useless.
    const { low, high } = countdownBracket(food);
    expect(low).toBe(0);
    expect(high).toBeCloseTo(1000);
  });

  it("would drop the horizon the reckoner over vessel.resources imposes", () => {
    // The same view time, asked of the model that does carry a horizon. It
    // withdraws by name rather than answering, which is the behaviour a
    // countdown wants and the channel has no equivalent of.
    expect(RESOURCE_RATE_HORIZON_SECONDS).toBe(1200);
    const answer = reckonResourceLevels(AMOUNTS, LIFE_SUPPORT, 1000 + 7200);
    if (!("declined" in answer)) throw new Error("the model answered");

    expect(answer.declined.reason).toBe("beyond-horizon");
    expect(answer.declined.input).toBe("@kerbalism.lifesupport#rates");
  });
});
