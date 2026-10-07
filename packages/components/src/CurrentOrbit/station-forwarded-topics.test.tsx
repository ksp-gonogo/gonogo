import { DashboardItemContext, getComponent } from "@ksp-gonogo/core";
import { act, render, waitFor } from "@ksp-gonogo/test-utils";
import { visibleText } from "@ksp-gonogo/ui-kit/testing";
import { describe, expect, it } from "vitest";
import { ANALYTIC_UNBOUNDED_HORIZON } from "../test/orbitHorizon";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { CurrentOrbitComponent } from "./index";

const KERBIN = { index: 1, name: "Kerbin", parentIndex: 0, radius: 600000 };

/**
 * A station is delivered only the Topics its own widgets subscribed, which the
 * stub models by dropping a frame nothing subscribed. So feeding only the
 * widget's declared channels is exactly what a station receives for it.
 */
describe("CurrentOrbit on a station: only its declared Topics arrive", () => {
  it("draws both apsis altitudes and the body name from the declared channels alone", async () => {
    const declared = getComponent("current-orbit")?.channels ?? [];
    const station = setupStreamFixture({ pinnedUt: 10, suspendFrames: true });

    render(
      <station.Provider>
        <DashboardItemContext.Provider value={{ instanceId: "orbit-station" }}>
          <CurrentOrbitComponent id="orbit-station" w={9} h={18} />
        </DashboardItemContext.Provider>
      </station.Provider>,
    );

    const frames: Record<string, unknown> = {
      "vessel.orbit": {
        referenceBodyIndex: 1,
        sma: 1_005_000,
        ecc: 0.004975,
        inc: 0,
        lan: 0,
        argPe: 0,
        meanAnomalyAtEpoch: 0,
        epoch: 10,
        mu: 3.5316e12,
        horizon: ANALYTIC_UNBOUNDED_HORIZON,
      },
      "vessel.identity": {
        vesselId: "v1",
        name: "Probe",
        vesselType: 0,
        situation: 3,
        parentBodyIndex: 1,
        launchUt: 0,
      },
      "system.bodies": { bodies: [KERBIN] },
    };
    act(() => {
      for (const topic of declared) {
        if (topic in frames) station.emit(topic, frames[topic]);
      }
    });

    await waitFor(() => expect(visibleText()).toContain("Kerbin"));
    expect(visibleText()).toContain("410.0 km");
    expect(visibleText()).toContain("400.0 km");
  });
});
