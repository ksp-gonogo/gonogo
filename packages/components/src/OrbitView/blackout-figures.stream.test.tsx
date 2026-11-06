import { DashboardItemContext } from "@ksp-gonogo/core";
import { Quality } from "@ksp-gonogo/sitrep-sdk";
import { act, render, screen, waitFor } from "@ksp-gonogo/test-utils";
import { describe, expect, it } from "vitest";
import { ANALYTIC_UNBOUNDED_HORIZON } from "../test/orbitHorizon";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { OrbitViewComponent } from "./index";

/**
 * A coasting craft's orbit is carried forward from the last received state
 * through a blackout, so every figure solved from it follows the same rule as
 * inclination and eccentricity: shown, marked as modelled, never a dash.
 */
describe("OrbitView: figures through a blackout on a coasting craft", () => {
  it("keeps apoapsis, periapsis and period beside inclination and eccentricity", async () => {
    const fixture = setupStreamFixture({ pinnedUt: 10, suspendFrames: true });
    render(
      <fixture.Provider>
        <DashboardItemContext.Provider value={{ instanceId: "ov-blackout" }}>
          <OrbitViewComponent id="ov-blackout" w={9} h={18} />
        </DashboardItemContext.Provider>
      </fixture.Provider>,
    );
    act(() => {
      fixture.emit("trackingStation.bodies", {
        bodies: [{ name: "Mun", index: 2, radius: 200000 }],
      });
      fixture.emit("vessel.identity", {
        vesselId: "v1",
        name: "Mun Probe",
        vesselType: 0,
        situation: 3,
        parentBodyIndex: 2,
      });
      fixture.emit(
        "vessel.orbit",
        {
          referenceBodyIndex: 2,
          sma: 260000,
          ecc: 0.001,
          inc: 0.3,
          lan: 0,
          argPe: 12.5,
          mu: 6.5138398e10,
          horizon: ANALYTIC_UNBOUNDED_HORIZON,
          meanAnomalyAtEpoch: 0,
          epoch: 10,
        },
        { quality: Quality.OnRails },
      );
    });
    await screen.findAllByText("Ap");
    const text = () => document.body.textContent ?? "";
    expect(text()).toMatch(/Ap\s*[\d.]+\s*km/);

    act(() => {
      fixture.store.setTransportConnected(false);
      fixture.store.beginFrame();
    });
    await waitFor(() =>
      expect(fixture.store.sampleReading("vessel.orbit").state).toBe("held"),
    );
    expect(fixture.store.sampleReading("vessel.orbit").reckoning.status).toBe(
      "available",
    );
    expect(text()).toMatch(/Ap\s*[\d.]+\s*km/);
    expect(text()).toMatch(/Pe\s*[\d.]+\s*km/);
    expect(text()).toMatch(/T\s*[\d.]+\s*min/);
    await act(async () => {});
  });
});
