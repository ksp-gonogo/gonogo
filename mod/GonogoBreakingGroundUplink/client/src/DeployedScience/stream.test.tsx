import {
  act,
  screen,
  setupStreamFixture,
  waitFor,
} from "@ksp-gonogo/sitrep-sdk/testing";
import { clearActionHandlers, renderWidget } from "@ksp-gonogo/sitrep-testing";
import { visibleText } from "@ksp-gonogo/ui-kit/testing";
import { afterEach, describe, expect, it } from "vitest";
// Side-effect import: the widget self-registers on module load, and
// `renderWidget` looks it up by id rather than importing the component.
import "./index";

/**
 * The stream test-adapter proof for DeployedScience: genuinely running off
 * the real `TelemetryProvider`/`TelemetryClient`/`TimelineStore` pipeline
 * via `StubTransport`. `deployed.bases` is mapped onto `deployed.bases`
 * (map-topic.ts): a raw FLAT array read wholesale and grouped client-side
 * by `vesselName` (`groupFlatDeployedEntries`, index.tsx), same "one widget
 * key, either wire shape" pattern `science.experiments`/`sci.experiments`
 * established for ScienceData. `deployed.available` (->
 * `game.dlc.breakingGround`) is migrated too, no legacy `DataSource` AUX
 * needed for this widget any more, it streams through the fixture's
 * `game.dlc` topic.
 */
afterEach(() => {
  clearActionHandlers();
});

describe("DeployedScience: genuinely runs off the stream (M3 science-domain finale)", () => {
  it("renders a deployed cluster grouped by vessel from deployed.bases's flat shape", async () => {
    const fixture = setupStreamFixture({
      carriedChannels: ["deployed.bases", "game.dlc"],
      pinnedUt: 10,
    });

    renderWidget("deployed-science", {
      instanceId: "ds-stream",
      w: 5,
      h: 9,
      wrapper: fixture.Provider,
    });

    expect(fixture.transport.isSubscribed("deployed.bases")).toBe(true);

    act(() => {
      fixture.emit("game.dlc", { breakingGround: true });
      fixture.emit("deployed.bases", [
        {
          vesselName: "Minmus Flats Outpost",
          partName: "Barometer",
          body: "Minmus",
          situation: "LANDED",
          biome: "Flats",
          experimentId: "surfaceExperimentBarometer",
          scienceCompletedPercentage: 15,
          scienceTransmittedPercentage: 0,
          scienceValue: 4.5,
          scienceLimit: 30,
          powerState: "NoPower",
          connectionState: "NotConnected",
          deployedOnGround: true,
        },
      ]);
    });

    await waitFor(() => expect(screen.getByText("Minmus")).toBeTruthy());
    expect(screen.getByText("Barometer")).toBeTruthy();
    expect(screen.getByText(/Unpowered/i)).toBeTruthy();
    expect(visibleText()).toContain("15 %");
  });
});
