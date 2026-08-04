import { DashboardItemContext } from "@ksp-gonogo/core";
import { Quality } from "@ksp-gonogo/sitrep-sdk";
import { act, render, screen, visibleText } from "@ksp-gonogo/test-utils";
import { describe, expect, it } from "vitest";
import { setupStreamFixture } from "../test/setupStreamFixture";
import kerbinDescent from "./__fixtures__/kerbin-descent-low-pass.json";
import { GroundSurveyComponent } from "./index";

/**
 * GroundSurvey's real-capture scenario, rendered off the stream.
 *
 * `v.body` reads through `vessel.state.parentBodyName` now (`vessel.identity`
 * + `system.bodies`), same as every other read in this widget, no legacy
 * `DataSource` mounted at all. What's still worth keeping is the real
 * captured-flight fixture itself (`kerbin-descent-low-pass.json`, a genuine
 * low-pass descent snapshot) exercising the widget end-to-end via the
 * stream.
 */
describe("GroundSurvey: real-capture kerbin-descent-low-pass scenario (via the stream)", () => {
  it("renders the captured low-pass descent state", () => {
    const fixture = setupStreamFixture({ carriedChannels: [] });

    render(
      <fixture.Provider>
        <DashboardItemContext.Provider value={{ instanceId: "survey-dual" }}>
          <GroundSurveyComponent id="survey-dual" config={{}} w={8} h={8} />
        </DashboardItemContext.Provider>
      </fixture.Provider>,
    );

    act(() => {
      fixture.emit("vessel.orbit", {}, { quality: Quality.Loaded });
      fixture.emit("vessel.identity", { parentBodyIndex: 1 });
      fixture.emit("system.bodies", {
        bodies: [
          {
            name: kerbinDescent["v.body"],
            index: 1,
            parentIndex: 0,
            radius: 600_000,
            orbit: null,
          },
        ],
      });
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
    // 2011.386 m AGL: above the 1 km freeze threshold, below the 10 km
    // ceiling: actively surveying.
    expect(screen.getByText(/surveying/i)).toBeTruthy();
    expect(visibleText()).toMatch(/2\.01 km AGL/);
  });
});
