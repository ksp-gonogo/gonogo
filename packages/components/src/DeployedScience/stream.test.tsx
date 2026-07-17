import { clearActionHandlers, DashboardItemContext } from "@ksp-gonogo/core";
import { act, render, screen, waitFor } from "@ksp-gonogo/test-utils";
import { afterEach, describe, expect, it } from "vitest";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { DeployedScienceComponent } from "./index";

/**
 * The stream test-adapter proof for DeployedScience: genuinely running off
 * the real `TelemetryProvider`/`TelemetryClient`/`TimelineStore` pipeline
 * via `StubTransport`. `deployed.bases` is mapped onto `science.deployed`
 * (map-topic.ts) — a raw FLAT array read wholesale and grouped client-side
 * by `vesselName` (`groupFlatDeployedEntries`, index.tsx), same "one widget
 * key, either wire shape" pattern `science.experiments`/`sci.experiments`
 * established for ScienceBench. `deployed.available` (->
 * `game.dlc.breakingGround`) is migrated too — no legacy `DataSource` AUX
 * needed for this widget any more, it streams through the fixture's
 * `game.dlc` topic.
 */
afterEach(() => {
  clearActionHandlers();
});

describe("DeployedScience — genuinely runs off the stream (M3 science-domain finale)", () => {
  it("renders a deployed cluster grouped by vessel from science.deployed's flat shape", async () => {
    const fixture = setupStreamFixture({
      carriedChannels: ["science.deployed", "game.dlc"],
      pinnedUt: 10,
    });

    render(
      <fixture.Provider>
        <DashboardItemContext.Provider value={{ instanceId: "ds-stream" }}>
          <DeployedScienceComponent id="ds-stream" w={5} h={9} />
        </DashboardItemContext.Provider>
      </fixture.Provider>,
    );

    expect(fixture.transport.isSubscribed("science.deployed")).toBe(true);

    act(() => {
      fixture.emit("game.dlc", { breakingGround: true });
      fixture.emit("science.deployed", [
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
    expect(screen.getByText("15%")).toBeTruthy();
  });
});
