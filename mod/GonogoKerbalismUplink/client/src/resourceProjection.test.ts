import type { DerivedGet } from "@ksp-gonogo/sitrep-client";
import { Quality, Staleness, value } from "@ksp-gonogo/sitrep-sdk";
import { describe, expect, it } from "vitest";
import {
  deriveResourceProjectionReckoning,
  deriveResourceProjections,
} from "./resourceProjection";

/**
 * Class B, end to end and pure: the model, its band, and the label that says a
 * model ran.
 *
 * Everything here is a direct call on the two exported functions rather than a
 * mounted store, because they are pure functions of two payloads and a view
 * time. The store-level wiring is the same `DerivedChannelDefinition`
 * machinery eight first-party channels already exercise.
 */

const NEVER_STATUS = () => "live" as const;

interface Point<T> {
  validAt: number;
  payload: T | null;
  meta: {
    source: string;
    validAt: number;
    seq: number;
    deliveredAt: number;
    vantage: string;
    quality: Quality;
    active: boolean;
    staleness: Staleness;
    timelineEpoch: number;
  };
  epoch: number;
}

function point<T>(payload: T | null, validAt = 0): Point<T> {
  return {
    validAt,
    payload,
    meta: {
      source: "vessel:abc",
      validAt,
      seq: 0,
      deliveredAt: validAt,
      vantage: "ksc",
      quality: Quality.OnRails,
      active: true,
      staleness: Staleness.Fresh,
      timelineEpoch: 0,
    },
    epoch: 0,
  };
}

/** A `get` over a fixed map, the seam a derived channel reads its inputs through. */
function getter(inputs: Record<string, unknown>): DerivedGet {
  return (<T>(topic: string) => inputs[topic] as T) as DerivedGet;
}

const AMOUNTS = {
  resources: {
    Food: { current: value("units", 100), max: value("units", 400) },
    Oxygen: { current: value("units", 50), max: value("units", 50) },
  },
};

/** Food draining at 0.1/s, oxygen replenishing at 0.05/s, measured at UT 1000. */
const LIFE_SUPPORT = {
  asOfUt: value("ut", 1000),
  rates: { Food: value("units/s", -0.1), Oxygen: value("units/s", 0.05) },
};

function inputs(overrides: Record<string, unknown> = {}) {
  return getter({
    "vessel.resources": point(AMOUNTS),
    "kerbalism.lifesupport": point(LIFE_SUPPORT),
    ...overrides,
  });
}

describe("the projection", () => {
  it("carries a level forward at its last observed rate", () => {
    // 600 s at -0.1/s off 100 units.
    const result = deriveResourceProjections(inputs(), 1600);
    const food = result?.resources.find((r) => r.name === "Food");
    expect(food?.projected.magnitude).toBeCloseTo(40);
    expect(food?.elapsed.magnitude).toBe(600);
  });

  it("integrates from the payload's own asOfUt, not the frame's whole clock", () => {
    // asOfUt is when Kerbalism last ADVANCED its accumulators, which for a
    // background craft sits behind the read time: unloaded vessels take their
    // turn one per tick, in rotation. Measuring from anything else, the
    // sample's validAt included, projects over the wrong interval.
    const stampedLate = point({
      ...LIFE_SUPPORT,
      asOfUt: value("ut", 1500),
    });
    const result = deriveResourceProjections(
      inputs({ "kerbalism.lifesupport": stampedLate }),
      1600,
    );
    expect(
      result?.resources.find((r) => r.name === "Food")?.elapsed.magnitude,
    ).toBe(100);
  });

  it("clamps at zero rather than projecting a negative level", () => {
    const result = deriveResourceProjections(inputs(), 1000 + 100_000);
    expect(
      result?.resources.find((r) => r.name === "Food")?.projected.magnitude,
    ).toBe(0);
  });

  it("clamps at capacity rather than overfilling a full tank", () => {
    // Oxygen is already at its max and gaining; the model must not invent
    // headroom the vessel does not have.
    const result = deriveResourceProjections(inputs(), 1600);
    expect(
      result?.resources.find((r) => r.name === "Oxygen")?.projected.magnitude,
    ).toBe(50);
  });

  it("never projects backwards when a sample sits ahead of the view time", () => {
    const result = deriveResourceProjections(inputs(), 900);
    expect(
      result?.resources.find((r) => r.name === "Food")?.elapsed.magnitude,
    ).toBe(0);
  });
});

