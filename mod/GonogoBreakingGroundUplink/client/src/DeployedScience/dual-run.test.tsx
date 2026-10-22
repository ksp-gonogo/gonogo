import { DeployedPowerState } from "@ksp-gonogo/sitrep-sdk";
import {
  setupStreamFixture,
  waitFor,
  within,
} from "@ksp-gonogo/sitrep-sdk/testing";
import { renderWidget, visibleText } from "@ksp-gonogo/ui-kit/testing";
import { describe, expect, it } from "vitest";
import {
  emitStations,
  experiment,
  stationReport,
} from "../test/deployedStations";
// Side-effect import: `renderWidget` looks the widget up by id.
import "./index";

/** Proves a two-experiment Mun station renders off the real stream pipeline, from the report on its own topic, with its power-unit balance and progress. */
describe("DeployedScience: stream render golden (delay=0)", () => {
  it("renders the full deployed-station state off the stream pipeline", async () => {
    const fixture = setupStreamFixture({
      pinnedUt: 10,
    });

    const { container } = renderWidget("deployed-science", {
      instanceId: "ds-dual",
      w: 5,
      h: 9,
      wrapper: fixture.Provider,
    });

    await emitStations(fixture, [
      {
        report: stationReport({
          stationName: "Mun Surface Science Base",
          power: DeployedPowerState.Powered,
          powerAvailable: 5,
          powerRequired: 4,
          experiments: [
            experiment({
              partName: "Seismic Accelerometer",
              experimentId: "surfaceExperimentSeismicAccelerometer",
              scienceCompletedPercentage: 75,
              scienceTransmittedPercentage: 50,
              scienceValue: 45,
              scienceLimit: 60,
            }),
            experiment({
              partName: "Mystery Goo Experiment",
              experimentId: "mysteryGoo",
              scienceCompletedPercentage: 100,
              scienceTransmittedPercentage: 100,
              scienceValue: 12,
              scienceLimit: 12,
            }),
          ],
        }),
      },
    ]);

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
