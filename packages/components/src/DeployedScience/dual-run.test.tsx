import { DashboardItemContext } from "@ksp-gonogo/core";
import { act, render, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { snapshotWidgetMode, stripVolatile } from "../test/widgetDomSnapshot";
import munCluster from "./__fixtures__/mun-cluster-two-experiments.json";
import { DeployedScienceComponent } from "./index";

/**
 * DeployedScience's behavior-preservation golden dual-run (mirrors
 * `ScienceBench/dual-run.test.tsx` /
 * `ScienceOfficer/dual-run.test.tsx`): the SAME deployed-cluster state,
 * rendered once off the legacy `DataSource` (`deployed.bases`'s grouped-base
 * shape) and once off the stream (`science.deployed`'s flat
 * per-experiment shape), must produce byte-identical DOM at `delay=0`.
 *
 * `deployed.bases`'s legacy fixture values are deliberately chosen
 * (`__fixtures__/mun-cluster-two-experiments.json`'s own `_meta.notes`) so
 * `parseBases`'s new-wire grouping branch (`groupFlatDeployedEntries`,
 * index.tsx) reproduces them exactly: `powerAvailable`/`powerRequired`
 * zeroed (no EC numeric equivalent on the new wire), `progress`/`collecting`
 * derived straight from `scienceCompletedPercentage`, `stored`/`transmitted`
 * derived from `scienceValue` x `scienceTransmittedPercentage` — none of
 * which are actually rendered to DOM text either way (the widget's DOM only
 * ever shows `body`/power label/EC numbers/experiment name/progress %/
 * collecting dot), so this dual-run is a genuine same-state comparison, not
 * a coincidence. `deployed.available` (-> `game.dlc.breakingGround`) is
 * migrated too — the legacy leg still reads it off
 * the plain `DataSource` (that leg never mounts a `TelemetryProvider`, so
 * the shim's carried-channels gate keeps it on the legacy path there); the
 * stream leg now feeds it through the fixture's `game.dlc` topic instead of
 * a legacy AUX `DataSource`.
 */
describe("DeployedScience — behavior-preservation golden dual-run (delay=0)", () => {
  it("renders IDENTICAL markup off the stream as off the legacy DataSource for the same deployed-cluster state", async () => {
    const mode = { name: "default-5x9", w: 5, h: 9 };

    const legacyHtml = await snapshotWidgetMode({
      Widget: DeployedScienceComponent,
      fixture: munCluster,
      mode,
      connectSource: true,
    });

    const streamFixture = setupStreamFixture({
      carriedChannels: ["science.deployed", "game.dlc"],
      pinnedUt: 10,
    });

    const { container } = render(
      <streamFixture.Provider>
        <DashboardItemContext.Provider value={{ instanceId: "ds-dual" }}>
          <DeployedScienceComponent id="ds-dual" w={mode.w} h={mode.h} />
        </DashboardItemContext.Provider>
      </streamFixture.Provider>,
    );

    act(() => {
      streamFixture.emit("game.dlc", {
        breakingGround: munCluster["deployed.available"],
      });
      streamFixture.emit("science.deployed", [
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

    const streamHtml = stripVolatile(container.innerHTML);

    expect(streamHtml).toBe(legacyHtml);
  });
});
