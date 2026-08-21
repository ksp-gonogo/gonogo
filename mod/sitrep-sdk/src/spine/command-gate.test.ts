import { describe, expect, it } from "vitest";
import type { CommandGateReport } from "../__generated__/contract";
import { CommandErrorCode, GateOutcome } from "../__generated__/contract";
import { selectCommandGate } from "./command-gate";

function report(
  ...gates: {
    command: string;
    outcome: GateOutcome;
    errorCode?: CommandErrorCode;
    detail?: string;
  }[]
): CommandGateReport {
  return {
    gates: gates.map((g) => ({
      command: g.command,
      verdict: {
        outcome: g.outcome,
        errorCode: g.errorCode ?? CommandErrorCode.ModeUnavailable,
        detail: g.detail ?? "",
      },
    })),
  };
}

describe("selectCommandGate", () => {
  it("blocks on a Fail and carries the game's own words", () => {
    const gate = selectCommandGate(
      report({
        command: "flight.launch",
        outcome: GateOutcome.Fail,
        errorCode: CommandErrorCode.SiteOccupied,
        detail: "Launch Pad is occupied",
      }),
      "flight.launch",
    );

    expect(gate).toEqual({
      command: "flight.launch",
      blocked: true,
      undetermined: false,
      errorCode: CommandErrorCode.SiteOccupied,
      breach: undefined,
      detail: "Launch Pad is occupied",
    });
  });

  it("does not block on a Pass", () => {
    const gate = selectCommandGate(
      report({ command: "flight.launch", outcome: GateOutcome.Pass }),
      "flight.launch",
    );

    expect(gate?.blocked).toBe(false);
  });

  it("does NOT block on an Unknown: an absent authority is not the game saying no", () => {
    // The case that forces the distinction. `ScenarioUpgradeableFacilities` is
    // a career/mission-only [KSPScenario], so its Instance is null in a SANDBOX
    // save and every facility gate answers Unknown there. Collapsing that into
    // `blocked` would black out working controls in every sandbox game and
    // explain it in the game's own voice, permanently. Unknown still refuses at
    // DISPATCH, which is a rule about acting, not a licence to render a false
    // certainty in advance.
    const gate = selectCommandGate(
      report({
        command: "career.tech.unlock",
        outcome: GateOutcome.Unknown,
        detail: "the facilities scenario is not loaded",
      }),
      "career.tech.unlock",
    );

    expect(gate?.blocked).toBe(false);
    expect(gate?.undetermined).toBe(true);
    // Still says why, for a diagnostic surface: the point is not to lose the
    // information, it is not to draw it as a refusal.
    expect(gate?.detail).toBe("the facilities scenario is not loaded");
  });

  it("tells an evaluated no apart from an unevaluable gate", () => {
    const both = report(
      {
        command: "a.fail",
        outcome: GateOutcome.Fail,
        detail: "Launch Pad is occupied",
      },
      {
        command: "b.unknown",
        outcome: GateOutcome.Unknown,
        detail: "the facilities scenario is not loaded",
      },
    );

    expect(selectCommandGate(both, "a.fail")).toMatchObject({
      blocked: true,
      undetermined: false,
    });
    expect(selectCommandGate(both, "b.unknown")).toMatchObject({
      blocked: false,
      undetermined: true,
    });
  });

  it("does not block on an Abstain: the answer depends on the arguments", () => {
    const gate = selectCommandGate(
      report({ command: "flight.launch", outcome: GateOutcome.Abstain }),
      "flight.launch",
    );

    expect(gate?.blocked).toBe(false);
    expect(gate?.undetermined).toBe(false);
  });

  it("answers undefined for a command with no entry, so an ungated control is untouched", () => {
    expect(
      selectCommandGate(
        report({ command: "flight.launch", outcome: GateOutcome.Fail }),
        "career.crew.hire",
      ),
    ).toBeUndefined();
  });

  it("answers undefined with no report at all, so a disconnected client degrades to the old behaviour", () => {
    expect(selectCommandGate(undefined, "flight.launch")).toBeUndefined();
  });

  it("carries the command id, since a reason with no subject names no control", () => {
    const gate = selectCommandGate(
      report({ command: "career.crew.hire", outcome: GateOutcome.Fail }),
      "career.crew.hire",
    );

    expect(gate?.command).toBe("career.crew.hire");
  });

  it("reports an empty detail as absent rather than as an empty sentence", () => {
    // The composer falls through to its own general wording on `undefined`;
    // an empty string would win the `??` and leave the reason blank.
    const gate = selectCommandGate(
      report({
        command: "flight.launch",
        outcome: GateOutcome.Fail,
        detail: "",
      }),
      "flight.launch",
    );

    expect(gate?.detail).toBeUndefined();
  });
});
