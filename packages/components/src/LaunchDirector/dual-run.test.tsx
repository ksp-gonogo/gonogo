import { DashboardItemContext } from "@ksp-gonogo/core";
import { act, render, screen, waitFor, within } from "@ksp-gonogo/test-utils";
import { visibleText } from "@ksp-gonogo/ui-kit/testing";
import userEvent from "@testing-library/user-event";
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
 * against: same "the legacy leg is gone" story as
 * `WarpControl/dual-run.test.tsx`'s own doc comment. What remains proves the
 * widget renders the full pre-launch state correctly off the real stream
 * pipeline (`TelemetryProvider` + `TelemetryClient`/`TimelineStore`), using
 * the SAME `pre-launch-mixed` fixture the DOM-snapshot suite covers, driven off
 * that fixture's own `_stream` block so the two specs cannot disagree about
 * what the fixture says.
 */
const STREAM = preLaunch._stream;

describe("LaunchDirector: stream render golden (delay=0)", () => {
  it("renders the full pre-launch state off the stream pipeline", async () => {
    const user = userEvent.setup();
    const mode = { name: "default-7x10", w: 7, h: 10 };

    const streamFixture = setupStreamFixture({
      carriedChannels: STREAM.carriedChannels,
      pinnedUt: STREAM.pinnedUt,
      suspendFrames: true,
    });

    const { container } = render(
      <streamFixture.Provider>
        <DashboardItemContext.Provider value={{ instanceId: "ld-dual" }}>
          <LaunchDirectorComponent id="ld-dual" w={mode.w} h={mode.h} />
        </DashboardItemContext.Provider>
      </streamFixture.Provider>,
    );

    act(() => {
      for (const emit of STREAM.emits) {
        streamFixture.emit(emit.channel, emit.value);
      }
    });

    await waitFor(() => {
      if (!visibleText(container).includes("42,500f")) {
        throw new Error("stream leg has not rendered funds yet");
      }
    });

    const scope = within(container);
    // Every pad the fixture carries is on screen, none of them holding
    // anything, and the two that report no occupancy say so.
    expect(scope.getByText("KSC Launch Pad")).toBeTruthy();
    expect(scope.getByText("KSC Runway")).toBeTruthy();
    expect(scope.getByText("Woomerang")).toBeTruthy();
    expect(scope.getAllByText("Occupancy unreported")).toHaveLength(2);

    // The first pad opens on its own, and offers the craft that come out of the
    // VAB: the funds-blocked one is tagged, and its value and funds marker are
    // separate elements now, so this matches the bare number and asserts the
    // announced text on the element itself.
    expect(scope.getByText("Mun Hopper I")).toBeTruthy();
    expect(scope.getByText("180000").textContent).toBe("180000f funds");
    expect(scope.getByText(/Craft · 1\/2 ready/)).toBeTruthy();

    // The spaceplane belongs to the runway, and is offered there rather than on
    // a pad that could never launch it.
    expect(scope.queryByText("SSTO Spaceplane")).toBeNull();
    await user.click(screen.getByText("KSC Runway"));
    expect(await screen.findByText("SSTO Spaceplane")).toBeTruthy();
    expect(scope.getByText("2 locked")).toBeTruthy();
    expect(scope.getByText(/Craft · 0\/1 ready/)).toBeTruthy();
  });
});