describe("the band", () => {
  it("brackets the level at last contact and the level if the rate held", () => {
    const result = deriveResourceProjections(inputs(), 1600);
    const food = result?.resources.find((r) => r.name === "Food");
    // Draining, so the projection is the LOW end and the last observation the
    // high one. An operator reads "between 40 and 100".
    expect(food?.lower.magnitude).toBeCloseTo(40);
    expect(food?.upper.magnitude).toBe(100);
    expect(food?.observed.magnitude).toBe(100);
  });

  it("puts the projection on the UPPER side when the rate replenishes", () => {
    // The band is ordered by the numbers, never by an assumption that a
    // consumable only falls: a greenhouse or a converter runs the other way.
    const filling = point({
      ...AMOUNTS,
      resources: {
        ...AMOUNTS.resources,
        Oxygen: { current: value("units", 10), max: value("units", 50) },
      },
    });
    const result = deriveResourceProjections(
      inputs({ "vessel.resources": filling }),
      1600,
    );
    const oxygen = result?.resources.find((r) => r.name === "Oxygen");
    expect(oxygen?.lower.magnitude).toBe(10);
    expect(oxygen?.upper.magnitude).toBeCloseTo(40);
  });

  it("widens as the gap grows, which is what makes this decay rather than propagate", () => {
    // The honest difference from an orbit: a conic is as good after twenty
    // minutes as after one, and a rate is not. The band is the only place that
    // difference is visible, so it must actually move.
    const width = (viewUt: number) => {
      const food = deriveResourceProjections(inputs(), viewUt)?.resources.find(
        (r) => r.name === "Food",
      );
      return (food?.upper.magnitude ?? 0) - (food?.lower.magnitude ?? 0);
    };
    expect(width(1100)).toBeCloseTo(10);
    expect(width(1600)).toBeCloseTo(60);
    expect(width(1600)).toBeGreaterThan(width(1100));
  });

  it("is a point when nothing has elapsed", () => {
    const result = deriveResourceProjections(inputs(), 1000);
    const food = result?.resources.find((r) => r.name === "Food");
    expect(food?.lower.magnitude).toBe(food?.upper.magnitude);
  });
});

describe("what it declines to say", () => {
  it("is not whole until both inputs have reported", () => {
    // Two distinct nothings, never conflated: undefined is "no point yet".
    expect(
      deriveResourceProjections(
        getter({ "vessel.resources": point(AMOUNTS) }),
        1600,
      ),
    ).toBeUndefined();
  });

  it("is a confirmed absence when either input is a tombstone", () => {
    // No vessel, or Kerbalism gone. Null, never an empty projection list,
    // which would read as "this craft has no consumables".
    expect(
      deriveResourceProjections(
        inputs({ "kerbalism.lifesupport": point(null) }),
        1600,
      ),
    ).toBeNull();
  });

  it("projects nothing when the mod could not say WHEN it last integrated", () => {
    // A null asOfUt is a statement of ignorance the mod makes deliberately
    // rather than substituting a capture time. With no anchor there is no
    // interval, and guessing one would be the fabrication the null exists to
    // avoid.
    const noAnchor = point({ ...LIFE_SUPPORT, asOfUt: undefined });
    expect(
      deriveResourceProjections(
        inputs({ "kerbalism.lifesupport": noAnchor }),
        1600,
      ),
    ).toBeNull();
  });

  it("skips a rate for a resource this vessel does not carry", () => {
    const stranger = point({
      ...LIFE_SUPPORT,
      rates: { ...LIFE_SUPPORT.rates, Nitrogen: value("units/s", -1) },
    });
    const result = deriveResourceProjections(
      inputs({ "kerbalism.lifesupport": stranger }),
      1600,
    );
    expect(result?.resources.map((r) => r.name)).toEqual(["Food", "Oxygen"]);
  });
});

describe("the reckoning label", () => {
  it("says rate-integration once the projection has carried the value anywhere", () => {
    expect(
      deriveResourceProjectionReckoning(inputs(), 1600, NEVER_STATUS),
    ).toBe("rate-integration");
  });

  it("offers no basis while the numbers ARE the observation", () => {
    // Nothing has been modelled at the anchor itself, so labelling it
    // reckonable would claim a model ran when none did.
    expect(
      deriveResourceProjectionReckoning(inputs(), 1000, NEVER_STATUS),
    ).toBeUndefined();
  });

  it("offers no basis with no anchor to integrate from", () => {
    const noAnchor = point({ ...LIFE_SUPPORT, asOfUt: undefined });
    expect(
      deriveResourceProjectionReckoning(
        inputs({ "kerbalism.lifesupport": noAnchor }),
        1600,
        NEVER_STATUS,
      ),
    ).toBeUndefined();
  });

  it("is offered on a LIVE stream too, which a propagation's would not be", () => {
    // The sharp difference from class A. asOfUt can sit behind the read time
    // while the wire is perfectly current, because a background craft takes
    // its Kerbalism turn one tick in N. So a widget can be reading a modelled
    // number with no staleness anywhere in sight, and the label is the only
    // thing that says so.
    expect(NEVER_STATUS()).toBe("live");
    expect(
      deriveResourceProjectionReckoning(inputs(), 1600, NEVER_STATUS),
    ).toBe("rate-integration");
  });
});
