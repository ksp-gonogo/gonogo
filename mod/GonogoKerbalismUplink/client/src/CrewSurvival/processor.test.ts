import { value } from "@ksp-gonogo/sitrep-sdk";
import { describe, expect, it } from "vitest";
import { deriveCrewSurvival } from "./processor";

const units = (n: number) => value("units", n);
const seconds = (n: number) => value("s", n);

describe("deriveCrewSurvival", () => {
  it("joins vessel.crew's roster against kerbalism.crew by name", () => {
    const result = deriveCrewSurvival(
      {
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

  it("normalizes each rule by its OWN fatalThreshold, not a fixed 1.0", () => {
    // Kerbalism's default profile gives radiation a fatal threshold of 50
    // while stress uses 1; a rule reader that assumed 1.0 for everything
    // would read this radiation accumulator as 4500% instead of 90%.
    const result = deriveCrewSurvival(
      {
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
    );
    expect(result.kerbals[0].worstRule?.fraction).toBeCloseTo(0.9);
  });

  it("picks the WORST rule regardless of name, not a fixed allowlist", () => {
    // A rule name outside the old base widget's hardcoded 7-name allowlist
    // (e.g. a custom rule under a non-stock profile) must still surface as
    // the worst rule if it is in fact the worst.
    const result = deriveCrewSurvival(
      {
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
    );
    expect(result.kerbals[0].worstRule).toEqual({
      name: "some-custom-rule",
      fraction: 0.95,
    });
  });

  it("gives a kerbal with no reported rules a stable entry, not a dropped row", () => {
    const result = deriveCrewSurvival(
      {
        count: value("count", 1),
        capacity: value("count", 1),
        crew: [{ name: "Bob" }],
      },
      [],
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
        count: value("count", 1),
        capacity: value("count", 1),
        crew: [{ name: "Bob" }],
      },
      undefined,
    );
    expect(result.kerbals).toHaveLength(1);
    expect(result.kerbals[0].tone).toBe("go");
    expect(result.soonestDeathClockSec).toBeNull();
  });

  it("reads deathClockSec straight off the wire and forces nogo when soon", () => {
    const result = deriveCrewSurvival(
      {
        count: value("count", 1),
        capacity: value("count", 1),
        crew: [{ name: "Val" }],
      },
      [{ name: "Val", deathClockSec: seconds(120) }],
    );
    expect(result.kerbals[0].deathClockSec).toBe(120);
    expect(result.kerbals[0].tone).toBe("nogo");
    expect(result.soonestDeathClockSec).toBe(120);
  });

  it("takes the soonest death clock across the whole crew", () => {
    const result = deriveCrewSurvival(
      {
        count: value("count", 2),
        capacity: value("count", 2),
        crew: [{ name: "Val" }, { name: "Bob" }],
      },
      [
        { name: "Val", deathClockSec: seconds(9000) },
        { name: "Bob", deathClockSec: seconds(300) },
      ],
    );
    expect(result.soonestDeathClockSec).toBe(300);
  });

  it("renders no crew when vessel.crew is undefined", () => {
    const result = deriveCrewSurvival(undefined, [
      {
        name: "Val",
        rules: [
          { name: "stress", value: units(0.9), fatalThreshold: units(1) },
        ],
      },
    ]);
    expect(result.kerbals).toEqual([]);
    expect(result.soonestDeathClockSec).toBeNull();
  });
});
