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

  it("blocks on an Unknown, because Unknown REFUSES server-side", () => {
    // Not a hedge. `ChannelEngine.EvaluateGates` returns Unknown when a gate
    // cannot be read, and Unknown refuses the dispatch by design, so a control
    // that stayed live here would promise something the mod is certain to deny.
    const gate = selectCommandGate(
      report({
        command: "career.tech.unlock",
        outcome: GateOutcome.Unknown,
        detail: "the facilities scenario is not loaded",
      }),
      "career.tech.unlock",
    );

    expect(gate?.blocked).toBe(true);
    expect(gate?.detail).toBe("the facilities scenario is not loaded");
  });

  it("does not block on an Abstain: the answer depends on the arguments", () => {
    const gate = selectCommandGate(
      report({ command: "flight.launch", outcome: GateOutcome.Abstain }),
      "flight.launch",
    );

    expect(gate?.blocked).toBe(false);
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
