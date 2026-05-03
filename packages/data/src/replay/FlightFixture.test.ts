import { describe, expect, it } from "vitest";
import {
  FLIGHT_FIXTURE_FORMAT,
  type FlightFixture,
  fixtureDurationMs,
  isFlightFixture,
} from "./FlightFixture";

const baseFixture: FlightFixture = {
  format: FLIGHT_FIXTURE_FORMAT,
  flight: {
    id: "test-flight",
    vesselName: "Kerbal X",
    launchedAt: 1_000_000,
    lastSampleAt: 1_010_000,
    lastMissionTime: 10,
    sampleCount: 3,
  },
  schema: [{ key: "v.altitude" }, { key: "v.body" }],
  samples: {
    "v.altitude": [
      [1_000_000, 0],
      [1_005_000, 50],
      [1_010_000, 200],
    ],
    "v.body": [[1_000_000, "Kerbin"]],
  },
};

describe("isFlightFixture", () => {
  it("accepts a well-formed fixture", () => {
    expect(isFlightFixture(baseFixture)).toBe(true);
  });

  it("rejects a wrong format tag", () => {
    expect(isFlightFixture({ ...baseFixture, format: "v0" })).toBe(false);
  });

  it("rejects when flight metadata is missing required fields", () => {
    const bad = {
      ...baseFixture,
      flight: { ...baseFixture.flight, id: undefined },
    };
    expect(isFlightFixture(bad)).toBe(false);
  });

  it("rejects when a sample tuple isn't [t, v]", () => {
    const bad = {
      ...baseFixture,
      samples: { "v.altitude": [[1_000_000, 0, "extra"]] },
    };
    expect(isFlightFixture(bad)).toBe(false);
  });

  it("rejects when a series is out-of-order", () => {
    const bad = {
      ...baseFixture,
      samples: {
        "v.altitude": [
          [1_005_000, 50],
          [1_000_000, 0],
        ],
      },
    };
    expect(isFlightFixture(bad)).toBe(false);
  });

  it("rejects non-object inputs", () => {
    expect(isFlightFixture(null)).toBe(false);
    expect(isFlightFixture("string")).toBe(false);
    expect(isFlightFixture(42)).toBe(false);
  });

  it("accepts a fixture with valid chapters", () => {
    const withChapters = {
      ...baseFixture,
      chapters: [
        { id: "ascent", label: "Ascent", startMs: 0, endMs: 5_000 },
        { id: "orbit", label: "Orbit", startMs: 5_000, endMs: 10_000 },
      ],
    };
    expect(isFlightFixture(withChapters)).toBe(true);
  });

  it("rejects when a chapter has endMs before startMs", () => {
    const bad = {
      ...baseFixture,
      chapters: [{ id: "x", label: "X", startMs: 100, endMs: 50 }],
    };
    expect(isFlightFixture(bad)).toBe(false);
  });

  it("rejects when chapters isn't an array", () => {
    expect(isFlightFixture({ ...baseFixture, chapters: "ascent" })).toBe(false);
  });
});

describe("fixtureDurationMs", () => {
  it("returns the span between launch and last sample", () => {
    expect(fixtureDurationMs(baseFixture)).toBe(10_000);
  });

  it("clamps to 0 when lastSampleAt < launchedAt (corrupt or zero-sample)", () => {
    expect(
      fixtureDurationMs({
        ...baseFixture,
        flight: { ...baseFixture.flight, lastSampleAt: 999_999 },
      }),
    ).toBe(0);
  });
});
