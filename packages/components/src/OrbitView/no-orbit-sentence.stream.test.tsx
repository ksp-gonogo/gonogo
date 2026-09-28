import { DashboardItemContext } from "@ksp-gonogo/core";
import { Quality } from "@ksp-gonogo/sitrep-sdk";
import { act, render, screen } from "@ksp-gonogo/test-utils";
import { describe, expect, it } from "vitest";
import { ANALYTIC_UNBOUNDED_HORIZON } from "../test/orbitHorizon";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { OrbitViewComponent } from "./index";

/** "packed" claims the orbit exists and the craft is loaded, so only the reason that names the loaded case may say it. */

const EARTH = {
  index: 1,
  name: "Earth",
  gravParameter: 3.986e14,
  radius: 6371000,
  atmosphere: { depth: 140000, hasOxygen: true, seaLevelPressure: 101.3 },
};

const HIGH_CIRCULAR = 6371000 + 400000;

function scene(
  orbit: Record<string, unknown>,
  quality: Quality = Quality.OnRails,
) {
  const fixture = setupStreamFixture({
    pinnedUt: 10,
    suspendFrames: true,
  });
  render(
    <fixture.Provider>
      <DashboardItemContext.Provider value={{ instanceId: "ov-nos" }}>
        <OrbitViewComponent id="ov-nos" w={9} h={18} />
      </DashboardItemContext.Provider>
    </fixture.Provider>,
  );
  act(() => {
    fixture.emit("system.bodies", { bodies: [EARTH] });
    fixture.emit("vessel.identity", {
      vesselId: "ov-nos-vessel",
      name: "Test Vessel",
      vesselType: 0,
      situation: 0,
      parentBodyIndex: 1,
    });
    fixture.emit(
      "vessel.orbit",
      {
        referenceBodyIndex: 1,
        sma: HIGH_CIRCULAR,
        ecc: 0,
        inc: 0,
        lan: 0,
        argPe: 0,
        meanAnomalyAtEpoch: 0,
        epoch: 10,
        horizon: ANALYTIC_UNBOUNDED_HORIZON,
        mu: 3.986e14,
        ...orbit,
      },
      { quality },
    );
  });
}

describe("OrbitView's empty sentence follows the reason the conic withdrew", () => {
  it("gives a craft under physics no empty sentence at all: its orbit is drawn", () => {
    scene({}, Quality.Loaded);

    expect(screen.queryByText(/No orbital data|packed/)).toBeNull();
  });

  it("does not say packed for a coast inside the air", () => {
    scene({ sma: 6371000 + 60000 });

    expect(screen.queryByText(/packed/)).toBeNull();
    expect(screen.getByText("No orbital data")).toBeInTheDocument();
  });

  it("does not say packed past the SOI transition", () => {
    scene({ encounter: { transitionUt: 5 } });

    expect(screen.queryByText(/packed/)).toBeNull();
    expect(screen.getByText("No orbital data")).toBeInTheDocument();
  });

  it("draws the orbit, and no empty sentence at all, for an analytic coast above the air", () => {
    // The control: without it every assertion above would also pass on a widget that had stopped drawing anything.
    scene({});

    expect(screen.queryByText(/No orbital data|packed/)).toBeNull();
  });
});
