import { value } from "@ksp-gonogo/sitrep-sdk";
import { describe, expect, it } from "vitest";
import type { PendingEntry } from "./command-delay";
import { deriveExpectations } from "./control-expectation";

/**
 * Class C: an expectation, never a state and never a denial.
 *
 * The delay geometry throughout: a command dispatched at UT 100 with a 20 s
 * one-way delay reaches the craft at 120 and its echo is due back at 140.
 */

const ONE_WAY = 20;
const DISPATCHED_AT = 100;
const REACH_UT = DISPATCHED_AT + ONE_WAY; // 120
const ECHO_DUE_UT = DISPATCHED_AT + 2 * ONE_WAY; // 140

function pending(overrides: Partial<PendingEntry> = {}): PendingEntry {
  return {
    id: "c1",
    command: "vessel.control.setSasMode",
    label: "",
    topic: "",
    vantage: "KSC",
    dispatchedAt: value("ut", DISPATCHED_AT),
    oneWaySeconds: value("s", ONE_WAY),
    commandedValue: 3,
    ...overrides,
  };
}

describe("the phases of an in-flight control command", () => {
  it("is in transit before it could have arrived", () => {
    const [expectation] = deriveExpectations({
      entries: [pending()],
      nowUt: REACH_UT - 1,
    });
    expect(expectation.phase).toBe("in-transit");
    expect(expectation.reachUt).toBe(REACH_UT);
    expect(expectation.echoDueUt).toBe(ECHO_DUE_UT);
  });

  it("is awaiting the echo between arrival and the reply being due", () => {
    expect(
      deriveExpectations({ entries: [pending()], nowUt: REACH_UT + 1 })[0]
        .phase,
    ).toBe("awaiting-echo");
  });

  it("is UNCONFIRMED once the reply is overdue, never assumed failed", () => {
    // The correction that matters. Silence is not evidence: the Courier checks
    // reachability once at dispatch and never again, so a command sent before a
    // blackout still executes and it is the reply that is lost. Asserting
    // non-execution is as false as asserting execution.
    expect(
      deriveExpectations({ entries: [pending()], nowUt: ECHO_DUE_UT + 60 })[0]
        .phase,
    ).toBe("unconfirmed");
  });

  it("is LOST when the path demonstrably broke across the window", () => {
    // Evidence of absence rather than absence of evidence, and a genuinely
    // different state from unconfirmed: the operator's next move differs.
    expect(
      deriveExpectations({
        entries: [pending()],
        nowUt: ECHO_DUE_UT + 60,
        pathConnectedDuring: () => false,
      })[0].phase,
    ).toBe("lost");
  });

  it("prefers LOST over waiting, because the fate is known to be unknowable", () => {
    expect(
      deriveExpectations({
        entries: [pending()],
        nowUt: REACH_UT + 1,
        pathConnectedDuring: () => false,
      })[0].phase,
    ).toBe("lost");
  });
});

