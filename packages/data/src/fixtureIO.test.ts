import { describe, expect, it } from "vitest";
import type { FlightFixture } from "./fixtureIO";
import {
  exportFlightToFixture,
  importFixtureToStore,
  isFlightFixture,
} from "./fixtureIO";
import { MemoryStore } from "./storage/MemoryStore";

/** Minimal hand-built fixture — replaces the retired `synthesizeFlight` test helper for this file's own narrow needs. */
function testFixture(overrides: Partial<FlightFixture> = {}): FlightFixture {
  return {
    format: "gonogo-flight-fixture/v1",
    flight: {
      id: "f1",
      vesselName: "RoundTrip",
      launchedAt: 100_000,
      lastSampleAt: 102_000,
      lastMissionTime: 2,
      sampleCount: 4,
    },
    schema: [],
    samples: {
      "v.altitude": [
        [100_000, 0],
        [101_000, 50],
        [102_000, 200],
      ],
      "v.body": [[100_000, "Kerbin"]],
    },
    ...overrides,
  };
}

describe("fixtureIO — round-trip through MemoryStore", () => {
  it("import → export reproduces the same samples", async () => {
    const fixture = testFixture();
    const store = new MemoryStore();
    await importFixtureToStore(store, fixture);

    const exported = await exportFlightToFixture(store, fixture.flight.id, {
      keys: ["v.altitude", "v.body"],
    });

    expect(isFlightFixture(exported)).toBe(true);
    expect(exported.flight).toEqual(fixture.flight);
    expect(exported.samples["v.altitude"]).toEqual([
      [100_000, 0],
      [101_000, 50],
      [102_000, 200],
    ]);
    expect(exported.samples["v.body"]).toEqual([[100_000, "Kerbin"]]);
  });

  it("drops keys with no samples from the export", async () => {
    const fixture = testFixture({
      flight: {
        id: "f2",
        vesselName: "Sparse",
        launchedAt: 100_000,
        lastSampleAt: 100_000,
        lastMissionTime: 0,
        sampleCount: 1,
      },
      samples: { "v.altitude": [[0, 0]] },
    });
    const store = new MemoryStore();
    await importFixtureToStore(store, fixture);

    const exported = await exportFlightToFixture(store, fixture.flight.id, {
      keys: ["v.altitude", "v.body"],
    });

    expect(Object.keys(exported.samples)).toEqual(["v.altitude"]);
  });

  it("preserves the supplied schema entries verbatim", async () => {
    const fixture = testFixture({
      flight: {
        id: "f3",
        vesselName: "Schemas",
        launchedAt: 100_000,
        lastSampleAt: 100_000,
        lastMissionTime: 0,
        sampleCount: 1,
      },
      samples: { "v.altitude": [[0, 0]] },
    });
    const store = new MemoryStore();
    await importFixtureToStore(store, fixture);

    const schema = [{ key: "v.altitude", label: "Altitude", group: "State" }];
    const exported = await exportFlightToFixture(store, fixture.flight.id, {
      keys: ["v.altitude"],
      schema,
    });
    expect(exported.schema).toEqual(schema);
  });

  it("rejects when the requested flight isn't in the store", async () => {
    const store = new MemoryStore();
    await expect(
      exportFlightToFixture(store, "nope", { keys: ["v.altitude"] }),
    ).rejects.toThrow(/not found/);
  });
});
