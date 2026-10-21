import { DeployedPowerState, registerAugment } from "@ksp-gonogo/sitrep-sdk";
import {
  act,
  clearAugments,
  type StreamFixture,
  screen,
  setupStreamFixture,
  waitFor,
} from "@ksp-gonogo/sitrep-sdk/testing";

import { renderWidget, visibleText } from "@ksp-gonogo/ui-kit/testing";
import { afterEach, describe, expect, it } from "vitest";
import { type DeployedExperimentContext, parseBases } from "./index";

/** One flat entry off the `deployed.bases` wire, grouped by `vesselName` into a base. */
const flatEntry = (
  over: Record<string, unknown> = {},
): Record<string, unknown> => ({
  vesselName: "Mun Surface Base",
  partName: "Seismometer",
  body: "Mun",
  situation: "LANDED",
  biome: "Highlands",
  experimentId: "deployedSeismic",
  scienceCompletedPercentage: 50,
  scienceTransmittedPercentage: 50,
  scienceValue: 30,
  scienceLimit: 60,
  powerState: "Powered",
  connectionState: "Connected",
  // The derived fields the widget reads; the prose fields above are display labels only.
  power: DeployedPowerState.Powered,
  controllerConnected: true,
  // A surplus with unequal sides, so a transposition would show.
  powerAvailable: 3,
  powerRequired: 2,
  deployedOnGround: true,
  ...over,
});

const renderedTrees: Array<() => void> = [];

function newFixture(): StreamFixture {
  return setupStreamFixture({ pinnedUt: 10 });
}

function renderDeployed(fixture: StreamFixture) {
  // Through the registry and the dashboard's own provider stack, as the app mounts it.
  const result = renderWidget("deployed-science", {
    instanceId: "db",
    wrapper: fixture.Provider,
  });
  renderedTrees.push(result.unmount);
  return result;
}

