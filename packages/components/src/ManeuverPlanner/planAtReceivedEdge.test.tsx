import { act, renderHook, waitFor } from "@ksp-gonogo/test-utils";
import { describe, expect, it } from "vitest";
import { ANALYTIC_UNBOUNDED_HORIZON } from "../test/orbitHorizon";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { usePlan } from "./usePlan";
import type { PlannerInputs } from "./usePlannerInputs";
import { usePlannerTelemetry } from "./usePlannerTelemetry";

/** The craft's present, and the light-time a command crosses to reach it. */
const UT_NOW = 1_000_000;
const OWLT = 240;

const BURN_IN_60: PlannerInputs = {
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
};

describe("ManeuverPlanner under signal delay", () => {
  it("counts a relative burn from the received edge, never from when the command lands", async () => {
    const fixture = setupStreamFixture({
      delaySeconds: OWLT,
      suspendFrames: true,
    });
    const { result } = renderHook(
      () => usePlan(BURN_IN_60, usePlannerTelemetry()),
      { wrapper: fixture.Provider },
    );
    const meta = { validAt: UT_NOW - OWLT, deliveredAt: UT_NOW };
    act(() => {
      fixture.emit(
        "system.bodies",
        { bodies: [{ index: 1, name: "Kerbin", radius: 600_000 }] },
        meta,
      );
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
    await waitFor(() => expect(result.current.plan).not.toBeNull());
    const plan = result.current.plan;
    const ut = plan && "ut" in plan ? plan.ut : undefined;
    expect(ut).toBeCloseTo(UT_NOW - OWLT + 60, 0);
  });
});
