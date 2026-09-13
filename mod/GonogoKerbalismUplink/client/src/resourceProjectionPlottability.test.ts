import type { DerivedChannelDefinition, Value } from "@ksp-gonogo/sitrep-sdk";
import { value } from "@ksp-gonogo/sitrep-sdk";
import type { StreamFixture } from "@ksp-gonogo/sitrep-sdk/testing";
import { makeMeta, setupStreamFixture } from "@ksp-gonogo/sitrep-sdk/testing";
import { describe, expect, it } from "vitest";
import {
  KERBALISM_RESOURCE_PROJECTION_TOPIC,
  kerbalismResourceProjectionChannel,
} from "./resourceProjection";

/**
 * What this channel actually carries, and why none of it reaches a chart.
 *
 * Written because the answer given in review was "it has no scalar field to
 * plot", and that is false: a projection is SEVEN scalars, and `projected` is
 * about as plottable a quantity as this contract owns. The true reasons are one
 * mechanical and one design, neither of which is a shortage of numbers, and
 * both are worth pinning because the wrong reason makes the gap sound permanent
 * when half of it is a path-resolution limit.
 *
 * 1. **The scalars live inside an ARRAY.** The payload root is
 *    `{resources: [...]}`, and `TimelineStore.resolveDerivedTopic` splits a
 *    subtopic on its LAST dot and takes exactly one segment. So the only
 *    subtopic that exists is `kerbalism.resourceProjection.resources`, whose
 *    value is the array; there is no syntax that indexes an element, and
 *    keying by resource name instead would still need two segments
 * 2. **A dashed line would be the wrong render anyway.** This model carries
 *    `lower`/`upper` that widen with the gap, and `Graph` already drops
 *    `reckoned` on a band series. A bare dashed `projected` would draw the
 *    point estimate as if it were the whole claim
 *
 * The first is fixable and the second is the reason not to rush it.
 *
 * A THIRD barrier stood here and is gone: `sampleReckonedTail` emitted only for
 * a finite bare `number`, so every `Value`-typed channel was excluded whatever
 * its paths looked like. The last case below used to pin that exclusion and now
 * pins its removal, because a probe one wrapper apart is the same evidence read
 * the other way round and losing it would leave nothing watching the barrier
 * that actually moved.
 */

const CARRIED = [
  "vessel.resources",
  "kerbalism.lifesupport",
  KERBALISM_RESOURCE_PROJECTION_TOPIC,
];

const AMOUNTS = {
  resources: {
    Food: { current: value("units", 100), max: value("units", 400) },
  },
};

/** Food draining at 0.1/s, Kerbalism's accumulators last advanced at UT 1000. */
const LIFE_SUPPORT = {
  asOfUt: value("ut", 1000),
  rates: { Food: value("units/s", -0.1) },
};

/**
 * Ingested straight into the store rather than emitted over the stub
 * transport: the transport's delivery is bridged into the store by a mounted
 * `TelemetryProvider`, and nothing here renders a widget.
 */
function ingest(fixture: StreamFixture, topic: string, payload: unknown) {
  fixture.store.ingest(topic, {
    validAt: 1000,
    payload,
    meta: makeMeta({ validAt: 1000, deliveredAt: 1000 }),
    epoch: 0,
  });
}

function fixtureWithProjection(pinnedUt: number) {
  const fixture = setupStreamFixture({ carriedChannels: CARRIED, pinnedUt });
  fixture.store.registerDerivedChannel(kerbalismResourceProjectionChannel);
  ingest(fixture, "vessel.resources", AMOUNTS);
  ingest(fixture, "kerbalism.lifesupport", LIFE_SUPPORT);
  fixture.store.beginFrame();
  return fixture;
}

describe("what kerbalism.resourceProjection carries", () => {
  it("is seven scalar magnitudes per resource, not none", () => {
    const fixture = fixtureWithProjection(1600);

    const record = fixture.store.sample<{
      resources: Record<string, { magnitude: number } | string>[];
    }>(KERBALISM_RESOURCE_PROJECTION_TOPIC)?.payload;
    const food = record?.resources[0];

    // The audit, field by field. `name` is the only non-numeric member.
    expect(food?.name).toBe("Food");
    for (const field of [
      "observed",
      "capacity",
      "rate",
      "elapsed",
      "projected",
      "lower",
      "upper",
    ]) {
      const held = food?.[field] as { magnitude: number } | undefined;
      expect(typeof held?.magnitude, `${field} is a scalar`).toBe("number");
      expect(Number.isFinite(held?.magnitude), `${field} is finite`).toBe(true);
    }
  });
});

describe("why none of it reaches a chart", () => {
  it("offers no subtopic that reaches a resource's own fields", () => {
    const fixture = fixtureWithProjection(1600);

    // A derived subtopic is ONE segment past the channel, so this resolves to
    // a `projected` key on the record root, which does not exist.
    expect(
      fixture.store.sample(`${KERBALISM_RESOURCE_PROJECTION_TOPIC}.projected`)
        ?.payload,
    ).toBeUndefined();
  });

  it("draws no tail on the one subtopic that does resolve", () => {
    const fixture = fixtureWithProjection(1600);

    // `.resources` resolves, and its value is the array. A line through a
    // collection is not a thing, so the continuity test excludes it.
    expect(
      fixture.store.sampleReckonedTail(
        `${KERBALISM_RESOURCE_PROJECTION_TOPIC}.resources`,
        1000,
        1600,
      ),
    ).toEqual([]);
  });

  it("would draw a tail on a reachable Value-typed scalar, unit and all", () => {
    /*
     * The barrier that is gone, isolated so it is not hidden behind the one
     * that is not. Two probe channels one wrapper apart: both grow a tail, and
     * the wrapped one arrives still carrying its unit, which is what flattening
     * this payload would buy. Read the other way round this is also the guard
     * on the wrapper surviving the walk, since a tail that quietly unwrapped
     * would satisfy a length assertion just as well.
     */
    const wrapped: DerivedChannelDefinition<{ level: unknown }> = {
      topic: "probe.wrapped",
      inputs: ["vessel.resources"],
      derive: (get, viewUt) => {
        const point = get<unknown>("vessel.resources");
        if (!point || point.payload === null) return undefined;
        return { level: value("units", viewUt - point.validAt) };
      },
      deriveReckoning: () => "rate-integration",
      fields: true,
    };
    const bare: DerivedChannelDefinition<{ level: number }> = {
      ...wrapped,
      topic: "probe.bare",
      derive: (get, viewUt) => {
        const point = get<unknown>("vessel.resources");
        if (!point || point.payload === null) return undefined;
        return { level: viewUt - point.validAt };
      },
    };

    const fixture = fixtureWithProjection(1600);
    fixture.store.registerDerivedChannel(wrapped);
    fixture.store.registerDerivedChannel(bare);
    fixture.store.beginFrame();

    expect(
      fixture.store.sampleReckonedTail("probe.bare.level", 1000, 1600).length,
    ).toBeGreaterThan(0);
    const wrappedTail = fixture.store.sampleReckonedTail<Value<"units">>(
      "probe.wrapped.level",
      1000,
      1600,
    );
    expect(wrappedTail.length).toBeGreaterThan(0);
    expect(wrappedTail.every((s) => s.value.unit === "units")).toBe(true);
  });
});
