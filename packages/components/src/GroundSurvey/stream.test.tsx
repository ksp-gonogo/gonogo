import { DashboardItemContext } from "@ksp-gonogo/core";
import { Quality } from "@ksp-gonogo/sitrep-sdk";
import { act, render, screen } from "@ksp-gonogo/test-utils";
import { describe, expect, it } from "vitest";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { GroundSurveyComponent } from "./index";

/**
 * The stream test-adapter proof for GroundSurvey. `useGroundSurveySamples`
 * now reads BOTH `vessel.flight` (altitude/heightFromTerrain/surfaceSpeed,
 * a canonical Topic) and the `vessel.state` DERIVED channel
 * (`parentBodyName`/`isSplashed`/`landingPredictedLat`/`landingPredictedLon`,
 * via `useStream`): genuinely running off the real `TelemetryProvider`/
 * `TelemetryClient`/`TimelineStore` pipeline via `StubTransport`, no legacy
 * `DataSource` fallback at all any more.
 */
const FLIGHT_FIXTURE = {
  latitude: 0,
  longitude: 0,
  altitudeAsl: 5_000,
  altitudeTerrain: 2_500,
  verticalSpeed: -20,
  surfaceSpeed: 60,
  orbitalSpeed: 60,
  gForce: 1,
  dynamicPressureKPa: 0.1,
  mach: 0.2,
  atmDensity: 1,
  externalTemperature: 280,
  atmosphericTemperature: 280,
};

describe("GroundSurvey: genuinely runs off the stream (vessel.flight + vessel.state canonical reads)", () => {
  it("renders its normal awaiting state under a TelemetryProvider before vessel.flight has arrived", () => {
    const fixture = setupStreamFixture({ carriedChannels: [] });

    render(
      <fixture.Provider>
        <DashboardItemContext.Provider value={{ instanceId: "survey-stream" }}>
          <GroundSurveyComponent id="survey-stream" w={8} h={8} config={{}} />
        </DashboardItemContext.Provider>
      </fixture.Provider>,
    );

    expect(screen.getByText("GROUND SURVEY")).toBeTruthy();
    expect(screen.getByText(/Awaiting telemetry/i)).toBeTruthy();
  });

  it("surfaces body/altitude/heightFromTerrain once vessel.orbit + vessel.identity + system.bodies + vessel.flight stream", () => {
    const fixture = setupStreamFixture({ carriedChannels: [] });

    render(
      <fixture.Provider>
        <DashboardItemContext.Provider value={{ instanceId: "survey-live" }}>
          <GroundSurveyComponent id="survey-live" w={8} h={8} config={{}} />
        </DashboardItemContext.Provider>
      </fixture.Provider>,
    );

    act(() => {
      fixture.emit("vessel.orbit", {}, { quality: Quality.Loaded });
      fixture.emit("vessel.identity", { parentBodyIndex: 1 });
      fixture.emit("system.bodies", {
        bodies: [
          {
            name: "Kerbin",
            index: 1,
            parentIndex: 0,
            radius: 600_000,
            orbit: null,
          },
        ],
      });
      fixture.emit("vessel.flight", FLIGHT_FIXTURE);
      fixture.store.beginFrame();
    });

    expect(screen.getByText(/Kerbin/)).toBeTruthy();
    expect(screen.getByText(/surveying/i)).toBeTruthy();
    expect(screen.getByText(/2\.50 km AGL/)).toBeTruthy();
  });
});
