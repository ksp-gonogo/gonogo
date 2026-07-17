import { DashboardItemContext, registerStockBodies } from "@ksp-gonogo/core";
import { DefaultThemeProvider } from "@ksp-gonogo/ui-kit";
import { act, render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { getWidget } from "../../scripts/widgets";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { stripVolatile } from "../test/widgetDomSnapshot";
import { DeployedScienceComponent } from "./index";

/**
 * DeployedScience now reads its whole state off the canonical
 * `science.deployed` + `game.dlc` Topics (no legacy `DataSource` fallback),
 * so these scenarios are streamed through a genuine `TelemetryProvider` in the
 * NEW flat `science.deployed` wire shape (one entry per deployed experiment,
 * grouped client-side by `vesselName` — `groupFlatDeployedEntries`, index.tsx)
 * rather than the retired grouped-base `deployed.bases` shape. Two fields
 * degrade off the new wire and so read differently than the old fixtures did:
 * `powerAvailable`/`powerRequired` -> `0`/`0` (no EC numbers, only the coarse
 * `powerState` enum), and `collecting` is derived (`scienceCompletedPercentage
 * < 100`) rather than declared.
 */
const CARRIED = ["science.deployed", "game.dlc"];

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
  deployedOnGround: true,
  ...over,
});

const SCENARIOS: Record<string, Scenario> = {
  // A powered Mun base climbing on two experiments, and an unpowered Minmus
  // base at night — same qualitative story as the old `bases` fixture.
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
        powerState: "NoPower",
      }),
    ],
  },
  // Breaking Ground not installed — empty state.
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

  const { container } = render(
    <DefaultThemeProvider>
      <stream.Provider>
        <DashboardItemContext.Provider value={{ instanceId: "snap" }}>
          <DeployedScienceComponent id="snap" w={mode.w} h={mode.h} />
        </DashboardItemContext.Provider>
      </stream.Provider>
    </DefaultThemeProvider>,
  );

  act(() => {
    stream.emit("game.dlc", { breakingGround: scenario.breakingGround });
    stream.emit("science.deployed", scenario.entries);
  });

  // Flush two rAF ticks so the provider's ingest -> beginFrame() applies the
  // emitted values to React state before reading the DOM. Mirrors
  // widgetDomSnapshot.tsx's flushProviderFrame.
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
