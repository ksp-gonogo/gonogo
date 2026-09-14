import type { Reading, TopicPayload } from "@ksp-gonogo/sitrep-sdk";
import { Quality, value } from "@ksp-gonogo/sitrep-sdk";
import type { StreamFixture } from "@ksp-gonogo/sitrep-sdk/testing";
import { makeMeta, setupStreamFixture } from "@ksp-gonogo/sitrep-sdk/testing";
import { describe, expect, it } from "vitest";
import "./resourceReckoning";
import {
  RESOURCE_RATE_HORIZON_SECONDS,
  reckonResourceLevels,
  resourceBoundaryCrossings,
} from "./resourceReckoning";

/**
 * Carrying a consumable level forward at Kerbalism's own measured rate, as a
 * registered reckoner on `vessel.resources`.
 *
 * Every assertion here goes through the real store: the model is asked the way
 * production asks it, through `sampleReading`, so the decline the STORE raises
 * for an absent dep is exercised alongside the ones the model raises itself.
 *
 * The interval integrated over is `viewUt - lifesupport.asOfUt`, never
 * `viewUt - point.validAt`, so the fixtures below deliberately put the two a
 * long way apart: every one of them ingests at UT 1000 and stamps the
 * accumulators at UT 900, and a model reading the wrong clock gets an answer
 * 100 seconds out.
 */

const CARRIED = ["vessel.resources", "kerbalism.lifesupport"];

const AMOUNTS: Resources = {
  resources: {
    Food: {
      current: value("units", 100),
      max: value("units", 400),
      active: true,
    },
    Oxygen: {
      current: value("units", 50),
      max: value("units", 50),
      active: true,
    },
  },
  meta: { source: "test", quality: Quality.Loaded },
};

function ingest(fixture: StreamFixture, topic: string, payload: unknown) {
  fixture.store.ingest(topic, {
    validAt: 1000,
    payload,
    meta: makeMeta({ validAt: 1000, deliveredAt: 1000 }),
    epoch: 0,
  });
}

/** Food draining at 0.1/s, Oxygen in balance, accumulators stamped at UT 900. */
function lifeSupport(overrides: Partial<LifeSupport> = {}): LifeSupport {
  return {
    asOfUt: value("ut", 900),
    rates: { Food: value("units/s", -0.1), Oxygen: value("units/s", 0) },
    ...overrides,
  };
}

type Resources = TopicPayload<"vessel.resources">;
type LifeSupport = TopicPayload<"kerbalism.lifesupport">;

/**
 * `NO_LIFESUPPORT` rather than an omitted argument, so "Kerbalism never sent
 * anything" is a case a caller states outright. It was an `undefined` default
 * first, which silently fell back to the healthy ledger and passed a test
 * meant to prove the store declines for an absent dep.
 */
const NO_LIFESUPPORT = Symbol("no lifesupport on the stream");

function readAt(
  viewUt: number,
  ls: unknown = lifeSupport(),
  amounts: unknown = AMOUNTS,
): Reading<Resources> {
  const fixture = setupStreamFixture({
    carriedChannels: CARRIED,
    pinnedUt: viewUt,
  });
  ingest(fixture, "vessel.resources", amounts);
  if (ls !== NO_LIFESUPPORT) ingest(fixture, "kerbalism.lifesupport", ls);
  fixture.store.beginFrame();
  return fixture.store.sampleReading<Resources>("vessel.resources");
}

/** The reckoned payload, or a failure naming what the reading said instead. */
function reckonedAt(
  viewUt: number,
  ls?: unknown,
  amounts?: unknown,
): Resources {
  const reading = readAt(viewUt, ls, amounts);
  if (reading.reckoning !== "available") {
    throw new Error(
      `expected a model at UT ${viewUt}, got reckoning "${reading.reckoning}"`,
    );
  }
  return reading.reckoned.value;
}

describe("carrying a consumable level forward", () => {
  it("integrates the observed rate from the accumulator stamp, not the wire time", () => {
    // 200 s past the UT 900 stamp at -0.1/s: 100 - 20 = 80. A model reading
    // `point.validAt` (UT 1000) instead would answer 90.
    const food = reckonedAt(1100).resources.Food;

    expect(food.current.magnitude).toBeCloseTo(80, 6);
  });

  it("leaves a resource whose measured rate is zero exactly where it was observed", () => {
    // A key present with 0 is Kerbalism's real, measured zero, not an absence,
    // so the honest answer is the observation unchanged rather than no answer.
    expect(reckonedAt(1100).resources.Oxygen.current.magnitude).toBe(50);
  });

  it("names only the levels it actually moved", () => {
    const reading = readAt(1100);
    if (reading.reckoning !== "available") throw new Error("no model");

    expect(reading.reckoned.modelled.map((f) => f.path).sort()).toEqual([
      "",
      "resources.Food.current",
    ]);
    expect(reading.reckoned.basis).toBe("rate-integration");
    expect(reading.reckoned.owner).toBe("kerbalism");
  });

  it("carries the capacity, the presence flag and meta through untouched", () => {
    const food = reckonedAt(1100).resources.Food;

    expect(food.max.magnitude).toBe(400);
    expect(food.active).toBe(true);
    expect(reckonedAt(1100).meta).toEqual(AMOUNTS.meta);
  });

  it("keeps modelling a level that is still inside the range it can occupy", () => {
    // The control for the two withdrawals below: 250 s past the stamp the
    // filling tank is at 350 of 400, short of its capacity, and modelled.
    const filling = lifeSupport({ rates: { Food: value("units/s", 1) } });

    expect(reckonedAt(1150, filling).resources.Food.current.magnitude).toBe(
      350,
    );
  });
});

