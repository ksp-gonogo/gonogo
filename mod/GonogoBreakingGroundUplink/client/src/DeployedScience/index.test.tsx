import { registerAugment } from "@ksp-gonogo/sitrep-sdk";
import {
  act,
  type StreamFixture,
  screen,
  setupStreamFixture,
  waitFor,
} from "@ksp-gonogo/sitrep-sdk/testing";
import { renderWidget } from "@ksp-gonogo/sitrep-testing";
import { clearAugments } from "@ksp-gonogo/ui-kit";
import { visibleText } from "@ksp-gonogo/ui-kit/testing";
import { afterEach, describe, expect, it } from "vitest";
import { type DeployedExperimentContext, parseBases } from "./index";

// One flat entry off the new `deployed.bases` wire (see index.tsx's
// `parseBases`/`groupFlatDeployedEntries`): grouped by `vesselName` into the
// widget's `DeployedBase[]` display shape client-side.
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
  deployedOnGround: true,
  ...over,
});

const CARRIED = ["deployed.bases", "game.dlc"] as const;

const renderedTrees: Array<() => void> = [];

function newFixture(): StreamFixture {
  return setupStreamFixture({ carriedChannels: CARRIED, pinnedUt: 10 });
}

function renderDeployed(fixture: StreamFixture) {
  // Through the registry, inside the dashboard's own provider stack, with the
  // stream fixture above it: what the app actually mounts.
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

  it("shows the no-bases state when nothing has streamed yet", () => {
    renderDeployed(newFixture());
    expect(screen.getByText(/No deployed bases/i)).toBeInTheDocument();
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
    // No EC numbers on the new wire, powerAvailable/powerRequired degrade to 0/0.
    expect(visibleText()).toMatch(/EC 0\/0/);
    expect(screen.getByText("Seismometer")).toBeInTheDocument();
    expect(visibleText()).toContain("50 %");
  });

  it("labels an unpowered base and a brownout base distinctly", async () => {
    const fixture = newFixture();
    renderDeployed(fixture);
    act(() => {
      fixture.emit("game.dlc", { breakingGround: true });
      fixture.emit("deployed.bases", [
        flatEntry({
          vesselName: "Mun Base",
          body: "Mun",
          powerState: "NoPower",
        }),
        flatEntry({
          vesselName: "Minmus Base",
          body: "Minmus",
          // Any non-empty, non-"Powered"/"NoPower" value maps to Brownout.
          powerState: "PartiallyPowered",
        }),
      ]);
    });
    await waitFor(() =>
      expect(screen.getByText(/Unpowered/i)).toBeInTheDocument(),
    );
    expect(screen.getByText(/Brownout/i)).toBeInTheDocument();
  });

  it("renders the augment slots with no bound augment (empty is fine)", async () => {
    // No augment registered → both slots compose nothing and the base card
    // renders exactly as before.
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

  it("renders a bound header-badges augment next to the title", async () => {
    registerAugment<"deployed-science.badges">({
      id: "test-deployed-badge",
      augments: "deployed-science.badges",
      component: () => <span data-testid="deployed-badge">RAD</span>,
    });

    const fixture = newFixture();
    renderDeployed(fixture);
    act(() => {
      fixture.emit("game.dlc", { breakingGround: true });
      fixture.emit("deployed.bases", [flatEntry()]);
    });

    await waitFor(() =>
      expect(screen.getByTestId("deployed-badge")).toHaveTextContent("RAD"),
    );
  });

  it("renders a bound sections augment per experiment card, carrying its datum", async () => {
    // A test Uplink binds `deployed-science.sections` and echoes back the
    // per-card experiment props. Proves (a) the slot is exposed, (b) an
    // augment composes into it once per experiment, and (c) the props carry
    // the right experiment/body so a per-card augment targets correctly.
    registerAugment<"deployed-science.sections">({
      id: "test-deployed-section",
      augments: "deployed-science.sections",
      component: ({ experiment, body }: DeployedExperimentContext) => (
        <span data-testid="deployed-section">
          {body}:{experiment.name}:{Math.round(experiment.progress * 100)}
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

    // One augment per experiment card, each carrying its own card's datum
    // (name + progress + body) in DOM order, proves the per-card props
    // identity is correct.
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

  it("drops bases with no numeric id and clamps experiment progress", () => {
    const parsed = parseBases([
      {
        id: 7,
        experiments: [{ name: "X", progress: 5 }],
      },
      { body: "no id" },
    ]);
    expect(parsed).toHaveLength(1);
    expect(parsed?.[0]?.experiments[0]?.progress).toBe(1);
    expect(parsed?.[0]?.experiments[0]?.collecting).toBe(false);
  });
});
