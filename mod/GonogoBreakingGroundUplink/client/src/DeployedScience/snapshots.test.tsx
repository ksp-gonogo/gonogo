import {
  DeployedPowerState,
  registerStockBodies,
} from "@ksp-gonogo/sitrep-sdk";
import { act, setupStreamFixture } from "@ksp-gonogo/sitrep-sdk/testing";
import { renderWidget } from "@ksp-gonogo/ui-kit/testing";
import { describe, expect, it } from "vitest";
import { getWidget } from "../../scripts/widgets";
import { stripVolatile } from "../test/widgetDomSnapshot";
// Side-effect import: the widget self-registers on module load, and
// `renderWidget` looks it up by id rather than importing the component.
import "./index";

/**
 * DeployedScience now reads its whole state off the canonical
 * `deployed.bases` + `game.dlc` Topics (no legacy `DataSource` fallback),
 * so these scenarios are streamed through a genuine `TelemetryProvider` in the
 * NEW flat `deployed.bases` wire shape (one entry per deployed experiment,
 * grouped client-side by `vesselName`: `groupFlatDeployedEntries`, index.tsx)
 * rather than the retired grouped-base `deployed.bases` shape. Two fields
 * degrade off the new wire and so read differently than the old fixtures did:
 * `powerAvailable`/`powerRequired` -> `0`/`0` (no EC numbers, only the coarse
 * `powerState` enum), and `collecting` is derived (`scienceCompletedPercentage
 * < 100`) rather than declared.
 */
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
  // The DERIVED fields, which is what the widget reads; the two prose fields
  // above are display labels only.
  power: DeployedPowerState.Powered,
  controllerConnected: true,
  deployedOnGround: true,
  ...over,
});

const SCENARIOS: Record<string, Scenario> = {
  // A powered Mun base climbing on two experiments, and an unpowered Minmus
  // base at night: same qualitative story as the old `bases` fixture.
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
        // "NoPower" was here, a string KSP has never emitted; the scenario's own
        // comment says this base is meant to be unpowered, and under the old
        // string comparison it rendered as a brownout instead.
        powerState: "Unpowered",
        power: DeployedPowerState.Unpowered,
      }),
    ],
  },
  // Breaking Ground not installed: empty state.
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
