import { DashboardItemContext, registerStockBodies } from "@ksp-gonogo/core";
import { Quality } from "@ksp-gonogo/sitrep-sdk";
import { act, render, waitFor } from "@ksp-gonogo/test-utils";
import { NULL_DISPLAY } from "@ksp-gonogo/ui-kit";
import { describe, expect, it } from "vitest";
import { ANALYTIC_UNBOUNDED_HORIZON } from "../test/orbitHorizon";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { CurrentOrbitComponent } from "./index";

/**
 * A hyperbolic orbit (`ecc >= 1`) has no countdown to a periapsis the view
 * can promise. The neighbouring `t-Ap`/period/Ap rows all carry an explicit
 * `hyperbolic ? NULL_DISPLAY` guard so the operator doesn't read a hyperbolic
 * flyby as an imminent event, and `t-Pe` carries the same guard: this test pins
 * that it renders the null-display placeholder, never a `0s` countdown.
 */
const CURRENT_ORBIT_CHANNELS = [
  "vessel.orbit",
  "vessel.identity",
  "system.bodies",
];

describe("CurrentOrbit: O1, t-Pe shows the null-display placeholder on a hyperbolic orbit", () => {
  it("renders t-Pe as NULL_DISPLAY (never a countdown) when ecc >= 1", async () => {
    registerStockBodies();
    const stream = setupStreamFixture({
      carriedChannels: CURRENT_ORBIT_CHANNELS,
      pinnedUt: 0,
      suspendFrames: true,
    });

    const { getByText } = render(
      <stream.Provider>
        <DashboardItemContext.Provider value={{ instanceId: "orbit-hyp" }}>
          {/* h >= 6 so the t-Ap / t-Pe progress rows render. */}
          <CurrentOrbitComponent config={{}} id="orbit-hyp" w={9} h={18} />
        </DashboardItemContext.Provider>
      </stream.Provider>,
    );

    act(() => {
      // A hyperbolic escape trajectory: ecc 1.4 (> 1), sma negative as KSP
      // reports for an open orbit. Drives `hyperbolic` true off vessel.orbit
      // and nulls the derived timeToPe.
      stream.emit(
        "vessel.orbit",
        {
          referenceBodyIndex: 1,
          sma: -500_000,
          ecc: 1.4,
          inc: 0,
          lan: 0,
          argPe: 0,
          meanAnomalyAtEpoch: 0,
          epoch: 0,
          mu: 3.5316e12,
          horizon: ANALYTIC_UNBOUNDED_HORIZON,
        },
        { quality: Quality.OnRails },
      );
      stream.emit("vessel.identity", {
        vesselId: "v1",
        name: "Escape Pod",
        vesselType: 0,
        situation: 1,
        parentBodyIndex: 1,
        launchUt: 0,
      });
      stream.emit("system.bodies", {
        bodies: [{ index: 1, name: "Kerbin", parentIndex: 0, radius: 600000 }],
      });
    });

    // The eccentricity readout confirms the hyperbolic orbit has landed.
    await waitFor(() => expect(getByText("1.4000")).toBeTruthy());

    // The Value cell directly follows its "t-Pe" Label in the grid.
    const tPeValue = getByText("t-Pe").nextElementSibling;
    expect(tPeValue?.textContent).toBe(NULL_DISPLAY);
  });
});
