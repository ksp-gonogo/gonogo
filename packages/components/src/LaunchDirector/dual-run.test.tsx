import { DashboardItemContext } from "@ksp-gonogo/core";
import { act, render, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { setupStreamFixture } from "../test/setupStreamFixture";
import preLaunch from "./__fixtures__/pre-launch-mixed.json";
import { LaunchDirectorComponent } from "./index";

/**
 * LaunchDirector's stream render golden. This began life as a
 * legacy-`DataSource`↔stream byte-identical dual-run (comparing
 * `career.funds`/`kc.savedShips`/`kc.crewRoster` streamed against every
 * other fixture key staying legacy); with the widget now reading its WHOLE
 * pre-launch state off canonical Topics (`spaceCenter.savedShips`/
 * `spaceCenter.crewRoster`/`career.status`/`spaceCenter.scene`/
 * `spaceCenter.launchSites`), there is no legacy read path left to compare
 * against — same "the legacy leg is gone" story as
 * `WarpControl/dual-run.test.tsx`'s own doc comment. What remains proves the
 * widget renders the full pre-launch state correctly off the real stream
 * pipeline (`TelemetryProvider` + `TelemetryClient`/`TimelineStore`), using
 * the SAME `pre-launch-mixed` fixture the DOM-snapshot suite covers.
 */
describe("LaunchDirector — stream render golden (delay=0)", () => {
  it("renders the full pre-launch state off the stream pipeline", async () => {
    const mode = { name: "default-7x10", w: 7, h: 10 };

    const streamFixture = setupStreamFixture({
      carriedChannels: [
        "career.status",
        "spaceCenter.savedShips",
        "spaceCenter.crewRoster",
        "spaceCenter.scene",
        "spaceCenter.launchSites",
      ],
      pinnedUt: 10,
    });

    const { container } = render(
      <streamFixture.Provider>
        <DashboardItemContext.Provider value={{ instanceId: "ld-dual" }}>
          <LaunchDirectorComponent id="ld-dual" w={mode.w} h={mode.h} />
        </DashboardItemContext.Provider>
      </streamFixture.Provider>,
    );

    act(() => {
      streamFixture.emit("spaceCenter.scene", {
        scene: preLaunch["kc.scene"],
        launchSite: preLaunch["kc.launchSite"],
      });
      streamFixture.emit(
        "spaceCenter.launchSites",
        preLaunch["kc.launchSites"],
      );
      streamFixture.emit("career.status", {
        economy: {
          funds: preLaunch["career.funds"],
          reputation: null,
          science: null,
        },
        facilities: null,
        contracts: null,
        strategies: null,
        tech: null,
      });
      streamFixture.emit("spaceCenter.savedShips", preLaunch["kc.savedShips"]);
      streamFixture.emit("spaceCenter.crewRoster", preLaunch["kc.crewRoster"]);
    });

    await waitFor(() => {
      if (!container.textContent?.includes("42,500f")) {
        throw new Error("stream leg has not rendered funds yet");
      }
    });

    const scope = within(container);
    // Every saved ship from the fixture is on screen ...
    expect(scope.getByText("Mun Hopper I")).toBeTruthy();
    expect(scope.getByText("Duna Transfer Stage")).toBeTruthy();
    expect(scope.getByText("SSTO Spaceplane")).toBeTruthy();
    // ... the funds-blocked one is tagged ...
    expect(scope.getByText("180000f")).toBeTruthy();
    // ... and the parts-locked one's missing part shows in its title.
    expect(scope.getByText("2 locked")).toBeTruthy();
    // Subtitle reflects the launchable/total count for the fixture's mix.
    expect(scope.getByText(/1\/3 ready/i)).toBeTruthy();
  });
});