/**
 * Withdrawing where the extrapolation leaves the range, at either end.
 *
 * A tank cannot hold less than nothing or more than its capacity, so a rate
 * that would carry a level past either has demonstrably stopped holding by
 * then, whatever the horizon says. Both ends are the same defect: the old
 * model pinned the value at the boundary and went on answering, which is a
 * confident claim ("empty NOW", "full NOW") that reads at a widget exactly
 * like an observation of an empty or a full tank.
 */
describe("when the model's own arithmetic leaves the range", () => {
  it("withdraws a draining level at the moment it would reach empty", () => {
    // 100 units at 0.1/s reaches zero 1000 s past the stamp, and the horizon
    // does not reach for another 200 s. Oxygen's measured rate is zero, so
    // Food is the only level moving and the model has nothing left to say.
    expect(1100).toBeLessThan(RESOURCE_RATE_HORIZON_SECONDS);

    expect(readAt(900 + 1100).reckoning).toBe("none");
  });

  it("withdraws a filling level at the moment it would reach capacity", () => {
    // The same shape at the other end, and reachable in practice. 100 of 400
    // units gaining 1/s is full 300 s past the stamp, a quarter of the way to
    // the horizon. The old model reported a full tank for the other 900 s.
    const filling = lifeSupport({ rates: { Food: value("units/s", 1) } });

    expect(readAt(900 + 400, filling).reckoning).toBe("none");
    expect(readAt(900 + 1199, filling).reckoning).toBe("none");
  });

  it("leaves a crossed level where it was last observed and carries on with the rest", () => {
    // Food reaches empty at 1000 s, Oxygen not for 5000. Asked at 1100 the
    // model answers for Oxygen and hands Food back untouched. A level it has
    // stopped modelling travels verbatim, like any other unnamed path.
    // That is the difference between "stale" and a claim of zero.
    const ls = lifeSupport({
      rates: { Food: value("units/s", -0.1), Oxygen: value("units/s", -0.01) },
    });
    const reading = readAt(900 + 1100, ls);
    if (reading.reckoning !== "available") throw new Error("no model");

    expect(reading.reckoned.value.resources.Food.current.magnitude).toBe(100);
    expect(
      reading.reckoned.value.resources.Oxygen.current.magnitude,
    ).toBeCloseTo(39, 6);
    expect(reading.reckoned.modelled.map((f) => f.path).sort()).toEqual([
      "",
      "resources.Oxygen.current",
    ]);
  });
});

describe("when the model refuses", () => {
  it("offers nothing when Kerbalism is not on the stream at all", () => {
    // The STORE's decline, raised for an unresolved dep before the model runs.
    expect(readAt(1100, NO_LIFESUPPORT).reckoning).toBe("none");
  });

  it("declines when Kerbalism publishes no last-advanced stamp", () => {
    // A statement of ignorance the mod makes deliberately rather than
    // substituting a capture time: with no anchor there is no interval.
    const unstamped = lifeSupport({ asOfUt: undefined });

    expect(readAt(1100, unstamped).reckoning).toBe("none");
  });

  it("declines at the view time the accumulators were advanced at", () => {
    // Nothing to carry the value across: the observation IS the answer for
    // this instant, and arithmetic about it would replace a measured value.
    expect(readAt(900).reckoning).toBe("none");
  });

  it("declines past the horizon rather than extrapolating a net rate forever", () => {
    // A tenth of the usual rate, so the tank is nowhere near empty at the
    // horizon and the horizon is the only thing that can stop the model.
    const slow = lifeSupport({ rates: { Food: value("units/s", -0.01) } });
    const inside = 900 + RESOURCE_RATE_HORIZON_SECONDS - 1;
    const outside = 900 + RESOURCE_RATE_HORIZON_SECONDS + 1;

    expect(readAt(inside, slow).reckoning).toBe("available");
    expect(readAt(outside, slow).reckoning).toBe("none");
  });

  it("declines when no resource on the vessel has a rate to integrate", () => {
    const irrelevant = lifeSupport({
      rates: { Nitrogen: value("units/s", -1) },
    });

    expect(readAt(1100, irrelevant).reckoning).toBe("none");
  });
});

