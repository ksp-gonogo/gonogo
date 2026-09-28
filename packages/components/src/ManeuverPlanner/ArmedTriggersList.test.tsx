import { CommandErrorCode } from "@ksp-gonogo/sitrep-sdk";
import { render, screen } from "@ksp-gonogo/sitrep-sdk/testing";
import { expectNoA11yViolations } from "@ksp-gonogo/ui-kit/testing";
import { describe, expect, it } from "vitest";
import { ArmedTriggersList } from "./ArmedTriggersList";
import { TRIGGER_NODE_LABEL } from "./triggerDispatch";
import type { ArmedTrigger } from "./triggerTypes";

const ARMED: ArmedTrigger = {
  id: "t1",
  dataKey: "vessel.orbit.sma",
  op: ">=",
  value: 700_000,
  inputs: {
    preset: "custom-ut",
    prograde: 10,
    normal: 0,
    radial: 0,
    burnInSeconds: 60,
    utMode: "relative",
    burnAtUT: 0,
    targetInclination: 0,
    targetAltitudeKm: 100,
    standoffMeters: 500,
  },
  vesselName: "Test Vessel",
  createdAt: 0,
  createdBy: "main",
};

const REFUSED: ArmedTrigger = {
  ...ARMED,
  id: "t2",
  refusals: [
    {
      id: "t2:0",
      command: "vessel.maneuver.add",
      args: { ut: 1_060, prograde: 10, normal: 0, radialOut: 0 },
      label: TRIGGER_NODE_LABEL,
      errorCode: CommandErrorCode.Range,
      detail: "it would reach the craft at or after the time it acts at",
    },
  ],
};

describe("ArmedTriggersList", () => {
  it("states a refused trigger's refusal on its own row, in the command's words", async () => {
    const { container } = render(
      <ArmedTriggersList triggers={[ARMED, REFUSED]} onCancel={() => {}} />,
    );
    expect(
      screen.getByText(
        "Add maneuver node refused: it would reach the craft at or after the time it acts at.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Dismiss refused trigger" }),
    ).toBeInTheDocument();
    await expectNoA11yViolations(container);
  });

  it("states no refusal for a trigger still armed", () => {
    render(<ArmedTriggersList triggers={[ARMED]} onCancel={() => {}} />);
    expect(screen.queryByText(/refused/)).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Cancel armed trigger" }),
    ).toBeInTheDocument();
  });
});
