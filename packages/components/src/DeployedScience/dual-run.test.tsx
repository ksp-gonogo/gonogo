import { DashboardItemContext } from "@ksp-gonogo/core";
import { act, render, waitFor, within } from "@ksp-gonogo/test-utils";
import { describe, expect, it } from "vitest";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { DeployedScienceComponent } from "./index";

/**
 * DeployedScience's stream render golden. This began life as a
 * legacy-`DataSource`↔stream byte-identical dual-run (`deployed.bases`'s
 * grouped-base shape compared against `science.deployed`'s flat
 * per-experiment shape); with the widget now reading its whole state off the
 * canonical `science.deployed` + `game.dlc` Topics, there is no legacy read
 * path left to compare against — same "the legacy leg is gone" story as
 * `ScienceOfficer/dual-run.test.tsx`'s own doc comment. What remains proves
 * the widget renders the full two-experiment Mun cluster correctly off the
 * real stream pipeline, from the flat `science.deployed` wire shape grouped by
 * `vesselName` (`groupFlatDeployedEntries`, index.tsx):
 * `powerAvailable`/`powerRequired` degrade to `0`/`0` (no EC numeric on the
 * new wire, only the coarse `powerState` enum), progress derived straight from
 * `scienceCompletedPercentage`.
 */
describe("DeployedScience — stream render golden (delay=0)", () => {
  it("renders the full deployed-cluster state off the stream pipeline", async () => {
    const fixture = setupStreamFixture({
      carriedChannels: ["science.deployed", "game.dlc"],
      pinnedUt: 10,
    });

    const { container } = render(
      <fixture.Provider>
        <DashboardItemContext.Provider value={{ instanceId: "ds-dual" }}>
          <DeployedScienceComponent id="ds-dual" w={5} h={9} />
        </DashboardItemContext.Provider>
      </fixture.Provider>,
    );

    act(() => {
      fixture.emit("game.dlc", { breakingGround: true });
      fixture.emit("science.deployed", [
        {
          vesselName: "Mun Surface Science Base",
          partName: "Seismic Accelerometer",
          body: "Mun",
          situation: "LANDED",
          biome: "Highlands",
          experimentId: "surfaceExperimentSeismicAccelerometer",
          scienceCompletedPercentage: 75,
          scienceTransmittedPercentage: 50,
          scienceValue: 45,
          scienceLimit: 60,
          powerState: "Powered",
          connectionState: "Connected",
          deployedOnGround: true,
        },
        {
          vesselName: "Mun Surface Science Base",
          partName: "Mystery Goo Experiment",
          body: "Mun",
          situation: "LANDED",
          biome: "Highlands",
          experimentId: "mysteryGoo",
          scienceCompletedPercentage: 100,
          scienceTransmittedPercentage: 100,
          scienceValue: 12,
          scienceLimit: 12,
          powerState: "Powered",
          connectionState: "Connected",
          deployedOnGround: true,
        },
      ]);
    });

    await waitFor(() => {
      if (!container.textContent?.includes("Seismic Accelerometer")) {
        throw new Error("stream leg has not rendered the deployed list yet");
      }
      if (container.textContent?.includes("SYNCING")) {
        throw new Error("stream status has not settled to live yet");
      }
    });

    const scope = within(container);
    // One card for the Mun cluster (grouped by vesselName), powered.
    expect(scope.getByText("Mun")).toBeInTheDocument();
    expect(scope.getByText(/Powered/i)).toBeInTheDocument();
    // Both experiments render with their derived progress.
    expect(scope.getByText("Seismic Accelerometer")).toBeInTheDocument();
    expect(scope.getByText("75%")).toBeInTheDocument();
    expect(scope.getByText("Mystery Goo Experiment")).toBeInTheDocument();
    expect(scope.getByText("100%")).toBeInTheDocument();
  });
});
