import { DashboardItemContext, registerStockBodies } from "@ksp-gonogo/core";
import { Quality } from "@ksp-gonogo/sitrep-sdk";
import { act, render, waitFor } from "@ksp-gonogo/test-utils";
import { NULL_DISPLAY } from "@ksp-gonogo/ui-kit";
import { describe, expect, it } from "vitest";
import { ANALYTIC_UNBOUNDED_HORIZON } from "../test/orbitHorizon";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { CurrentOrbitComponent } from "./index";

/**
 * Producer↔consumer disagreement **O1**
 * (`docs/superpowers/specs/2026-07-24-producer-consumer-disagreements.md`).
 *
 * On a hyperbolic orbit (`ecc >= 1`) the mod's derived `vessel.state.timeToPe`
 * degrades to `null` (the elliptical kepler solver can't propagate an open
 * trajectory: `vessel-state.ts`), and the legacy Telemachus path emitted a
 * `0` sentinel. The neighbouring `t-Ap`/period/Ap rows all carry an explicit
 * `hyperbolic ? NULL_DISPLAY` guard so the operator doesn't read a hyperbolic flyby as
 * an imminent event; the `t-Pe` row lacked it and its `=== undefined` check
 * missed `null`.
 *
 * FIXED (2026-07-24): `t-Pe` now carries the same guard + handles `null`. This
 * regression test pins the guarantee: a hyperbolic orbit renders the `t-Pe`
 * value as an em-dash, never a `0s`/duration countdown.
 */
const VESSEL_STATE_INPUTS = [
  "vessel.orbit",
  "vessel.flight",
  "vessel.identity",
  "system.bodies",
];

describe("CurrentOrbit: O1, t-Pe shows the null-display placeholder on a hyperbolic orbit", () => {
  it("renders t-Pe as NULL_DISPLAY (never a countdown) when ecc >= 1", async () => {
    registerStockBodies();
    const stream = setupStreamFixture({
      carriedChannels: VESSEL_STATE_INPUTS,
      pinnedUt: 0,
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
