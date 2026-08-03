import { describe, expect, it } from "vitest";
import {
  commandedAt,
  DEVIATION_EPSILON,
  deriveStrip,
  exceedsDeadband,
  hasDeviation,
  type LoggedSample,
  MAX_SAMPLES,
  normalize01,
  recordSample,
} from "./control-stream-model";

describe("normalize01", () => {
  it("passes a unit value through, clamped to 0..1", () => {
    expect(normalize01(0.7, "unit")).toBe(0.7);
    expect(normalize01(1.4, "unit")).toBe(1);
    expect(normalize01(-0.2, "unit")).toBe(0);
  });

  it("maps a signed value so neutral sits at the mid band", () => {
    expect(normalize01(0, "signed")).toBe(0.5);
    expect(normalize01(1, "signed")).toBe(1);
    expect(normalize01(-1, "signed")).toBe(0);
    expect(normalize01(-0.5, "signed")).toBeCloseTo(0.25, 5);
  });

  it("treats a non-finite value as zero", () => {
    expect(normalize01(Number.NaN, "unit")).toBe(0);
  });
});

describe("deriveStrip", () => {
  const oneWaySeconds = 1; // strip spans 3s: outgoing 0..1, echo 1..2, confirmed 2..3

  it("ages commands now-left, oldest-right, dropping past the 3T span", () => {
    const { inTransit } = deriveStrip({
      commandLog: [
        { atUt: 100, value: 0.5 }, // age 0 (now)
        { atUt: 98.5, value: 0.6 }, // age 1.5
        { atUt: 96, value: 0.9 }, // age 4 -> dropped (> 3s)
      ],
      readbackLog: [],
      nowUt: 100,
      oneWaySeconds,
    });
    expect(inTransit.map((s) => s.age)).toEqual([0, 1.5]);
    expect(inTransit[0].value).toBe(0.5);
  });

  it("places readback received now at the start of the confirmed zone (age 2T)", () => {
    const { echo } = deriveStrip({
      commandLog: [],
      readbackLog: [
        { atUt: 100, value: 0.4 }, // received now -> age 2T = 2
        { atUt: 99.5, value: 0.3 }, // received 0.5s ago -> age 2.5
      ],
      nowUt: 100,
      oneWaySeconds,
    });
    expect(echo.map((s) => s.age)).toEqual([2, 2.5]);
    expect(echo[0].value).toBe(0.4);
  });
});

describe("recordSample", () => {
  it("caps the ring at MAX_SAMPLES regardless of how many pushes happen, keeping the most recent", () => {
    const ring: LoggedSample[] = [];
    // One more than the cap so the bounding behaviour (not just an
    // off-by-one) is exercised: a ring bounded only by a `trim()` reachable
    // from a single call site (the delayed branch in `use-control-stream.
    // tsx`) grows without limit on a direct/low-delay link, where that
    // branch never runs. `recordSample` is the fix: bounded on every push,
    // unconditionally.
    for (let i = 0; i < MAX_SAMPLES + 200; i++) {
      recordSample(ring, { atUt: i, value: i });
      // The invariant holds after EVERY push, not just at the end: this is
      // the difference between "bounded" and "eventually gets capped when
      // something else happens to look at it".
      expect(ring.length).toBeLessThanOrEqual(MAX_SAMPLES);
    }
    expect(ring.length).toBe(MAX_SAMPLES);
    // Oldest entries were dropped, newest retained (FIFO).
    expect(ring[0].atUt).toBe(200);
    expect(ring[ring.length - 1].atUt).toBe(MAX_SAMPLES + 199);
  });

  it("is a no-op cap below the limit", () => {
    const ring: LoggedSample[] = [];
    recordSample(ring, { atUt: 1, value: 0.1 });
    recordSample(ring, { atUt: 2, value: 0.2 });
    expect(ring).toEqual([
      { atUt: 1, value: 0.1 },
      { atUt: 2, value: 0.2 },
    ]);
  });
});

describe("exceedsDeadband", () => {
  const deadband = 0.005;

  it("compares a unit-range delta directly against the deadband", () => {
    // Raw delta 0.006 == normalized delta 0.006 for "unit": over the band.
    expect(exceedsDeadband(0.506, 0.5, "unit", deadband)).toBe(true);
    // Raw delta 0.003: under the band.
    expect(exceedsDeadband(0.503, 0.5, "unit", deadband)).toBe(false);
  });

  it("normalises a signed-range delta before comparing, so the effective deadband matches unit's", () => {
    // Raw delta 0.006 on a signed (-1..1) axis normalises to 0.003 (half):
    // comparing the RAW delta against the deadband (the bug) would wrongly
    // treat this as exceeding it, dispatching at half the intended
    // deadband on signed axes. Comparing normalised values keeps it under.
    expect(exceedsDeadband(0.506, 0.5, "signed", deadband)).toBe(false);
    // A raw delta of 0.02 normalises to 0.01, genuinely past the deadband.
    expect(exceedsDeadband(0.52, 0.5, "signed", deadband)).toBe(true);
  });
});

describe("commandedAt / hasDeviation", () => {
  const inTransit = [
    { age: 0, value: 0.2 },
    { age: 2, value: 0.6 },
  ];

  it("interpolates the commanded path at an age between samples", () => {
    expect(commandedAt(inTransit, 1)).toBeCloseTo(0.4, 5);
    expect(commandedAt([], 1)).toBeNull();
  });

  it("flags a confirmed-zone divergence past the epsilon, ignores tiny ones", () => {
    expect(
      hasDeviation(inTransit, [{ age: 2, value: 0.6 + DEVIATION_EPSILON / 2 }]),
    ).toBe(false);
    expect(hasDeviation(inTransit, [{ age: 2, value: 0.95 }])).toBe(true);
  });
});
