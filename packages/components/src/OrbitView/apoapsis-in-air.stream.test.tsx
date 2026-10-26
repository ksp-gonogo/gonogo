import { DashboardItemContext } from "@ksp-gonogo/core";
import { Quality } from "@ksp-gonogo/sitrep-sdk";
import { act, render, waitFor } from "@ksp-gonogo/test-utils";
import { visibleText } from "@ksp-gonogo/ui-kit/testing";
import { describe, expect, it } from "vitest";
import { ANALYTIC_UNBOUNDED_HORIZON } from "../test/orbitHorizon";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { OrbitViewComponent } from "./index";

/** A suborbital path inside the air has no apoapsis to plan against: drag decides where the craft goes. */

const KERBIN = {
  index: 1,
  name: "Kerbin",
  gravParameter: 3.5316e12,
  radius: 600_000,
  atmosphere: { depth: 70_000, hasOxygen: true, seaLevelPressure: 101.3 },
};

function setup(periapsisRadius: number, apoapsisRadius: number) {
  const fixture = setupStreamFixture({ pinnedUt: 10, suspendFrames: true });
  render(
    <fixture.Provider>
      <DashboardItemContext.Provider value={{ instanceId: "ov-air" }}>
        <OrbitViewComponent id="ov-air" w={9} h={18} />
      </DashboardItemContext.Provider>
    </fixture.Provider>,
  );
  act(() => {
    fixture.emit(
      "vessel.orbit",
      {
        referenceBodyIndex: 1,
        sma: (periapsisRadius + apoapsisRadius) / 2,
        ecc:
          (apoapsisRadius - periapsisRadius) /
          (apoapsisRadius + periapsisRadius),
        inc: 0,
        lan: 0,
        argPe: 0,
        // At apoapsis: a craft at its periapsis below the surface is not a state the model draws.
        meanAnomalyAtEpoch: Math.PI,
        epoch: 10,
        horizon: ANALYTIC_UNBOUNDED_HORIZON,
        mu: KERBIN.gravParameter,
      },
      { quality: Quality.Loaded },
    );
    fixture.emit("trackingStation.bodies", { bodies: [KERBIN] });
    fixture.emit("vessel.identity", {
      vesselId: "ov-air-vessel",
      name: "Test Vessel",
      vesselType: 0,
      situation: 6,
      parentBodyIndex: 1,
    });
  });
}

describe("OrbitView apoapsis in the air", () => {
  it("shows the apoapsis even when the path never leaves the atmosphere", async () => {
    // A near-vertical plunge: 590 km below the surface, apoapsis 363 m above it.
    setup(10_000, 600_363);
    await waitFor(() => expect(visibleText()).toContain("Pe"));
    expect(visibleText()).toContain("363");
  });

  it("still shows the apoapsis of a suborbital path that climbs out of the atmosphere", async () => {
    // 10 km below the surface to 100 km above it.
    setup(590_000, 700_000);
    await waitFor(() => expect(visibleText()).toContain("100"));
  });
});
