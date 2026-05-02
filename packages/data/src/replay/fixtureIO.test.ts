import { describe, expect, it } from "vitest";
import { MemoryStore } from "../storage/MemoryStore";
import { isFlightFixture } from "./FlightFixture";
import { exportFlightToFixture, importFixtureToStore } from "./fixtureIO";
import { synthesizeFlight } from "./synthesizeFlight";

describe("fixtureIO — round-trip through MemoryStore", () => {
  it("import → export reproduces the same samples", async () => {
    const fixture = synthesizeFlight({
      vesselName: "RoundTrip",
      launchedAt: 100_000,
      samples: {
        "v.altitude": [
          [0, 0],
          [1_000, 50],
          [2_000, 200],
        ],
        "v.body": [[0, "Kerbin"]],
      },
    });
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
    const fixture = synthesizeFlight({
      vesselName: "Sparse",
      launchedAt: 100_000,
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
    const fixture = synthesizeFlight({
      vesselName: "Schemas",
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
