import { afterEach, describe, expect, it } from "vitest";
import { CommandErrorCode } from "../__generated__/contract";
import { createTestTelemetryClient } from "../testing/create-test-telemetry-client";
import { StubTransport } from "../testing/stub-transport";
import { value } from "../unit-system";
import { arrivalUtOf, arrivesTooLate } from "./arrival-deadline";
import {
  dispatchActiveCommandTopic,
  setActiveTelemetryClientForTests,
  setActiveViewClockForTests,
} from "./context";

/** A ground present of 1000 with 240 s of light time: a command sent now lands at 1240. */
const CLOCK = {
  viewUt: () => 760,
  scetUt: () => 1_000,
  commandArrivalUt: (scetUt: number) => scetUt + 240,
};

describe("a command's own arrival deadline", () => {
  it("measures arrival as the send time plus the one-way light time", () => {
    expect(arrivalUtOf(CLOCK, true)).toBe(1_240);
    expect(arrivalUtOf(CLOCK, false)).toBe(1_000);
  });

  it("refuses a node that lands at or after its UT, and nothing before it", () => {
    expect(arrivesTooLate("vessel.maneuver.add", { ut: 1_239 }, 1_240)).toBe(
      true,
    );
    expect(arrivesTooLate("vessel.maneuver.add", { ut: 1_240 }, 1_240)).toBe(
      true,
    );
    expect(arrivesTooLate("vessel.maneuver.add", { ut: 1_241 }, 1_240)).toBe(
      false,
    );
  });

  it("reads the UT whether it was written bare or as a Value", () => {
    expect(
      arrivesTooLate("vessel.maneuver.update", { ut: value("ut", 900) }, 1_240),
    ).toBe(true);
  });

  it("judges nothing for a command with no deadline, args without it, or an unknown arrival", () => {
    expect(arrivesTooLate("vessel.control.stage", { ut: 0 }, 1_240)).toBe(
      false,
    );
    expect(
      arrivesTooLate("vessel.maneuver.update", { nodeId: "n" }, 1_240),
    ).toBe(false);
    expect(arrivesTooLate("vessel.maneuver.add", { ut: 0 }, undefined)).toBe(
      false,
    );
  });
});

describe("dispatchActiveCommandTopic under the arrival deadline", () => {
  afterEach(() => {
    setActiveTelemetryClientForTests(undefined);
    setActiveViewClockForTests(undefined);
  });

  it("refuses a late node without putting it on the wire", async () => {
    const transport = new StubTransport();
    setActiveTelemetryClientForTests(createTestTelemetryClient(transport));
    setActiveViewClockForTests(CLOCK);

    const outcome = dispatchActiveCommandTopic("vessel.maneuver.add", {
      ut: 1_100,
      prograde: 10,
      normal: 0,
      radialOut: 0,
    });

    expect(outcome.routed).toBe(true);
    const refusal = outcome.routed ? await outcome.settled : undefined;
    expect(refusal?.errorCode).toBe(CommandErrorCode.Range);
    expect(transport.sentCommands).toHaveLength(0);
  });

  it("sends a node that lands in time", () => {
    const transport = new StubTransport();
    setActiveTelemetryClientForTests(createTestTelemetryClient(transport));
    setActiveViewClockForTests(CLOCK);

    dispatchActiveCommandTopic("vessel.maneuver.add", {
      ut: 1_300,
      prograde: 10,
      normal: 0,
      radialOut: 0,
    });

    expect(transport.sentCommands).toHaveLength(1);
  });
});
