import {
  type BandKind,
  type Reading,
  type Value,
  value,
} from "@ksp-gonogo/sitrep-sdk";
import { describe, expect, it } from "vitest";
import { bandBadges, survivalBadges } from "./badge";
import type { CrewSurvival, KerbalSurvival } from "./processor";
import { ruleKey } from "./ruleReadings";

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

/** One rule's figure, observed, with the crew model's interval around it. */
function banded(
  figure: number,
  lo: number,
  hi: number,
  kind: BandKind = "sigma1",
): Reading<Value<"ratio">> {
  return {
    state: "observed",
    value: value("ratio", figure),
    atUt: value("ut", 100),
    reckoning: {
      status: "available",
      modelled: value("ratio", figure),
      basis: "rate-integration",
      band: {
        value: value("ratio", figure),
        lo: value("ratio", lo),
        hi: value("ratio", hi),
        kind,
      },
    },
  };
}

function bandless(figure: number): Reading<Value<"ratio">> {
  return {
    state: "observed",
    value: value("ratio", figure),
    atUt: value("ut", 100),
    reckoning: { status: "none" },
  };
}

describe("bandBadges", () => {
  it("flags a kerbal whose model interval reaches critical while the figure does not", () => {
    expect(
      bandBadges(
        { [ruleKey("Jebediah Kerman", "hunger")]: banded(0.6, 0.45, 0.85) },
        survival([kerbal({ name: "Jebediah Kerman", tone: "warn" })]),
      ),
    ).toEqual([
      {
        id: "crew-survival-band",
        label: "Crew critical in model range",
        tone: "warn",
      },
    ]);
  });

  it("says nothing when the interval is clear of critical", () => {
    // The control: the same kerbal, the same figure, a band that stops short.
    expect(
      bandBadges(
        { [ruleKey("Jebediah Kerman", "hunger")]: banded(0.6, 0.45, 0.75) },
        survival([kerbal({ name: "Jebediah Kerman", tone: "warn" })]),
      ),
    ).toBeNull();
  });

  it("says nothing for a rule the model does not band", () => {
    /* No band is not a band that is comfortably clear, so it may not read as one
       either way: no badge, and not the same answer as a clear band by accident
       of the figure. */
    expect(
      bandBadges(
        { [ruleKey("Jebediah Kerman", "hunger")]: bandless(0.79) },
        survival([kerbal({ name: "Jebediah Kerman", tone: "warn" })]),
      ),
    ).toBeNull();
  });

  it("leaves a kerbal already critical to the critical badge", () => {
    /* Critical by the death clock while every figure is below the line: the
       header already says "Crew critical", so a second, weaker badge about the
       same kerbal would only dilute it. */
    expect(
      bandBadges(
        { [ruleKey("Jebediah Kerman", "hunger")]: banded(0.6, 0.45, 0.85) },
        survival([
          kerbal({ name: "Jebediah Kerman", tone: "nogo", deathClockSec: 300 }),
        ]),
      ),
    ).toBeNull();
  });

  it("leaves a figure already at critical to the critical badge", () => {
    expect(
      bandBadges(
        { [ruleKey("Jebediah Kerman", "hunger")]: banded(0.82, 0.7, 0.95) },
        survival([kerbal({ name: "Jebediah Kerman", tone: "warn" })]),
      ),
    ).toBeNull();
  });

  it("counts kerbals, not rules", () => {
    expect(
      bandBadges(
        {
          [ruleKey("Jebediah Kerman", "hunger")]: banded(0.6, 0.45, 0.85),
          [ruleKey("Jebediah Kerman", "thirst")]: banded(0.65, 0.5, 0.9),
          [ruleKey("Bill Kerman", "stress")]: banded(0.55, 0.4, 0.81, "bound"),
        },
        survival([
          kerbal({ name: "Jebediah Kerman", tone: "warn" }),
          kerbal({ name: "Bill Kerman", tone: "warn" }),
        ]),
      ),
    ).toEqual([
      {
        id: "crew-survival-band",
        label: "2 crew critical in model range",
        tone: "warn",
      },
    ]);
  });

  it("shows nothing before any reading arrives", () => {
    expect(bandBadges(undefined, undefined)).toBeNull();
  });
});
