import { describe, expect, it } from "vitest";
import { CONTRACTS_ACTIVE_TOPIC, topicEvaluatedBy } from "./AlarmTopicHolds";
import type { Alarm, AlarmState, AlarmTrigger } from "./types";

function alarm(trigger: AlarmTrigger, state: AlarmState = "pending"): Alarm {
  return {
    id: "a",
    name: "a",
    trigger,
    state,
    createdBy: "main",
    createdAt: 0,
  };
}

const altitude: AlarmTrigger = {
  kind: "threshold",
  dataKey: "vessel.flight.altitudeAsl",
  op: ">",
  value: 70_000,
  sustainSeconds: 0,
};

const contract: AlarmTrigger = {
  kind: "contract-parameter",
  contractId: 7,
  parameterTitle: "Reach orbit",
  targetState: "Complete",
  sustainSeconds: 0,
};

describe("topicEvaluatedBy", () => {
  it("holds a command-vantage threshold's Topic while it is armed", () => {
    expect(topicEvaluatedBy(alarm(altitude), false)).toBe(
      "vessel.flight.altitudeAsl",
    );
    expect(topicEvaluatedBy(alarm(altitude, "arming"), false)).toBe(
      "vessel.flight.altitudeAsl",
    );
  });

  it("holds the active contract list for a contract-parameter alarm", () => {
    expect(topicEvaluatedBy(alarm(contract), false)).toBe(
      CONTRACTS_ACTIVE_TOPIC,
    );
  });

  it("lets go once the alarm has fired", () => {
    expect(topicEvaluatedBy(alarm(altitude, "firing"), false)).toBeNull();
    expect(topicEvaluatedBy(alarm(altitude, "fired"), false)).toBeNull();
  });

  it("holds nothing for an alarm the mod latches", () => {
    expect(topicEvaluatedBy(alarm(altitude), true)).toBeNull();
    expect(topicEvaluatedBy(alarm(contract), true)).toBeNull();
  });

  it("holds nothing for an alarm the client does not evaluate off the stream", () => {
    expect(
      topicEvaluatedBy(
        alarm({ kind: "time", ut: 100, leadSeconds: 10 }),
        false,
      ),
    ).toBeNull();
    expect(
      topicEvaluatedBy(alarm({ kind: "event", topic: "flight.events" }), false),
    ).toBeNull();
  });
});
