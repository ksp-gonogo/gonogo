import {
  DeployedPowerState,
  registerStockBodies,
} from "@ksp-gonogo/sitrep-sdk";
import { act, setupStreamFixture } from "@ksp-gonogo/sitrep-sdk/testing";
import { renderWidget } from "@ksp-gonogo/ui-kit/testing";
import { describe, expect, it } from "vitest";
import { getWidget } from "../../scripts/widgets";
import { stripVolatile } from "../test/widgetDomSnapshot";
// Side-effect import: `renderWidget` looks the widget up by id.
import "./index";

/** DOM snapshots streamed through a real `TelemetryProvider` in the flat `deployed.bases` shape, one entry per deployed experiment. */
const CARRIED = ["deployed.bases", "game.dlc"];

interface Scenario {
  breakingGround: boolean;
  entries: Array<Record<string, unknown>>;
}

const flatEntry = (
  over: Record<string, unknown> = {},
): Record<string, unknown> => ({
  vesselName: "Deployed Base",
  partName: "Experiment",
  body: "Mun",
  situation: "LANDED",
  biome: "Highlands",
  experimentId: "experiment",
  scienceCompletedPercentage: 50,
  scienceTransmittedPercentage: 50,
  scienceValue: 20,
  scienceLimit: 40,
  powerState: "Powered",
  connectionState: "Connected",
  // The derived fields the widget reads; the prose fields above are display labels only.
  power: DeployedPowerState.Powered,
  controllerConnected: true,
  powerAvailable: 4,
  powerRequired: 3,
  deployedOnGround: true,
  ...over,
});

const SCENARIOS: Record<string, Scenario> = {
  // A powered Mun base climbing on two experiments, and an unpowered Minmus base at night.
  bases: {
    breakingGround: true,
    entries: [
      flatEntry({
        vesselName: "Mun Deployed Base",
        body: "Mun",
        partName: "Seismometer",
        experimentId: "seismic",
        scienceCompletedPercentage: 75,
        scienceValue: 45,
        scienceLimit: 60,
        powerState: "Powered",
      }),
      flatEntry({
        vesselName: "Mun Deployed Base",
        body: "Mun",
        partName: "Mystery Goo",
        experimentId: "goo",
        scienceCompletedPercentage: 40,
        scienceValue: 12,
        scienceLimit: 30,
        powerState: "Powered",
      }),
      flatEntry({
        vesselName: "Minmus Deployed Base",
        body: "Minmus",
        partName: "Weather Station",
        experimentId: "weather",
        scienceCompletedPercentage: 50,
        scienceValue: 20,
        scienceLimit: 40,
        powerState: "Unpowered",
        power: DeployedPowerState.Unpowered,
        // Unpowered on the cluster's own scale: demand met by nothing.
        powerAvailable: 0,
        powerRequired: 3,
      }),
    ],
  },
  unavailable: {
    breakingGround: false,
    entries: [],
  },
};

async function snapshotDeployedScienceScenario(
  scenario: Scenario,
  mode: { name: string; w: number; h: number },
): Promise<string> {
  registerStockBodies();
  const stream = setupStreamFixture({ carriedChannels: CARRIED, pinnedUt: 10 });

  const { container } = renderWidget("deployed-science", {
    instanceId: "snap",
    w: mode.w,
    h: mode.h,
    wrapper: stream.Provider,
  });

  act(() => {
    stream.emit("game.dlc", { breakingGround: scenario.breakingGround });
    stream.emit("deployed.bases", scenario.entries);
  });

  // Two rAF ticks, so the provider's frame applies the emitted values before the DOM is read.
  await act(async () => {
    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
    });
  });

  return stripVolatile(container.innerHTML);
}

const config = getWidget("deployed-science");
if (!config) throw new Error("deployed-science missing from widgets.ts");

describe("DeployedScience DOM snapshots", () => {
  for (const [name, scenario] of Object.entries(SCENARIOS)) {
    for (const mode of config.modes) {
      it(`${name} @ ${mode.name}`, async () => {
        const html = await snapshotDeployedScienceScenario(scenario, mode);
        expect(html).toMatchSnapshot();
      });
    }
  }
});
