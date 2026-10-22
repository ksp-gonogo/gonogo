import { type CurrentOrbit, circularizeAtApo } from "@ksp-gonogo/core";
import { value } from "@ksp-gonogo/sitrep-sdk";
import { render, screen } from "@ksp-gonogo/test-utils";
import { NULL_DISPLAY } from "@ksp-gonogo/ui-kit";
import { describe, expect, it } from "vitest";
import { ManeuverPreview, type ManeuverPreviewProps } from "./ManeuverPreview";

const MU = 3.5316e12;
const CURRENT: CurrentOrbit = {
  sma: 700_000,
  eccentricity: 0.0001,
  ApR: 700_070,
  PeR: 699_930,
  timeToAp: value("s", 1345),
  timeToPe: value("s", 4000),
};
const NOW = value("ut", 90_000);

function preview(over: Partial<ManeuverPreviewProps>) {
  const plan = circularizeAtApo(CURRENT, MU, NOW);
  render(
    <ManeuverPreview
      plan={plan}
      currentOrbit={CURRENT}
      body={undefined}
      preset="circularize-apo"
      burnTrueAnomaly={null}
      currentTrajectory={null}
      diagram={{
        sma: undefined,
        ecc: undefined,
        ApR: undefined,
        PeR: undefined,
        trueAnomaly: undefined,
        argPe: undefined,
      }}
      prograde={0}
      radial={0}
      normal={0}
      setPrograde={() => {}}
      setRadial={() => {}}
      availableDeltaV={null}
      orbitMarking={null}
      planMarking={null}
      feasible={null}
      requiredDeltaV={plan.requiredDeltaV}
      currentUT={NOW}
      error={null}
      committing={false}
      sendDelay={{ kind: "none" } as never}
      triggerEditorOpen={false}
      setTriggerEditorOpen={() => {}}
      numericKeys={[]}
      onCommit={() => {}}
      onArm={() => {}}
      {...over}
    />,
  );
}

function burnInValue(): string | null {
  return screen.getByText("Burn in").nextElementSibling?.textContent ?? null;
}

describe("Maneuver preview where the apsis is not defined", () => {
  it("shows a countdown to the apsis while the samples agree on it", () => {
    preview({ apsisDefined: true });
    expect(burnInValue()).toContain("22");
  });

  it("shows a dash for the burn time when the samples scatter the apsis", () => {
    preview({ apsisDefined: false });
    expect(burnInValue()).toBe(NULL_DISPLAY);
  });

  it("keeps the preset: the burn size is still there", () => {
    preview({ apsisDefined: false });
    expect(screen.getByText("ΔV")).toBeInTheDocument();
  });

  it("does not dash a burn that is not placed at an apsis", () => {
    preview({ apsisDefined: false, preset: "custom-ut" });
    expect(burnInValue()).not.toBe(NULL_DISPLAY);
  });
});
