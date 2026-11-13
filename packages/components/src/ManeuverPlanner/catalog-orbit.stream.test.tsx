import { DashboardItemContext } from "@ksp-gonogo/core";
import { act, render, waitFor } from "@ksp-gonogo/test-utils";
import { visibleText } from "@ksp-gonogo/ui-kit/testing";
import { describe, expect, it } from "vitest";
import { ANALYTIC_UNBOUNDED_HORIZON } from "../test/orbitHorizon";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { ManeuverPlannerComponent } from "./index";

const KERBIN = {
  index: 1,
  name: "Kerbin",
  radius: 600_000,
  gravParameter: 3.5316e12,
};

describe("ManeuverPlanner on an orbit the craft has not sent", () => {
  it("waits for the craft's own orbit while only the catalog's is known, and plans once it arrives", async () => {
    const fixture = setupStreamFixture({
      pinnedUt: 1_000_000,
      suspendFrames: true,
    });
    const { container } = render(
      <fixture.Provider>
        <DashboardItemContext.Provider value={{ instanceId: "mnv-catalog" }}>
          <ManeuverPlannerComponent id="mnv-catalog" config={{}} />
        </DashboardItemContext.Provider>
      </fixture.Provider>,
    );

    act(() => {
      fixture.emit("trackingStation.bodies", { bodies: [KERBIN] });
      fixture.emit("ksp.activeVessel", { vesselId: "probe", name: "Probe" });
      fixture.emit("trackingStation.catalog", {
        entries: [
          {
            vesselId: "probe",
            name: "Probe",
            vesselType: 3,
            situation: 32,
            bodyIndex: 1,
            orbit: {
              sma: 700_000,
              ecc: 0.01,
              inc: 0,
              lan: 0,
              argPe: 0,
              meanAnomalyAtEpoch: 0,
              epoch: 1_000_000,
            },
          },
        ],
      });
      fixture.emitFrame();
    });
    await waitFor(() =>
      expect(visibleText(container)).toContain("Awaiting orbit telemetry"),
    );

    act(() => {
      fixture.emit("vessel.orbit", {
        referenceBodyIndex: 1,
        sma: 700_000,
        ecc: 0.01,
        inc: 0,
        lan: 0,
        argPe: 0,
        meanAnomalyAtEpoch: 0,
        epoch: 1_000_000,
        mu: 3.5316e12,
        horizon: ANALYTIC_UNBOUNDED_HORIZON,
        meta: { source: "vessel:probe", quality: 0 },
      });
      fixture.emitFrame();
    });
    await waitFor(() =>
      expect(visibleText(container)).not.toContain("Awaiting orbit telemetry"),
    );
  });
});
