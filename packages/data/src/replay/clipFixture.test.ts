import { describe, expect, it } from "vitest";
import { clipFixture } from "./clipFixture";
import { isFlightFixture } from "./FlightFixture";
import { synthesizeFlight } from "./synthesizeFlight";

const RECORDING = synthesizeFlight({
  vesselName: "Multi-stage",
  launchedAt: 1_000_000,
  samples: {
    "v.altitude": [
      [0, 0],
      [10_000, 5_000],
      [20_000, 30_000],
      [40_000, 75_000],
      [80_000, 80_000],
    ],
    "v.body": [
      [0, "Kerbin"],
      [60_000, "Mun"],
    ],
  },
  schema: [{ key: "v.altitude" }, { key: "v.body" }],
});

const WITH_CHAPTERS = {
  ...RECORDING,
  chapters: [
    { id: "ascent", label: "Ascent", startMs: 0, endMs: 30_000 },
    {
      id: "circularization",
      label: "Circularization",
      startMs: 30_000,
      endMs: 50_000,
    },
    { id: "transit", label: "Transit", startMs: 50_000, endMs: 80_000 },
  ],
};

describe("clipFixture", () => {
  it("returns a fixture covering only samples within the chapter window", () => {
    const clip = clipFixture(WITH_CHAPTERS, "ascent");
    // Ascent = [0, 30_000] elapsed. Samples at elapsed 0, 10_000, 20_000
    // fall in. The 40_000 sample doesn't.
    expect(clip.samples["v.altitude"]).toHaveLength(3);
    expect(clip.samples["v.altitude"][0]).toEqual([0, 0]);
    expect(clip.samples["v.altitude"][2]).toEqual([20_000, 30_000]);
  });

  it("rebases launchedAt to the chapter start by default", () => {
    const clip = clipFixture(WITH_CHAPTERS, "circularization");
    expect(clip.flight.launchedAt).toBe(1_030_000); // 1_000_000 + 30_000
    // Circularization = [30_000, 50_000] absolute t = [1_030_000, 1_050_000].
    // After rebase, samples land at [0, 20_000] elapsed.
    // Only one sample falls in this window: v.altitude at absolute 1_040_000.
    expect(clip.samples["v.altitude"]).toEqual([[10_000, 75_000]]);
  });

  it("preserves absolute timestamps when rebaseToStart is false", () => {
    const clip = clipFixture(WITH_CHAPTERS, "ascent", { rebaseToStart: false });
    expect(clip.flight.launchedAt).toBe(1_000_000);
    expect(clip.samples["v.altitude"][0][0]).toBe(1_000_000);
  });

  it("includes the clipped chapter in the result for traceability", () => {
    const clip = clipFixture(WITH_CHAPTERS, "ascent");
    expect(clip.chapters).toEqual([
      { id: "ascent", label: "Ascent", startMs: 0, endMs: 30_000 },
    ]);
  });

  it("derives a unique flight id with #chapterId suffix", () => {
    const clip = clipFixture(WITH_CHAPTERS, "ascent");
    expect(clip.flight.id).toBe(`${WITH_CHAPTERS.flight.id}#ascent`);
  });

  it("recomputes sampleCount and lastSampleAt for the clip", () => {
    const clip = clipFixture(WITH_CHAPTERS, "ascent");
    expect(clip.flight.sampleCount).toBe(4); // 3 altitude + 1 body
    // Last sample was elapsed 20_000 → absolute (after rebase)
    // launchedAt + 20_000 = 1_000_000 + 20_000 = 1_020_000.
    expect(clip.flight.lastSampleAt).toBe(1_020_000);
  });

  it("throws when the chapter id is unknown", () => {
    expect(() => clipFixture(WITH_CHAPTERS, "nope")).toThrow(/not found/);
  });

  it("throws when the source fixture has no chapters at all", () => {
    expect(() => clipFixture(RECORDING, "anything")).toThrow(/not found/);
  });

  it("returns a fixture that still passes isFlightFixture", () => {
    const clip = clipFixture(WITH_CHAPTERS, "transit");
    expect(isFlightFixture(clip)).toBe(true);
  });
});
