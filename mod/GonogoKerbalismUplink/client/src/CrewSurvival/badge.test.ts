import { describe, expect, it } from "vitest";
import { survivalBadges } from "./badge";
import type { CrewSurvival, KerbalSurvival } from "./processor";

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

describe("survivalBadges", () => {
  it("shows no badge when the whole crew is fine, or there is no data", () => {
    expect(survivalBadges(survival([kerbal({ tone: "go" })]))).toBeNull();
    expect(survivalBadges(undefined)).toBeNull();
  });

  it("shows no badge for a merely-elevated (warn-tier) crew", () => {
    // The danger band only: a warn-tier kerbal is already flagged per-row by
    // the `.survival` meter's own colour, so the header stays quiet.
    expect(
      survivalBadges(
        survival([
          kerbal({ name: "Bill Kerman", tone: "warn" }),
          kerbal({ name: "Bob Kerman", tone: "go" }),
        ]),
      ),
    ).toBeNull();
  });

  it("flags a single critical kerbal at vessel level, never by name", () => {
    expect(
      survivalBadges(
        survival([
          kerbal({ name: "Jebediah Kerman", tone: "nogo" }),
          kerbal({ name: "Bill Kerman", tone: "go" }),
        ]),
      ),
    ).toEqual([
      { id: "crew-survival-status", label: "Crew critical", tone: "nogo" },
    ]);
  });

  it("counts multiple critical kerbals", () => {
    expect(
      survivalBadges(
        survival([
          kerbal({ name: "Jebediah Kerman", tone: "nogo" }),
          kerbal({ name: "Bill Kerman", tone: "nogo" }),
          kerbal({ name: "Bob Kerman", tone: "warn" }),
        ]),
      ),
    ).toEqual([
      { id: "crew-survival-status", label: "2 crew critical", tone: "nogo" },
    ]);
  });
});
