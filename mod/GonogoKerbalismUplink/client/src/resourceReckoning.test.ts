import type { Reading, TopicPayload } from "@ksp-gonogo/sitrep-sdk";
import { Quality, value } from "@ksp-gonogo/sitrep-sdk";
import type { StreamFixture } from "@ksp-gonogo/sitrep-sdk/testing";
import { makeMeta, setupStreamFixture } from "@ksp-gonogo/sitrep-sdk/testing";
import { describe, expect, it } from "vitest";
import "./resourceReckoning";
import {
  RESOURCE_RATE_HORIZON_SECONDS,
  reckonResourceLevels,
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

  it("clamps an emptied tank at zero rather than going negative", () => {
    // 100 units at 0.1/s empties in 1000 s; asked 1200 s past the stamp.
    expect(reckonedAt(2100).resources.Food.current.magnitude).toBe(0);
  });

  it("clamps a filling tank at its capacity", () => {
    const filling = lifeSupport({ rates: { Food: value("units/s", 1) } });

    expect(reckonedAt(1900, filling).resources.Food.current.magnitude).toBe(
      400,
    );
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
    const inside = 900 + RESOURCE_RATE_HORIZON_SECONDS - 1;
    const outside = 900 + RESOURCE_RATE_HORIZON_SECONDS + 1;

    expect(readAt(inside).reckoning).toBe("available");
    expect(readAt(outside).reckoning).toBe("none");
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

  it("distinguishes a zero interval from a missing one", () => {
    expect(declineOf(lifeSupport(), 900)).toMatchObject({
      reason: "model-inapplicable",
    });
    expect(declineOf(lifeSupport(), 900).note).toContain(
      "no interval to carry them across",
    );
  });
});
