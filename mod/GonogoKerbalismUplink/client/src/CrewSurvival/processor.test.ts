import { type PayloadMeta, Quality, value } from "@ksp-gonogo/sitrep-sdk";
import { describe, expect, it } from "vitest";
import { deriveCrewSurvival, toneFor } from "./processor";

/**
 * The provenance every `vessel.crew` payload carries. Nothing here reads it,
 * and it is spelled out rather than omitted because a payload without it is one
 * the wire cannot produce.
 */
const CREW_META: PayloadMeta = {
  source: "vessel.crew",
  quality: Quality.Loaded,
};

const units = (n: number) => value("units", n);
/**
 * The frame's view time every case reads at. The wire carries the death clock
 * as an INSTANT, so a deadline N seconds out is stamped `VIEW_UT + N`: that is
 * the whole point of the change, and writing the fixtures this way is what
 * makes a forgotten subtraction fail rather than pass.
 */
const VIEW_UT = 1_000_000;
const deadlineIn = (n: number) => value("ut", VIEW_UT + n);

describe("deriveCrewSurvival", () => {
  it("joins vessel.crew's roster against kerbalism.crew by name", () => {
    const result = deriveCrewSurvival(
      {
        meta: CREW_META,
        count: value("count", 2),
        capacity: value("count", 4),
        crew: [
          { name: "Jebediah Kerman", trait: "Pilot" },
          { name: "Bill Kerman", trait: "Engineer" },
        ],
      },
      [
        {
          name: "Jebediah Kerman",
          rules: [
            { name: "radiation", value: units(45), fatalThreshold: units(50) },
          ],
        },
        {
          name: "Bill Kerman",
          rules: [
            { name: "stress", value: units(0.1), fatalThreshold: units(1) },
          ],
        },
      ],
      VIEW_UT,
    );

    expect(result.kerbals).toHaveLength(2);
    expect(result.kerbals[0].name).toBe("Jebediah Kerman");
    expect(result.kerbals[0].trait).toBe("Pilot");
    expect(result.kerbals[0].worstRule).toEqual({
      name: "radiation",
      fraction: 0.9,
    });
    expect(result.kerbals[0].tone).toBe("nogo"); // 0.9 >= 0.8
    expect(result.kerbals[1].worstRule).toEqual({
      name: "stress",
      fraction: 0.1,
    });
    expect(result.kerbals[1].tone).toBe("go");
  });

  it("carries every rule, not just the worst, sorted worst-first", () => {
    const result = deriveCrewSurvival(
      {
        meta: CREW_META,
        count: value("count", 1),
        capacity: value("count", 1),
        crew: [{ name: "Val" }],
      },
      [
        {
          name: "Val",
          rules: [
            { name: "stress", value: units(0.2), fatalThreshold: units(1) },
            { name: "radiation", value: units(45), fatalThreshold: units(50) },
          ],
        },
      ],
      VIEW_UT,
    );
    // Worst (radiation, 0.9) first, regardless of wire order.
    expect(result.kerbals[0].rules).toEqual([
      { name: "radiation", fraction: 0.9 },
      { name: "stress", fraction: 0.2 },
    ]);
    expect(result.kerbals[0].worstRule).toEqual(result.kerbals[0].rules[0]);
  });

  it("normalizes each rule by its OWN fatalThreshold, not a fixed 1.0", () => {
    // Kerbalism's default profile gives radiation a fatal threshold of 50
    // while stress uses 1; a rule reader that assumed 1.0 for everything
    // would read this radiation accumulator as 4500% instead of 90%.
    const result = deriveCrewSurvival(
      {
        meta: CREW_META,
        count: value("count", 1),
        capacity: value("count", 1),
        crew: [{ name: "Val" }],
      },
      [
        {
          name: "Val",
          rules: [
            { name: "radiation", value: units(45), fatalThreshold: units(50) },
          ],
        },
      ],
      VIEW_UT,
    );
    expect(result.kerbals[0].worstRule?.fraction).toBeCloseTo(0.9);
  });

  it("picks the WORST rule regardless of name, not a fixed allowlist", () => {
    // A rule name outside the old base widget's hardcoded 7-name allowlist
    // (e.g. a custom rule under a non-stock profile) must still surface as
    // the worst rule if it is in fact the worst.
    const result = deriveCrewSurvival(
      {
        meta: CREW_META,
        count: value("count", 1),
        capacity: value("count", 1),
        crew: [{ name: "Val" }],
      },
      [
        {
          name: "Val",
          rules: [
            { name: "radiation", value: units(5), fatalThreshold: units(50) },
            {
              name: "some-custom-rule",
              value: units(0.95),
              fatalThreshold: units(1),
            },
          ],
        },
      ],
      VIEW_UT,
    );
    expect(result.kerbals[0].worstRule).toEqual({
      name: "some-custom-rule",
      fraction: 0.95,
    });
  });

  it("gives a kerbal with no reported rules a stable entry, not a dropped row", () => {
    const result = deriveCrewSurvival(
      {
        meta: CREW_META,
        count: value("count", 1),
        capacity: value("count", 1),
        crew: [{ name: "Bob" }],
      },
      [],
      VIEW_UT,
    );
    expect(result.kerbals).toHaveLength(1);
    expect(result.kerbals[0].worstRule).toBeUndefined();
    expect(result.kerbals[0].deathClockSec).toBeNull();
    expect(result.kerbals[0].tone).toBe("go");
  });

  it("gives a kerbal with no kerbalism.crew entry at all the same stable default", () => {
    // kerbalism.crew undefined entirely (mod not installed, or absent this frame).
    const result = deriveCrewSurvival(
      {
        meta: CREW_META,
        count: value("count", 1),
        capacity: value("count", 1),
        crew: [{ name: "Bob" }],
      },
      undefined,
      VIEW_UT,
    );
    expect(result.kerbals).toHaveLength(1);
    expect(result.kerbals[0].tone).toBe("go");
    expect(result.soonestDeathClockSec).toBeNull();
  });

  it("turns the wire's death-clock INSTANT into time remaining, and forces nogo when soon", () => {
    const result = deriveCrewSurvival(
      {
        meta: CREW_META,
        count: value("count", 1),
        capacity: value("count", 1),
        crew: [{ name: "Val" }],
      },
      [{ name: "Val", deathClockUt: deadlineIn(120) }],
      VIEW_UT,
    );
    expect(result.kerbals[0].deathClockSec).toBe(120);
    expect(result.kerbals[0].tone).toBe("nogo");
    expect(result.soonestDeathClockSec).toBe(120);
  });

  it("takes the soonest death clock across the whole crew", () => {
    const result = deriveCrewSurvival(
      {
        meta: CREW_META,
        count: value("count", 2),
        capacity: value("count", 2),
        crew: [{ name: "Val" }, { name: "Bob" }],
      },
      [
        { name: "Val", deathClockUt: deadlineIn(9000) },
        { name: "Bob", deathClockUt: deadlineIn(300) },
      ],
      VIEW_UT,
    );
    expect(result.soonestDeathClockSec).toBe(300);
  });

  it("renders no crew when vessel.crew is undefined", () => {
    const result = deriveCrewSurvival(
      undefined,
      [
        {
          name: "Val",
          rules: [
            { name: "stress", value: units(0.9), fatalThreshold: units(1) },
          ],
        },
      ],
      VIEW_UT,
    );
    expect(result.kerbals).toEqual([]);
    expect(result.soonestDeathClockSec).toBeNull();
  });
});

describe("toneFor", () => {
  it("bands a fraction go/warn/nogo at the 0.5/0.8 thresholds", () => {
    expect(toneFor(0.2)).toBe("go");
    expect(toneFor(0.5)).toBe("warn");
    expect(toneFor(0.8)).toBe("nogo");
  });
});
