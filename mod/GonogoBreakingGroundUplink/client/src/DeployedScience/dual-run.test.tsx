import { DeployedPowerState } from "@ksp-gonogo/sitrep-sdk";
import {
  act,
  setupStreamFixture,
  waitFor,
  within,
} from "@ksp-gonogo/sitrep-sdk/testing";
import { renderWidget, visibleText } from "@ksp-gonogo/ui-kit/testing";
import { describe, expect, it } from "vitest";
// Side-effect import: `renderWidget` looks the widget up by id.
import "./index";

/** Proves a two-experiment Mun cluster renders off the real stream pipeline, grouped by `vesselName`, with its power-unit balance and progress. */
describe("DeployedScience: stream render golden (delay=0)", () => {
  it("renders the full deployed-cluster state off the stream pipeline", async () => {
    const fixture = setupStreamFixture({
      pinnedUt: 10,
    });

    const { container } = renderWidget("deployed-science", {
      instanceId: "ds-dual",
      w: 5,
      h: 9,
      wrapper: fixture.Provider,
    });

    act(() => {
      fixture.emit("game.dlc", { breakingGround: true });
      fixture.emit("deployed.bases", [
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
          // The DERIVED ordinal the widget branches on, alongside the prose it ignores.
          power: DeployedPowerState.Powered,
          controllerConnected: true,
          powerAvailable: 5,
          powerRequired: 4,
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
          // The DERIVED ordinal the widget branches on, alongside the prose it ignores.
          power: DeployedPowerState.Powered,
          controllerConnected: true,
          powerAvailable: 5,
          powerRequired: 4,
          deployedOnGround: true,
        },
      ]);
    });

    await waitFor(() => {
      if (!visibleText(container).includes("Seismic Accelerometer")) {
        throw new Error("stream leg has not rendered the deployed list yet");
      }
      if (visibleText(container).includes("SYNCING")) {
        throw new Error("stream status has not settled to live yet");
      }
    });

    const scope = within(container);
    expect(scope.getByText("Mun")).toBeInTheDocument();
    expect(scope.getByText(/Powered/i)).toBeInTheDocument();
    expect(scope.getByText("Seismic Accelerometer")).toBeInTheDocument();
    // `<Unit>` renders a number and a symbol, not one text node.
    expect(visibleText(container)).toContain("75 %");
    expect(scope.getByText("Mystery Goo Experiment")).toBeInTheDocument();
    expect(visibleText(container)).toContain("100 %");
  });
});
