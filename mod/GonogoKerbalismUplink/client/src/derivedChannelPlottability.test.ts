import type { DerivedChannelDefinition, Value } from "@ksp-gonogo/sitrep-sdk";
import { value } from "@ksp-gonogo/sitrep-sdk";
import type { StreamFixture } from "@ksp-gonogo/sitrep-sdk/testing";
import { makeMeta, setupStreamFixture } from "@ksp-gonogo/sitrep-sdk/testing";
import { describe, expect, it } from "vitest";

/**
 * What shape a derived channel has to be in for a chart to reach it.
 *
 * Written against `kerbalism.resourceProjection`, which carried seven scalars
 * per resource and could not be plotted: the answer given in review was "it has
 * no scalar field to plot", and that was false. The real reasons are one
 * mechanical and one design, neither of which is a shortage of numbers, and
 * both outlive that channel, which is why they are pinned here on probes rather
 * than deleted with it.
 *
 * 1. **Scalars inside an ARRAY are unreachable.** `TimelineStore`'s
 *    `resolveDerivedTopic` splits a subtopic on its LAST dot and takes exactly
 *    one segment, so a payload rooted at `{resources: [...]}` offers exactly one
 *    subtopic, whose value is the array. There is no syntax that indexes an
 *    element, and keying by name instead would still need two segments
 * 2. **A bare dashed line is the wrong render for a banded model anyway.**
 *    `Graph` drops `reckoned` on a band series, so a point estimate drawn
 *    dashed beside a widening interval would present itself as the whole claim
 *
 * The first is fixable and the second is the reason not to rush it.
 *
 * A THIRD barrier stood here and is gone: `sampleReckonedTail` emitted only for
 * a finite bare `number`, so every `Value`-typed channel was excluded whatever
 * its paths looked like. The last case below used to pin that exclusion and now
 * pins its removal, because a probe one wrapper apart is the same evidence read
 * the other way round and losing it would leave nothing watching the barrier
 * that actually moved: no other test in the tree asserts that a tail arrives
 * still carrying its unit.
 */

const INPUT = "vessel.resources";

const CARRIED = [INPUT, "probe.collection", "probe.wrapped", "probe.bare"];

const AMOUNTS = {
  resources: {
    Food: { current: value("units", 100), max: value("units", 400) },
  },
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

/** A channel whose scalars sit one level down, inside an array. */
const collection: DerivedChannelDefinition<{
  resources: { name: string; projected: Value<"units"> }[];
}> = {
  topic: "probe.collection",
  inputs: [INPUT],
  derive: (get, viewUt) => {
    const point = get<unknown>(INPUT);
    if (!point || point.payload === null) return undefined;
    return {
      resources: [
        { name: "Food", projected: value("units", viewUt - point.validAt) },
      ],
    };
  },
  deriveReckoning: () => "rate-integration",
  fields: true,
};

function fixtureWithProbes(pinnedUt: number) {
  const fixture = setupStreamFixture({ carriedChannels: CARRIED, pinnedUt });
  fixture.store.registerDerivedChannel(collection);
  ingest(fixture, INPUT, AMOUNTS);
  fixture.store.beginFrame();
  return fixture;
}

describe("why an array-rooted channel reaches no chart", () => {
  it("carries scalars, so a shortage of numbers is not the reason", () => {
    const fixture = fixtureWithProbes(1600);

    const record = fixture.store.sample<{
      resources: { projected: Value<"units"> }[];
    }>("probe.collection")?.payload;

    expect(record?.resources[0]?.projected.magnitude).toBe(600);
  });

  it("offers no subtopic that reaches an element's own fields", () => {
    const fixture = fixtureWithProbes(1600);

    // A derived subtopic is ONE segment past the channel, so this resolves to
    // a `projected` key on the record root, which does not exist.
    expect(fixture.store.sample("probe.collection.projected")?.payload).toBe(
      undefined,
    );
  });

  it("draws no tail on the one subtopic that does resolve", () => {
    const fixture = fixtureWithProbes(1600);

    // `.resources` resolves, and its value is the array. A line through a
    // collection is not a thing, so the continuity test excludes it.
    expect(
      fixture.store.sampleReckonedTail(
        "probe.collection.resources",
        1000,
        1600,
      ),
    ).toEqual([]);
  });
});

describe("what a reachable scalar does get", () => {
  it("draws a tail whether or not it is wrapped, unit and all", () => {
    /*
     * The barrier that is gone, isolated so it is not hidden behind the one
     * that is not. Two probe channels one wrapper apart: both grow a tail, and
     * the wrapped one arrives still carrying its unit, which is what flattening
     * an array-rooted payload would buy. Read the other way round this is also
     * the guard on the wrapper surviving the walk, since a tail that quietly
     * unwrapped would satisfy a length assertion just as well.
     */
    const wrapped: DerivedChannelDefinition<{ level: unknown }> = {
      topic: "probe.wrapped",
      inputs: [INPUT],
      derive: (get, viewUt) => {
        const point = get<unknown>(INPUT);
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
        const point = get<unknown>(INPUT);
        if (!point || point.payload === null) return undefined;
        return { level: viewUt - point.validAt };
      },
    };

    const fixture = fixtureWithProbes(1600);
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
