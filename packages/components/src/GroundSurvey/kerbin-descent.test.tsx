import { DashboardItemContext } from "@ksp-gonogo/core";
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import {
  setupMockDataSource,
  teardownMockDataSource,
} from "../test/setupMockDataSource";
import { setupStreamFixture } from "../test/setupStreamFixture";
import kerbinDescent from "./__fixtures__/kerbin-descent-low-pass.json";
import { GroundSurveyComponent } from "./index";

/**
 * GroundSurvey's real-capture scenario, rendered off the stream.
 *
 * This used to be a legacy-vs-stream BEHAVIOR-PRESERVATION dual-run (the
 * same shape as `KeplerPeriod`/`OrbitalAscent`'s), proving a
 * `TelemetryProvider` mounted above the widget changed nothing while
 * `useGroundSurveySamples` still bypassed `useDataValue` entirely. That
 * premise is gone: `vessel.flight` (altitude/heightFromTerrain/
 * surfaceSpeed) is now a CANONICAL Topic read with no legacy fallback at
 * all (mirrors `useTopology`) — a "legacy-only, no provider" render can no
 * longer produce a meaningful GroundSurvey output to diff against, so
 * "byte-identical to the legacy leg" is no longer a coherent comparison for
 * this widget. What's still worth keeping is the real captured-flight
 * fixture itself (`kerbin-descent-low-pass.json`, a genuine low-pass
 * descent snapshot) exercising the widget end-to-end via the stream.
 */
afterEach(() => {
  cleanup();
});

describe("GroundSurvey — real-capture kerbin-descent-low-pass scenario (via the stream)", () => {
  it("renders the captured low-pass descent state", async () => {
    const fixture = setupStreamFixture({ carriedChannels: [] });
    // v.body still resolves through the legacy mapTopic-shimmed fallback —
    // see stream.test.tsx's doc comment.
    const legacyAux = await setupMockDataSource({
      id: "data",
      keys: [{ key: "v.body" }],
      connectSource: true,
    });

    render(
      <fixture.Provider>
        <DashboardItemContext.Provider value={{ instanceId: "survey-dual" }}>
          <GroundSurveyComponent id="survey-dual" config={{}} w={8} h={8} />
        </DashboardItemContext.Provider>
      </fixture.Provider>,
    );

    act(() => {
      legacyAux.source.emit("v.body", kerbinDescent["v.body"]);
      fixture.emit("vessel.flight", {
        latitude: 0,
        longitude: 0,
        altitudeAsl: kerbinDescent["v.altitude"],
        altitudeTerrain: kerbinDescent["v.heightFromTerrain"],
        verticalSpeed: 0,
        surfaceSpeed: kerbinDescent["v.surfaceSpeed"],
        orbitalSpeed: 0,
        gForce: 0,
        dynamicPressureKPa: 0,
        mach: 0,
        atmDensity: 0,
        externalTemperature: 0,
        atmosphericTemperature: 0,
      });
      fixture.store.beginFrame();
    });

    expect(screen.getByText("GROUND SURVEY")).toBeTruthy();
    // 2011.386 m AGL — above the 1 km freeze threshold, below the 10 km
    // ceiling: actively surveying.
    expect(screen.getByText(/surveying/i)).toBeTruthy();
    expect(screen.getByText(/2\.01 km AGL/)).toBeTruthy();
    teardownMockDataSource(legacyAux);
  });
});
