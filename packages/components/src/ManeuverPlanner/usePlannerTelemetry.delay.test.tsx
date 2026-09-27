import { Quality } from "@ksp-gonogo/sitrep-sdk";
import { act, renderHook, waitFor } from "@ksp-gonogo/test-utils";
import { describe, expect, it } from "vitest";
import { ANALYTIC_UNBOUNDED_HORIZON } from "../test/orbitHorizon";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { usePlannerTelemetry } from "./usePlannerTelemetry";

const UT_NOW = 1_000_000;
const OWLT = 240;

describe("usePlannerTelemetry under signal delay", () => {
  it("shows its figures at the received edge and plans at command arrival", async () => {
    const fixture = setupStreamFixture({
      carriedChannels: ["vessel.orbit"],
      delaySeconds: OWLT,
      suspendFrames: true,
    });
    const { result } = renderHook(() => usePlannerTelemetry(), {
      wrapper: fixture.Provider,
    });
    act(() => {
      fixture.emit(
        "vessel.orbit",
        {
          referenceBodyIndex: 1,
          sma: 700_000,
          ecc: 0,
          inc: 0,
          lan: 0,
          argPe: 0,
          meanAnomalyAtEpoch: 0,
          epoch: UT_NOW - OWLT,
          mu: 3.5316e12,
          horizon: ANALYTIC_UNBOUNDED_HORIZON,
        },
        {
          validAt: UT_NOW - OWLT,
          deliveredAt: UT_NOW,
          quality: Quality.OnRails,
        },
      );
      fixture.emitFrame();
    });
    await waitFor(() => expect(result.current.currentUT).toBeDefined());
    expect(result.current.currentUT).toBeCloseTo(UT_NOW - OWLT, 0);
    expect(result.current.planning.currentUT).toBeCloseTo(UT_NOW + OWLT, 0);
  });
});
