import {
  CatalogContact,
  DeployedPowerState,
  registerStockBodies,
} from "@ksp-gonogo/sitrep-sdk";
import { act, setupStreamFixture } from "@ksp-gonogo/sitrep-sdk/testing";
import { renderWidget } from "@ksp-gonogo/ui-kit/testing";
import { describe, expect, it } from "vitest";
import { getWidget } from "../../scripts/widgets";
import {
  emitStations,
  experiment,
  MINMUS_STATION,
  MUN_STATION,
  stationReport,
} from "../test/deployedStations";
import { stripVolatile } from "../test/widgetDomSnapshot";
// Side-effect import: `renderWidget` looks the widget up by id.
import "./index";

/** DOM snapshots streamed through a real `TelemetryProvider`: the catalog names each station and each station reports on its own topic. */

interface Scenario {
  breakingGround: boolean;
  stations: Array<{
    entry?: Record<string, unknown>;
    report?: Record<string, unknown> | null;
  }>;
}

const SCENARIOS: Record<string, Scenario> = {
  // A Mun station in contact and climbing on two experiments, and a Minmus station out of contact.
  stations: {
    breakingGround: true,
    stations: [
      {
        entry: {
          vesselId: MUN_STATION,
          name: "Mun Deployed Base",
          contact: CatalogContact.InContact,
          lastContactUt: 10,
        },
        report: stationReport({
          stationName: "Mun Deployed Base",
          body: "Mun",
          powerAvailable: 4,
          powerRequired: 3,
          experiments: [
            experiment({
              partName: "Seismometer",
              experimentId: "seismic",
              scienceCompletedPercentage: 75,
              scienceValue: 45,
              scienceLimit: 60,
            }),
            experiment({
              partName: "Mystery Goo",
              experimentId: "goo",
              scienceCompletedPercentage: 40,
              scienceValue: 12,
              scienceLimit: 30,
            }),
          ],
        }),
      },
      {
        entry: {
          vesselId: MINMUS_STATION,
          name: "Minmus Deployed Base",
          contact: CatalogContact.Silent,
          lastContactUt: 4,
        },
        report: stationReport({
          stationName: "Minmus Deployed Base",
          body: "Minmus",
          power: DeployedPowerState.Unpowered,
          // Unpowered on the cluster's own scale: demand met by nothing.
          powerAvailable: 0,
          powerRequired: 3,
          experiments: [
            experiment({
              partName: "Weather Station",
              experimentId: "weather",
              scienceCompletedPercentage: 50,
              scienceValue: 20,
              scienceLimit: 40,
              storedData: 14.5,
            }),
          ],
        }),
      },
    ],
  },
  unavailable: {
    breakingGround: false,
    stations: [],
  },
};

async function snapshotDeployedScienceScenario(
  scenario: Scenario,
  mode: { name: string; w: number; h: number },
): Promise<string> {
  registerStockBodies();
  const stream = setupStreamFixture({ pinnedUt: 10 });

  const { container } = renderWidget("deployed-science", {
    instanceId: "snap",
    w: mode.w,
    h: mode.h,
    wrapper: stream.Provider,
  });

  if (scenario.breakingGround) {
    await emitStations(stream, scenario.stations);
  } else {
    act(() => {
      stream.emit("game.dlc", { breakingGround: false });
      stream.emit("trackingStation.catalog", { entries: [] });
    });
  }

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
