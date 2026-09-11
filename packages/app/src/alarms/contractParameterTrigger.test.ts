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
  sustainSeconds = 0,
): Alarm {
  return {
    id: "a1",
    name: "Objective alarm",
    trigger: {
      kind: "contract-parameter",
      contractId: 42,
      parameterTitle: "Reach orbit around Kerbin",
      targetState,
      sustainSeconds,
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

  /**
   * A read we could not make at all, held apart from a read that says no.
   *
   * `getContractsActive` answers a non-array whenever nothing has arrived on
   * `contracts.active` yet or the link is down, which is not the same claim as
   * an empty list: an empty list says the contract is gone, a non-array says
   * nobody asked. Collapsing the two published a failed read as the confident
   * fact "the condition just ended" and cleared the sustain latch, so a link
   * flapping faster than `sustainSeconds` never let the alarm fire at all.
   */
  describe("an unreadable contract list", () => {
    /**
     * A host-style tick loop over one alarm, with the contract list and the
     * clock both movable between ticks: the defect only shows across ticks,
     * so the single-tick helper above cannot reach it.
     */
    function machine(alarm: Alarm, source: () => unknown) {
      let ut = 0;
      const sm = new AlarmStateMachine(
        () => [alarm],
        () => ut,
        () => [],
        source as () => readonly CareerContract[] | undefined,
      );
      return {
        tick(at: number): Alarm["state"] {
          const previously = ut === 0 ? null : ut;
          ut = at;
          sm.updateContractParameterTracking(alarm, at, previously);
          return sm.deriveState(alarm, at, previously);
        },
      };
    }

    const matching = () => contracts({ state: "Complete", stateOrdinal: 1 });

    it("keeps the latch, and does not let the dark seconds pay into the sustain", () => {
      const alarm = contractAlarm("Complete", 10);
      let active: unknown = matching();
      const sm = machine(alarm, () => active);

      sm.tick(1000);
      expect(alarm.matchSinceUT).toBe(1000);

      // The stream goes dark. Nothing said the objective left the state, so
      // the latch survives; the seconds nobody watched slide it forward.
      active = undefined;
      expect(sm.tick(1004)).toBe("pending");
      expect(alarm.matchSinceUT).toBe(1004);

      // Back, still matching: the sustain resumes rather than restarting, and
      // the four dark seconds bought nothing.
      active = matching();
      expect(sm.tick(1008)).toBe("pending");
      expect(alarm.matchSinceUT).toBe(1004);

      expect(sm.tick(1014)).toBe("firing");
    });

    /**
     * The other half, and why a naive hold is not the fix either: an alarm
     * must not come due on a sustain window nobody could see through.
     */
    it("does not fire on a blackout that spans the whole sustain window", () => {
      const alarm = contractAlarm("Complete", 10);
      let active: unknown = matching();
      const sm = machine(alarm, () => active);

      sm.tick(1000);
      active = undefined;
      expect(sm.tick(1100)).toBe("pending");
      expect(alarm.matchSinceUT).toBe(1100);
    });

    /**
     * An empty list is a real answer, not a failed read: the contract is no
     * longer active, so the condition genuinely ended and the latch clears.
     */
    it("still clears the latch when the contract leaves the active list", () => {
      const alarm = contractAlarm("Complete", 10);
      let active: unknown = matching();
      const sm = machine(alarm, () => active);

      sm.tick(1000);
      active = [];
      expect(sm.tick(1004)).toBe("pending");
      expect(alarm.matchSinceUT).toBeNull();
    });
  });
});
