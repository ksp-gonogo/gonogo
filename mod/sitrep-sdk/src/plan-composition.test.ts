import { describe, expect, it } from "vitest";
import {
  type ComposedPlan,
  SEND_PLAN_COMMAND,
  sendRefusalFromError,
  whyNotSendable,
} from "./plan-composition";
import { value } from "./unit-system/value";

function plan(observedAt: number): ComposedPlan {
  return { burns: [], observedAt: value("ut", observedAt) };
}

describe("sending a plan composed at a command centre", () => {
  it("sends under the engine's own command name", () => {
    // The name is the contract. A widget that guessed it would dispatch into
    // nothing and get a silence indistinguishable from a refusal.
    expect(SEND_PLAN_COMMAND).toBe("vessel.maneuver.plan.send");
  });

  it("refuses a plan built from a state later than the view it was composed at", () => {
    // The delay model inverted: the caller planned against something it could
    // not have seen from here. Caught at the site that made the mistake rather
    // than a light-time later.
    expect(whyNotSendable(plan(1200), 1000)).toMatch(/cannot have been seen/i);
  });

  it("allows a plan built from a state the view could actually have seen", () => {
    // The ordinary case: the information is older than the moment of deciding,
    // which is what a delayed link means.
    expect(whyNotSendable(plan(800), 1000)).toBeUndefined();
  });

  it("allows the boundary case where the state is exactly as old as the view", () => {
    // A vantage with no delay at all. Refusing this would make the zero-delay
    // case unusable, and zero delay is the ordinary state on the pad.
    expect(whyNotSendable(plan(1000), 1000)).toBeUndefined();
  });

  it("refuses when no view clock is mounted rather than stamping a guess", () => {
    // An unstamped composition instant would make the divergence measured
    // against it later meaningless while still producing a number.
    expect(whyNotSendable(plan(800), undefined)).toMatch(/no view clock/i);
  });

  it("keeps a message that never left apart from a plan the craft declined", () => {
    // One is a network fact and the other a mission fact. Showing the second
    // for the first would have an operator believe their craft rejected a plan
    // it never saw. Tested on the mapping directly, because producing a real
    // transport failure here would mean mocking the transport.
    const failed = sendRefusalFromError(new Error("socket closed"));

    expect(failed.accepted).toBe(false);
    expect(failed.refusal).toMatch(/did not reach the game/i);
    expect(failed.refusal).toMatch(/socket closed/);
  });

  it("says something useful even when the failure is not an Error", () => {
    const failed = sendRefusalFromError("just a string");

    expect(failed.accepted).toBe(false);
    expect(failed.refusal).toBeTruthy();
  });

  it("treats an empty burn list as sendable, because clearing a plan is an instruction", () => {
    // Distinct from a missing list, which the engine refuses. If this were
    // blocked here an operator could never clear a plan from a command centre.
    expect(whyNotSendable(plan(800), 1000)).toBeUndefined();
  });
});
