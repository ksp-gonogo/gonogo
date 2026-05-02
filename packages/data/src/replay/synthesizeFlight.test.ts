import { describe, expect, it } from "vitest";
import { isFlightFixture } from "./FlightFixture";
import { synthesizeFlight } from "./synthesizeFlight";

describe("synthesizeFlight", () => {
  it("treats sample t values as elapsed-since-launch by default", () => {
    const fixture = synthesizeFlight({
      vesselName: "Test",
      launchedAt: 1_000_000,
      samples: {
        "v.altitude": [
          [0, 0],
          [5_000, 100],
        ],
      },
    });
    expect(fixture.samples["v.altitude"]).toEqual([
      [1_000_000, 0],
      [1_005_000, 100],
    ]);
    expect(fixture.flight.launchedAt).toBe(1_000_000);
    expect(fixture.flight.lastSampleAt).toBe(1_005_000);
    expect(fixture.flight.sampleCount).toBe(2);
  });

  it("uses absolute t values when absolute: true", () => {
    const fixture = synthesizeFlight({
      vesselName: "Abs",
      launchedAt: 1_000_000,
      absolute: true,
      samples: {
        "v.altitude": [
          [1_000_500, 0],
          [1_002_000, 100],
        ],
      },
    });
    expect(fixture.samples["v.altitude"]).toEqual([
      [1_000_500, 0],
      [1_002_000, 100],
    ]);
  });

  it("derives lastSampleAt from the latest sample across all keys", () => {
    const fixture = synthesizeFlight({
      vesselName: "Multi",
      launchedAt: 0,
      samples: {
        "v.altitude": [
          [0, 0],
          [1_000, 1],
        ],
        "v.body": [[5_000, "Kerbin"]],
      },
    });
    expect(fixture.flight.lastSampleAt).toBe(5_000);
  });

  it("produces a fixture that passes isFlightFixture", () => {
    const fixture = synthesizeFlight({
      vesselName: "Validates",
      samples: {
        "v.altitude": [
          [0, 0],
          [1_000, 1],
        ],
      },
    });
    expect(isFlightFixture(fixture)).toBe(true);
  });

  it("auto-builds a schema when none is provided", () => {
    const fixture = synthesizeFlight({
      vesselName: "AutoSchema",
      samples: { "v.altitude": [[0, 0]], "v.body": [[0, "Kerbin"]] },
    });
    expect(fixture.schema.map((k) => k.key).sort()).toEqual([
      "v.altitude",
      "v.body",
    ]);
  });
});