describe("what settles an expectation", () => {
  it("collapses to confirmed on an observation taken AFTER arrival that agrees", () => {
    const [expectation] = deriveExpectations({
      entries: [pending()],
      nowUt: ECHO_DUE_UT + 1,
      observed: {
        "vessel.control.sasMode": { value: 3, asOfUt: REACH_UT + 5 },
      },
    });
    expect(expectation.phase).toBe("confirmed");
  });

  it("collapses to contradicted when that observation disagrees", () => {
    // The negative half, which only `hasDeviation` did before and only for the
    // continuous axes. A command that arrived and did not take effect (no power,
    // no probe core) has to be visible as such.
    const [expectation] = deriveExpectations({
      entries: [pending()],
      nowUt: ECHO_DUE_UT + 1,
      observed: {
        "vessel.control.sasMode": { value: 0, asOfUt: REACH_UT + 5 },
      },
    });
    expect(expectation.phase).toBe("contradicted");
  });

  it("ignores an observation stamped BEFORE the command could have arrived", () => {
    // The sharpest of the amendments. Under delay the client keeps receiving
    // samples stamped before arrival for a full one-way period, so "collapses
    // when a real observation arrives" would collapse every expectation on its
    // very next frame. The trigger is the sample's UT against arrival.
    const [expectation] = deriveExpectations({
      entries: [pending()],
      nowUt: REACH_UT + 1,
      observed: {
        "vessel.control.sasMode": { value: 0, asOfUt: REACH_UT - 1 },
      },
    });
    expect(expectation.phase).toBe("awaiting-echo");
  });

  it("does not treat a settling observation as evidence the path held", () => {
    // An echo that came back IS the path holding, so a confirmed reading must
    // outrank the connectivity predicate rather than the other way round.
    const [expectation] = deriveExpectations({
      entries: [pending()],
      nowUt: ECHO_DUE_UT + 1,
      pathConnectedDuring: () => false,
      observed: {
        "vessel.control.sasMode": { value: 3, asOfUt: REACH_UT + 5 },
      },
    });
    expect(expectation.phase).toBe("confirmed");
  });

  it("compares a commanded axis with a tolerance, so a round trip is not a contradiction", () => {
    const [expectation] = deriveExpectations({
      entries: [
        pending({
          command: "vessel.control.setThrottle",
          commandedValue: 0.65,
        }),
      ],
      nowUt: ECHO_DUE_UT + 1,
      observed: {
        "vessel.control.throttle": {
          value: 0.65 + 1e-9,
          asOfUt: REACH_UT + 5,
        },
      },
    });
    expect(expectation.phase).toBe("confirmed");
  });
});

describe("what it carries, and what it refuses to carry", () => {
  it("names the read field, so a renderer can mark out one control in a group", () => {
    const [expectation] = deriveExpectations({
      entries: [pending()],
      nowUt: REACH_UT - 1,
    });
    expect(expectation.readTopic).toBe("vessel.control");
    expect(expectation.readField).toBe("sasMode");
    expect(expectation.channelId).toBe("vessel.control.sasMode");
    expect(expectation.expected).toBe(3);
  });

  it("carries a switch as the scalar the wire sent", () => {
    const [expectation] = deriveExpectations({
      entries: [
        pending({ command: "vessel.control.setGear", commandedValue: 1 }),
      ],
      nowUt: REACH_UT - 1,
    });
    expect(expectation.readField).toBe("gear");
    expect(expectation.expected).toBe(1);
  });

  it("yields nothing for a command with no read field to expect anything of", () => {
    // `vessel.control.stage` and a maneuver removal have no observable field, so
    // neither "renders distinctly against the observed value" nor "collapses on
    // observation" has a referent. Those belong on the command-lifecycle chip.
    expect(
      deriveExpectations({
        entries: [pending({ command: "vessel.control.stage" })],
        nowUt: REACH_UT - 1,
      }),
    ).toEqual([]);
  });

  it("still tracks a dispatch whose value never reached the wire", () => {
    // A pre-CommandedValue server, or a channel command dispatched without its
    // value key. The phases still mean something ("something is in flight");
    // only the comparison cannot run, so it can never read as confirmed.
    const [expectation] = deriveExpectations({
      entries: [pending({ commandedValue: undefined })],
      nowUt: ECHO_DUE_UT + 1,
      observed: {
        "vessel.control.sasMode": { value: 3, asOfUt: REACH_UT + 5 },
      },
    });
    expect(expectation.expected).toBeUndefined();
    expect(expectation.phase).toBe("contradicted");
  });

  it("tracks several in-flight commands independently", () => {
    const expectations = deriveExpectations({
      entries: [
        pending({ id: "c1", command: "vessel.control.setGear" }),
        pending({ id: "c2", command: "vessel.control.setLights" }),
      ],
      nowUt: REACH_UT - 1,
    });
    expect(expectations.map((e) => e.readField)).toEqual(["gear", "lights"]);
  });
});