describe("DeployedScienceComponent", () => {
  afterEach(() => {
    for (const unmount of renderedTrees) unmount();
    renderedTrees.length = 0;
    clearAugments();
  });

  it("shows the DLC-absent state when game.dlc.breakingGround is false", async () => {
    const fixture = newFixture();
    renderDeployed(fixture);
    act(() => {
      fixture.emit("game.dlc", { breakingGround: false });
      fixture.emit("deployed.bases", []);
    });
    await waitFor(() =>
      expect(
        screen.getByText(/Breaking Ground not installed/i),
      ).toBeInTheDocument(),
    );
  });

  it("shows the no-bases state when available but the list is empty", async () => {
    const fixture = newFixture();
    renderDeployed(fixture);
    act(() => {
      fixture.emit("game.dlc", { breakingGround: true });
      fixture.emit("deployed.bases", []);
    });
    await waitFor(() =>
      expect(screen.getByText(/No deployed bases/i)).toBeInTheDocument(),
    );
  });

  it("says it is waiting when the roster has not streamed yet", () => {
    renderDeployed(newFixture());
    expect(
      screen.getByText(/Waiting for the deployed-base roster/i),
    ).toBeInTheDocument();
    expect(screen.queryByText(/No deployed bases/i)).toBeNull();
  });

  it("renders a base with power balance and experiment progress", async () => {
    const fixture = newFixture();
    renderDeployed(fixture);
    act(() => {
      fixture.emit("game.dlc", { breakingGround: true });
      fixture.emit("deployed.bases", [flatEntry()]);
    });
    await waitFor(() => expect(screen.getByText("Mun")).toBeInTheDocument());
    expect(screen.getByText(/Powered/i)).toBeInTheDocument();
    // Produced over required, in Breaking Ground power units.
    expect(visibleText()).toMatch(/Power 3\/2/);
    expect(screen.getByText("Seismometer")).toBeInTheDocument();
    expect(visibleText()).toContain("50 %");
  });

  it("says the power balance is unknown rather than drawing a zero one", async () => {
    const fixture = newFixture();
    renderDeployed(fixture);
    act(() => {
      fixture.emit("game.dlc", { breakingGround: true });
      fixture.emit("deployed.bases", [
        flatEntry({ powerAvailable: null, powerRequired: null }),
      ]);
    });
    await waitFor(() => expect(screen.getByText("Mun")).toBeInTheDocument());
    expect(visibleText()).toMatch(/Power unknown/);
    expect(visibleText()).not.toMatch(/Power \d/);
  });

  it("draws no balance when only one side of it arrived", async () => {
    const fixture = newFixture();
    renderDeployed(fixture);
    act(() => {
      fixture.emit("game.dlc", { breakingGround: true });
      fixture.emit("deployed.bases", [flatEntry({ powerRequired: null })]);
    });
    await waitFor(() => expect(screen.getByText("Mun")).toBeInTheDocument());
    expect(visibleText()).toMatch(/Power unknown/);
    expect(visibleText()).not.toMatch(/Power 3/);
  });

  // Stock distinguishes only powered and unpowered, so nothing reaches the Brownout label.
  it("labels each of KSP's real power states, and produces no brownout", async () => {
    const fixture = newFixture();
    renderDeployed(fixture);
    act(() => {
      fixture.emit("game.dlc", { breakingGround: true });
      fixture.emit("deployed.bases", [
        flatEntry({
          vesselName: "Mun Base",
          body: "Mun",
          power: DeployedPowerState.Unpowered,
          // The prose says the opposite, and is ignored.
          powerState: "Powered",
        }),
        flatEntry({
          vesselName: "Minmus Base",
          body: "Minmus",
          power: DeployedPowerState.ControllerDisabled,
          powerState: "Powered",
        }),
      ]);
    });
    await waitFor(() =>
      expect(screen.getAllByText(/Unpowered/i).length).toBe(2),
    );
    expect(screen.queryByText(/Brownout/i)).toBeNull();
  });

  it("draws no brownout for an entry shaped as a whole base claiming partial power", async () => {
    const fixture = newFixture();
    renderDeployed(fixture);
    act(() => {
      fixture.emit("game.dlc", { breakingGround: true });
      fixture.emit("deployed.bases", [
        {
          id: 7,
          body: "Mun",
          powered: true,
          partialPower: true,
          experiments: [{ partId: 1, name: "Seismic Sensor", progress: 0.4 }],
        },
      ]);
    });
    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent("No deployed bases"),
    );
    expect(screen.queryByText(/Brownout/i)).toBeNull();
  });

  it("renders the augment slots with no bound augment (empty is fine)", async () => {
    const fixture = newFixture();
    renderDeployed(fixture);
    act(() => {
      fixture.emit("game.dlc", { breakingGround: true });
      fixture.emit("deployed.bases", [flatEntry()]);
    });
    await waitFor(() =>
      expect(screen.getByText("Seismometer")).toBeInTheDocument(),
    );
    expect(screen.queryByTestId("deployed-badge")).not.toBeInTheDocument();
    expect(screen.queryByTestId("deployed-section")).not.toBeInTheDocument();
  });

  it("renders a bound sections augment per experiment card, carrying its datum", async () => {
    // A test augment echoes back its per-card props, so each card must carry its own experiment and body.
    registerAugment<"deployed-science.experiment">({
      id: "test-deployed-section",
      augments: "deployed-science.experiment",
      component: ({ experiment, body }: DeployedExperimentContext) => (
        <span data-testid="deployed-section">
          {body}:{experiment.name}:
          {experiment.progress === null
            ? "unknown"
            : Math.round(experiment.progress * 100)}
        </span>
      ),
    });

    const fixture = newFixture();
    renderDeployed(fixture);
    act(() => {
      fixture.emit("game.dlc", { breakingGround: true });
      fixture.emit("deployed.bases", [
        flatEntry({
          vesselName: "Mun Base",
          body: "Mun",
          partName: "Seismometer",
          experimentId: "a",
          scienceCompletedPercentage: 50,
        }),
        flatEntry({
          vesselName: "Mun Base",
          body: "Mun",
          partName: "Ion Detector",
          experimentId: "b",
          scienceCompletedPercentage: 25,
        }),
      ]);
    });

    const sections = await waitFor(() => {
      const found = screen.getAllByTestId("deployed-section");
      expect(found).toHaveLength(2);
      return found;
    });
    expect(sections.map((s) => s.textContent)).toEqual([
      "Mun:Seismometer:50",
      "Mun:Ion Detector:25",
    ]);
  });
});

describe("parseBases", () => {
  it("returns null for absent or non-array input", () => {
    expect(parseBases(undefined)).toBeNull();
    expect(parseBases(null)).toBeNull();
    expect(parseBases({})).toBeNull();
  });

  it("groups by vesselName, drops entries without one and clamps experiment progress", () => {
    const parsed = parseBases([
      flatEntry({ scienceCompletedPercentage: 500 }),
      { body: "no vessel" },
    ]);
    expect(parsed).toHaveLength(1);
    expect(parsed?.[0]?.experiments[0]?.progress).toBe(1);
  });

  it("reads no base out of an entry shaped as a whole base rather than one experiment", () => {
    expect(
      parseBases([
        { id: 7, powered: true, partialPower: true, experiments: [] },
      ]),
    ).toEqual([]);
  });
});
