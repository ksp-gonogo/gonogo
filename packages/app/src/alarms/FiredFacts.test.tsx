import { render } from "@ksp-gonogo/test-utils";
import { describe, expect, it } from "vitest";
import { FiredFacts, type FiredFactsProps } from "./FiredFacts";
import type { Alarm } from "./types";

const aboard: Alarm = {
  id: "burn",
  name: "Burn",
  trigger: { kind: "time", ut: 4000, leadSeconds: 0 },
  state: "fired",
  createdBy: "main",
  createdAt: 0,
  matchSinceUT: 4252,
  eventUT: 4000,
};

const commandVantage: Alarm = {
  id: "alt",
  name: "Above 70 km",
  trigger: {
    kind: "threshold",
    dataKey: "vessel.state.altitudeAsl",
    op: ">=",
    value: 70_000,
    sustainSeconds: 5,
  },
  state: "fired",
  createdBy: "main",
  createdAt: 0,
  matchSinceUT: 1000,
};

function textOf(overrides: Partial<FiredFactsProps>): string {
  const { container } = render(
    <FiredFacts
      alarm={aboard}
      warpRate={1}
      owltSeconds={252}
      noPath={false}
      scet={{ frame: "scet" }}
      received={{ frame: "received", vantage: "Kerbal Space Center" }}
      {...overrides}
    />,
  );
  return container.textContent ?? "";
}

describe("FiredFacts", () => {
  it("names the craft-clock instant, the stopped warp and how far behind the readings are", () => {
    const text = textOf({});

    expect(text).toContain("SCET");
    expect(text).toContain("Warp stopped.");
    expect(text).toContain(
      "Your readings are 4min 12s behind the craft and do not show this yet.",
    );
  });

  it("says nothing reflects the craft when there is no path at all, instead of a delay", () => {
    const text = textOf({ noPath: true });

    expect(text).toContain(
      "No signal: nothing on this screen reflects the craft's state at the moment this fired.",
    );
    expect(text).not.toContain("behind the craft");
  });

  it("claims no stopped warp while the game is still warping", () => {
    expect(textOf({ warpRate: 1000 })).not.toContain("Warp stopped.");
  });

  it("says nothing about a gap for an alarm judged against this screen's own readings", () => {
    const text = textOf({ alarm: commandVantage });

    expect(text).not.toContain("behind the craft");
    expect(text).not.toContain("No signal");
  });

  it("says nothing about a gap under a second of light time", () => {
    expect(textOf({ owltSeconds: 0.2 })).not.toContain("behind the craft");
  });
});
