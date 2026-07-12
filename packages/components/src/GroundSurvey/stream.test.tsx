import { DashboardItemContext } from "@ksp-gonogo/core";
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import {
  setupMockDataSource,
  teardownMockDataSource,
} from "../test/setupMockDataSource";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { GroundSurveyComponent } from "./index";

/**
 * The stream test-adapter proof for GroundSurvey. `useGroundSurveySamples`
 * now reads `vessel.flight` (altitude/heightFromTerrain/surfaceSpeed) as a
 * canonical Topic — genuinely running off the real `TelemetryProvider`/
 * `TelemetryClient`/`TimelineStore` pipeline via `StubTransport`, no legacy
 * `DataSource` fallback at all for those three fields (mirrors
 * `useTopology`'s posture). `v.body`/`v.splashed`/`land.predictedLat`/
 * `land.predictedLon` still resolve through the `useTelemetry` mapTopic
 * shim — see `index.test.tsx` for the mixed-source coverage of those four.
 */
afterEach(() => {
  cleanup();
});

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

describe("GroundSurvey — genuinely runs off the stream (vessel.flight canonical read)", () => {
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

  it("surfaces altitude/heightFromTerrain once vessel.flight streams", async () => {
    const fixture = setupStreamFixture({ carriedChannels: [] });
    // v.body still resolves through the legacy mapTopic-shimmed fallback —
    // see this file's own doc comment.
    const legacyAux = await setupMockDataSource({
      id: "data",
      keys: [{ key: "v.body" }],
      connectSource: true,
    });

    render(
      <fixture.Provider>
        <DashboardItemContext.Provider value={{ instanceId: "survey-live" }}>
          <GroundSurveyComponent id="survey-live" w={8} h={8} config={{}} />
        </DashboardItemContext.Provider>
      </fixture.Provider>,
    );

    act(() => {
      legacyAux.source.emit("v.body", "Kerbin");
      fixture.emit("vessel.flight", FLIGHT_FIXTURE);
      fixture.store.beginFrame();
    });

    expect(screen.getByText(/surveying/i)).toBeTruthy();
    expect(screen.getByText(/2\.50 km AGL/)).toBeTruthy();
    teardownMockDataSource(legacyAux);
  });
});
