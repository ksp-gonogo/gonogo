import {
  clearBodies,
  DashboardItemContext,
  registerStockBodies,
} from "@ksp-gonogo/core";
import { Quality } from "@ksp-gonogo/sitrep-sdk";
import { act, render, screen, waitFor } from "@ksp-gonogo/test-utils";
import { installFixedSizeResizeObserver } from "@ksp-gonogo/ui-kit/testing";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ANALYTIC_UNBOUNDED_HORIZON } from "../test/orbitHorizon";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { KeplerPeriodComponent } from "./index";

let restoreObserver: () => void;

beforeEach(() => {
  clearBodies();
  registerStockBodies();
  restoreObserver = installFixedSizeResizeObserver({ width: 900, height: 700 });
});

afterEach(() => {
  restoreObserver();
});

describe("KeplerPeriod: the orbital period through a blackout", () => {
  it("keeps the period readout while the model carries the orbit from its last received state", async () => {
    const fixture = setupStreamFixture({ pinnedUt: 10, suspendFrames: true });
    render(
      <fixture.Provider>
        <DashboardItemContext.Provider
          value={{ instanceId: "kepler-blackout" }}
        >
          <KeplerPeriodComponent id="kepler-blackout" w={10} h={8} />
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
    await waitFor(() =>
      expect(document.body.textContent).toMatch(/Orbital period/),
    );
    expect(document.body.textContent).toMatch(/Orbital period\s*54/);

    act(() => {
      fixture.store.setTransportConnected(false);
      fixture.store.beginFrame();
    });
    // Longer than the plot's window, so the last received sample has aged out of it.
    act(() => {
      fixture.scrubTo(500);
    });
    await waitFor(() =>
      expect(fixture.store.sampleReading("vessel.orbit").state).toBe("held"),
    );
    expect(fixture.store.sampleReading("vessel.orbit").reckoning.status).toBe(
      "available",
    );
    expect(document.body.textContent).toMatch(/Orbital period\s*54/);
    await act(async () => {});
  });
});