/**
 * The refusals, read back as REASONS rather than as an absence.
 *
 * `vessel.resources` carries no `[SitrepReckonable]` mark, so `Reading` has no
 * `declined` field and every case above can only show `reckoning: "none"`. Four
 * distinct refusals collapse into one observable answer, and calling the model
 * directly is the only way to tell them apart. If the field is ever marked,
 * these become assertions on `ReckonableReading.declined` and this block goes.
 */
describe("the reason a refusal gives", () => {
  const declineOf = (ls: LifeSupport | null, viewUt: number) => {
    const answer = reckonResourceLevels(AMOUNTS, ls, viewUt);
    if (!("declined" in answer)) throw new Error("the model answered");
    return answer.declined;
  };

  it("names the topic, not this model's internals, for a Kerbalism tombstone", () => {
    expect(declineOf(null, 1100)).toMatchObject({
      reason: "input-absent",
      input: "@kerbalism.lifesupport",
    });
  });

  it("names the stamp when the mod could not read its own evaluation marker", () => {
    expect(declineOf(lifeSupport({ asOfUt: undefined }), 1100)).toMatchObject({
      reason: "input-absent",
      input: "@kerbalism.lifesupport#asOfUt",
    });
  });

  it("says how far past the horizon it was asked, in the units it was asked in", () => {
    const decline = declineOf(
      lifeSupport(),
      900 + RESOURCE_RATE_HORIZON_SECONDS + 300,
    );

    expect(decline.reason).toBe("beyond-horizon");
    expect(decline.note).toContain("1500 seconds ago");
  });

  it("blames the rate when every level would have left its own range", () => {
    // Not a separate reason code. A tank cannot pass its floor or its
    // capacity, so a rate that says it has is a rate that stopped holding.
    // The input that failed is the same one the horizon names.
    const decline = declineOf(lifeSupport(), 900 + 1100);

    expect(decline.reason).toBe("beyond-horizon");
    expect(decline.input).toBe("@kerbalism.lifesupport#rates");
    expect(decline.note).toContain("Food");
    expect(decline.note).toContain("1900");
  });

  it("distinguishes a zero interval from a missing one", () => {
    expect(declineOf(lifeSupport(), 900)).toMatchObject({
      reason: "model-inapplicable",
    });
    expect(declineOf(lifeSupport(), 900).note).toContain(
      "no interval to carry them across",
    );
  });
});

/**
 * The crossing, published so a consumer can say WHEN rather than only that the
 * model has stopped.
 *
 * It is an absolute UT and not a countdown, because it is a fact about the
 * observation rather than about the frame: it does not move as the view time
 * advances, so a caller holding one can compare it against whatever view time
 * it likes. A duration would have to be recomputed every frame and would say
 * the same thing twice.
 */
describe("the moment a level leaves the range it can occupy", () => {
  it("answers with the UT a draining tank reaches its floor at", () => {
    // 100 units at 0.1/s off the UT 900 stamp: empty at UT 1900.
    expect(resourceBoundaryCrossings(AMOUNTS, lifeSupport())).toEqual([
      { resource: "Food", boundary: "floor", atUt: value("ut", 1900) },
    ]);
  });

  it("answers at the ceiling on the same terms, which is the whole point", () => {
    // 300 units of headroom at 1/s: full at UT 1200. Not a special case of
    // the floor and not spelled as one.
    const filling = lifeSupport({ rates: { Food: value("units/s", 1) } });

    expect(resourceBoundaryCrossings(AMOUNTS, filling)).toEqual([
      { resource: "Food", boundary: "ceiling", atUt: value("ut", 1200) },
    ]);
  });

  it("says nothing where there is no rate to reach a boundary on", () => {
    // Oxygen's measured zero, a resource the craft does not carry, an absent
    // ledger and an absent observation: four absences, one empty answer.
    const irrelevant = lifeSupport({
      rates: { Nitrogen: value("units/s", -1) },
    });

    expect(resourceBoundaryCrossings(AMOUNTS, lifeSupport())).toHaveLength(1);
    expect(resourceBoundaryCrossings(AMOUNTS, irrelevant)).toEqual([]);
    expect(resourceBoundaryCrossings(AMOUNTS, null)).toEqual([]);
    expect(resourceBoundaryCrossings(null, lifeSupport())).toEqual([]);
  });

  it("declines to invent one when Kerbalism published no stamp to anchor it to", () => {
    // The same refusal the model makes: with no anchor there is no moment,
    // and a capture time substituted for it would be a UT nobody measured.
    const unstamped = lifeSupport({ asOfUt: undefined });

    expect(resourceBoundaryCrossings(AMOUNTS, unstamped)).toEqual([]);
  });
});
