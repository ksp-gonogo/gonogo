import { act, renderHook, waitFor } from "@ksp-gonogo/test-utils";
import { describe, expect, it } from "vitest";
import { ANALYTIC_UNBOUNDED_HORIZON } from "../test/orbitHorizon";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { useNodeCommands } from "./useNodeCommands";
import { usePlan } from "./usePlan";
import type { PlannerInputs } from "./usePlannerInputs";
import { usePlannerTelemetry } from "./usePlannerTelemetry";

/** The craft's present, and the light time a command crosses to reach it. */
const UT_NOW = 1_000_000;
const OWLT = 240;

function burnIn(seconds: number): PlannerInputs {
  return {
    preset: "custom-ut",
    prograde: 10,
    normal: 0,
    radial: 0,
    burnInSeconds: seconds,
    utMode: "relative",
    burnAtUT: 0,
    targetInclination: 0,
    targetAltitudeKm: 100,
    standoffMeters: 500,
  };
}

function mountPlanner(inputs: PlannerInputs) {
  const fixture = setupStreamFixture({
    delaySeconds: OWLT,
    suspendFrames: true,
  });
  const view = renderHook(
    () => {
      const { plan } = usePlan(inputs, usePlannerTelemetry());
      return { plan, commands: useNodeCommands([], plan) };
    },
    { wrapper: fixture.Provider },
  );
  const meta = { validAt: UT_NOW - OWLT, deliveredAt: UT_NOW };
  act(() => {
    fixture.emit(
      "system.bodies",
      { bodies: [{ index: 1, name: "Kerbin", radius: 600_000 }] },
      meta,
    );
    fixture.emit("comms.delay", { source: 1, oneWaySeconds: OWLT }, meta);
    fixture.emit(
      "vessel.orbit",
      {
        referenceBodyIndex: 1,
        sma: 700_000,
        ecc: 0.01,
        inc: 0,
        lan: 0,
        argPe: 0,
        meanAnomalyAtEpoch: 0,
        epoch: UT_NOW - OWLT,
        mu: 3.5316e12,
        horizon: ANALYTIC_UNBOUNDED_HORIZON,
      },
      meta,
    );
    fixture.emitFrame();
  });
  return { fixture, ...view };
}

function addedNodes(fixture: ReturnType<typeof mountPlanner>["fixture"]) {
  return fixture.transport.sentCommands.filter(
    (sent) => sent.command === "vessel.maneuver.add",
  );
}

describe("sending a maneuver plan under signal delay", () => {
  it("states the one-way light time the node crosses", async () => {
    const { result } = mountPlanner(burnIn(1_000));
    await waitFor(() =>
      expect(result.current.commands.sendDelay.oneWaySeconds).toBe(OWLT),
    );
    expect(result.current.commands.sendDelay.reading?.state).toBe("observed");
  });

  it("refuses a node that would reach the craft after its own time, and sends nothing", async () => {
    const { fixture, result } = mountPlanner(burnIn(60));
    await waitFor(() => expect(result.current.plan).not.toBeNull());

    await act(async () => {
      await result.current.commands.handleCommit();
    });

    expect(addedNodes(fixture)).toHaveLength(0);
    expect(result.current.commands.error).toMatch(
      /would reach the craft at or after the time it acts at/,
    );
  });

  it("sends a node that lands before its own time, with no margin asked beyond that", async () => {
    const { fixture, result } = mountPlanner(burnIn(1_000));
    await waitFor(() => expect(result.current.plan).not.toBeNull());

    await act(async () => {
      void result.current.commands.handleCommit();
    });

    await waitFor(() => expect(addedNodes(fixture)).toHaveLength(1));
  });
});
