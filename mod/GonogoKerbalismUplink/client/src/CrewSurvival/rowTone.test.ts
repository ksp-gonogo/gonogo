import { describe, expect, it } from "vitest";
import type { CrewSurvival, KerbalSurvival } from "./processor";
import { rowTones } from "./rowTone";

function kerbal(overrides: Partial<KerbalSurvival> = {}): KerbalSurvival {
  return {
    name: "Jebediah Kerman",
    trait: "Pilot",
    rules: [],
    worstRule: undefined,
    deathClockSec: null,
    tone: "go",
    ...overrides,
  };
}

function survival(kerbals: KerbalSurvival[]): CrewSurvival {
  return { kerbals, soonestDeathClockSec: null };
}

describe("rowTones", () => {
  it("reports nothing when the whole crew is fine, or there is no data", () => {
    expect(rowTones(survival([kerbal({ tone: "go" })]))).toBeNull();
    expect(rowTones(undefined)).toBeNull();
  });

  it("reports nothing for a merely-elevated (warn-tier) kerbal", () => {
    // Same danger-band-only threshold as the panel badge (`badge.ts`): a
    // warn-tier kerbal is already flagged by their own meter's colour.
    expect(
      rowTones(
        survival([
          kerbal({ name: "Bill Kerman", tone: "warn" }),
          kerbal({ name: "Bob Kerman", tone: "go" }),
        ]),
      ),
    ).toBeNull();
  });

  it("flags a single critical kerbal by name, as a severity", () => {
    expect(
      rowTones(
        survival([
          kerbal({ name: "Jebediah Kerman", tone: "nogo" }),
          kerbal({ name: "Bill Kerman", tone: "go" }),
        ]),
      ),
    ).toEqual([{ crewName: "Jebediah Kerman", severity: "critical" }]);
  });

  it("flags every critical kerbal, never the ones still nominal", () => {
    expect(
      rowTones(
        survival([
          kerbal({ name: "Jebediah Kerman", tone: "nogo" }),
          kerbal({ name: "Bill Kerman", tone: "nogo" }),
          kerbal({ name: "Bob Kerman", tone: "warn" }),
        ]),
      ),
    ).toEqual([
      { crewName: "Jebediah Kerman", severity: "critical" },
      { crewName: "Bill Kerman", severity: "critical" },
    ]);
  });
});
