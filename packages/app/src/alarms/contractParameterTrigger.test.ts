import type { CareerContract } from "@ksp-gonogo/sitrep-sdk";
import { describe, expect, it } from "vitest";
import { AlarmStateMachine } from "./AlarmStateMachine";
import type { Alarm, ContractParameterTrigger } from "./types";

/**
 * A contract-parameter alarm's matching rule.
 *
 * The trigger's job is to fire when one objective of one contract reaches the
 * state the operator armed it on. It used to do that by comparing the wire's
 * `state` STRING against the word saved in the alarm, and `ParameterState` is
 * KSP's enum: rename `Complete` and the comparison silently never matches, so
 * the alarm never fires. Nothing throws and nothing warns, and an alarm that
 * does not go off is indistinguishable from an alarm whose condition has not
 * happened yet. That is the worst failure available to an alarm, so it gets its
 * own file rather than a line in an existing one.
 *
 * Feeds the contract list through `AlarmStateMachine`'s injected reader, the
 * same seam its alarms, clock and event readers already use. Nothing is mocked.
 */

/**
 * One active contract with one objective, plus a second objective so a matcher
 * that ignored the title and answered off the first row would be caught.
 *
 * `state` and `stateOrdinal` are passed separately on purpose: every test here
 * turns on the two DISAGREEING.
 */
function contracts(parameter: {
  state: string;
  stateOrdinal?: number;
}): CareerContract[] {
  return [
    {
      id: "42",
      title: "Plant a flag on the Mun",
      parameters: [
        { title: "Reach orbit around Kerbin", ...parameter },
        { title: "Return to Kerbin", state: "Incomplete", stateOrdinal: 0 },
      ],
    } as unknown as CareerContract,
  ];
}

function contractAlarm(
  targetState: ContractParameterTrigger["targetState"],
): Alarm {
  return {
    id: "a1",
    name: "Objective alarm",
    trigger: {
      kind: "contract-parameter",
      contractId: 42,
      parameterTitle: "Reach orbit around Kerbin",
      targetState,
      sustainSeconds: 0,
    },
    state: "pending",
    createdBy: "main",
    createdAt: 0,
    matchSinceUT: null,
  };
}

describe("contract-parameter alarm trigger", () => {
  /**
   * One host-style tick: latch the match, then read the state.
   *
   * Both halves are needed and the split is the class's own: `deriveState` reads
   * `matchSinceUT` and never evaluates the trigger, so calling it alone reports
   * "pending" for everything, which would have made every negative case here
   * pass for no reason. Latching at 100 and reading at 103 clears the 2-second
   * "firing" banner window, so a match settles to the "fired" an operator would
   * still see in the list.
   */
  function tick(alarm: Alarm, active: CareerContract[]): Alarm["state"] {
    const sm = new AlarmStateMachine(
      () => [alarm],
      () => 100,
      () => [],
      () => active,
    );
    sm.updateContractParameterTracking(alarm, 100);
    return sm.deriveState(alarm, 103);
  }

  it("fires when the objective reaches the armed state", () => {
    const alarm = contractAlarm("Complete");
    expect(tick(alarm, contracts({ state: "Complete", stateOrdinal: 1 }))).toBe(
      "fired",
    );
  });

  it("stays pending while the objective is outstanding", () => {
    const alarm = contractAlarm("Complete");
    expect(
      tick(alarm, contracts({ state: "Incomplete", stateOrdinal: 0 })),
    ).toBe("pending");
  });

  /**
   * The defect. A future KSP renaming `ParameterState.Complete` changes the name
   * on the wire and not the ordinal, and the operator's alarm still says
   * "Complete" because that word is ours and lives in their saved alarms. Under
   * the old string comparison this alarm sat pending forever on a contract
   * objective that had been finished.
   */
  it("fires on the ordinal even when KSP's name for the state is one we have never seen", () => {
    const alarm = contractAlarm("Complete");
    expect(tick(alarm, contracts({ state: "Achieved", stateOrdinal: 1 }))).toBe(
      "fired",
    );
  });

  /**
   * The same defect in the other direction, and why the fix is not "compare more
   * loosely". A name that happens to read "Complete" while the ordinal says the
   * objective FAILED must not fire a Complete alarm, and must fire a Failed one.
   */
  it("does not fire a Complete alarm on an objective whose ordinal says Failed", () => {
    const failedRows = contracts({ state: "Complete", stateOrdinal: 2 });
    expect(tick(contractAlarm("Complete"), failedRows)).toBe("pending");
    expect(tick(contractAlarm("Failed"), failedRows)).toBe("fired");
  });

  /**
   * No ordinal at all is not a match. An alarm must not fire on a state nobody
   * has told us, and must not fall back to the NAME as a consolation: firing is
   * a claim that the condition happened.
   */
  it("does not fire when the objective carries no ordinal", () => {
    const alarm = contractAlarm("Complete");
    expect(tick(alarm, contracts({ state: "Complete" }))).toBe("pending");
  });

  /** No contract list at all, and no contract matching the id. */
  it("stays pending when the contract is not in the active list", () => {
    expect(tick(contractAlarm("Complete"), [])).toBe("pending");
  });
});
