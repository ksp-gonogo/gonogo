import {
  CatalogContact,
  DeployedPowerState,
  registerAugment,
  Staleness,
} from "@ksp-gonogo/sitrep-sdk";
import {
  act,
  clearAugments,
  type StreamFixture,
  screen,
  setupStreamFixture,
  waitFor,
  within,
} from "@ksp-gonogo/sitrep-sdk/testing";
import { renderWidget, visibleText } from "@ksp-gonogo/ui-kit/testing";
import { afterEach, describe, expect, it } from "vitest";
import {
  catalogEntry,
  emitStations,
  experiment,
  MINMUS_STATION,
  MUN_STATION,
  reportTopic,
  stationReport,
} from "../test/deployedStations";
import {
  type DeployedExperimentContext,
  parseStation,
  stationsFromCatalog,
} from "./index";

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
      fixture.emit("trackingStation.catalog", { entries: [] });
    });
    await waitFor(() =>
      expect(
        screen.getByText(/Breaking Ground not installed/i),
      ).toBeInTheDocument(),
    );
  });

  it("shows the no-stations state when available but the catalog lists none", async () => {
    const fixture = newFixture();
    renderDeployed(fixture);
    act(() => {
      fixture.emit("game.dlc", { breakingGround: true });
      fixture.emit("trackingStation.catalog", { entries: [] });
    });
    await waitFor(() =>
      expect(screen.getByText(/No deployed stations/i)).toBeInTheDocument(),
    );
  });

  it("says it is waiting when the roster has not streamed yet", () => {
    renderDeployed(newFixture());
    expect(
      screen.getByText(/Waiting for the deployed-station roster/i),
    ).toBeInTheDocument();
    expect(screen.queryByText(/No deployed stations/i)).toBeNull();
  });

  it("lists only the controller vessels of deployed science", async () => {
    const fixture = newFixture();
    renderDeployed(fixture);
    act(() => {
      fixture.emit("game.dlc", { breakingGround: true });
      fixture.emit("trackingStation.catalog", {
        entries: [
          catalogEntry(),
          // A craft and a lone experiment part: neither is a station.
          catalogEntry({
            vesselId: "ship",
            name: "Kerbin Ship",
            vesselType: 0,
          }),
          catalogEntry({ vesselId: "part", name: "Lone Part", vesselType: 12 }),
        ],
      });
      fixture.emit(reportTopic(MUN_STATION), stationReport());
    });
    await screen.findByText("Mun Surface Base");
    expect(screen.queryByText("Kerbin Ship")).toBeNull();
    expect(screen.queryByText("Lone Part")).toBeNull();
  });

  it("renders a station with power balance and experiment progress", async () => {
    const fixture = newFixture();
    renderDeployed(fixture);
    await emitStations(fixture);
    await waitFor(() => expect(screen.getByText("Mun")).toBeInTheDocument());
    expect(screen.getByText(/Powered/i)).toBeInTheDocument();
    // Produced over required, in Breaking Ground power units.
    expect(visibleText()).toMatch(/Power 3\/2/);
    expect(screen.getByText("Seismometer")).toBeInTheDocument();
    expect(visibleText()).toContain("50 %");
  });

  it("says a station in contact is in contact and sending its science home", async () => {
    const fixture = newFixture();
    renderDeployed(fixture);
    await emitStations(fixture);
    await screen.findByText("In contact");
    expect(await screen.findByText("Sending home")).toBeInTheDocument();
    expect(screen.queryByText("No path home")).toBeNull();
  });

  it("shows two stations on their own links with the active craft somewhere else", async () => {
    // Nothing for the active craft is emitted at all: each card must read off its own station.
    const fixture = newFixture();
    renderDeployed(fixture);
    await emitStations(fixture, [
      {
        entry: {
          vesselId: MUN_STATION,
          name: "Mun Base",
          contact: CatalogContact.InContact,
          lastContactUt: 10,
        },
        report: stationReport({
          stationName: "Mun Base",
          body: "Mun",
          experiments: [experiment({ partName: "Seismometer" })],
        }),
      },
      {
        entry: {
          vesselId: MINMUS_STATION,
          name: "Minmus Base",
          contact: CatalogContact.Silent,
          lastContactUt: 4,
        },
        report: stationReport({
          stationName: "Minmus Base",
          body: "Minmus",
          experiments: [
            experiment({ partName: "Ion Detector", storedData: 14.5 }),
          ],
        }),
      },
    ]);
    const mun = await screen.findByRole("group", { name: "Mun Base" });
    const minmus = await screen.findByRole("group", { name: "Minmus Base" });

    expect(within(mun).getByText("In contact")).toBeInTheDocument();
    expect(within(minmus).getByText("Out of contact")).toBeInTheDocument();
    expect(within(minmus).queryByText("In contact")).toBeNull();
    // The one out of contact says when it was last heard and what it holds unsent.
    expect(within(minmus).getByText(/Last heard/)).toBeInTheDocument();
    expect(within(minmus).getByText(/Unsent/)).toBeInTheDocument();
    expect(within(minmus).getByText(/14\.5/)).toBeInTheDocument();
  });

  it("says no contact is on record rather than inventing a last-heard time", async () => {
    const fixture = newFixture();
    renderDeployed(fixture);
    await emitStations(fixture, [
      { entry: { contact: null, lastContactUt: null } },
    ]);
    await screen.findByText("Contact unknown");
    expect(screen.getByText("No contact on record")).toBeInTheDocument();
    expect(screen.queryByText(/Last heard/)).toBeNull();
  });

  it("says a station is overdue or lost, never merely out of contact", async () => {
    const fixture = newFixture();
    renderDeployed(fixture);
    await emitStations(fixture, [
      {
        entry: {
          vesselId: MUN_STATION,
          name: "Overdue Base",
          contact: CatalogContact.Overdue,
        },
        report: stationReport({ stationName: "Overdue Base" }),
      },
      {
        entry: {
          vesselId: MINMUS_STATION,
          name: "Lost Base",
          contact: CatalogContact.Lost,
        },
        report: stationReport({ stationName: "Lost Base" }),
      },
    ]);
    await screen.findByText("Overdue");
    expect(screen.getByText("Lost")).toBeInTheDocument();
    expect(screen.queryByText("Out of contact")).toBeNull();
  });

  it("says there is no path home when the game would refuse to send", async () => {
    const fixture = newFixture();
    renderDeployed(fixture);
    await emitStations(fixture, [
      {
        report: stationReport({ sendPathHome: false, dataSendFailed: true }),
      },
    ]);
    await screen.findByText("No path home");
    expect(screen.getByText("Last send failed")).toBeInTheDocument();
    expect(screen.queryByText("Sending home")).toBeNull();
  });

  it("draws no send verdict for a station whose path was not read", async () => {
    const fixture = newFixture();
    renderDeployed(fixture);
    await emitStations(fixture, [
      { report: stationReport({ sendPathHome: null, dataSendFailed: null }) },
    ]);
    await screen.findByText("Seismometer");
    expect(screen.queryByText("Sending home")).toBeNull();
    expect(screen.queryByText("No path home")).toBeNull();
    expect(screen.queryByText("Last send failed")).toBeNull();
  });

  it("sums the unsent data of every experiment, and only when each was read", async () => {
    const fixture = newFixture();
    renderDeployed(fixture);
    await emitStations(fixture, [
      {
        report: stationReport({
          experiments: [
            experiment({ partName: "A", storedData: 2.5 }),
            experiment({ partName: "B", storedData: 4 }),
          ],
        }),
      },
    ]);
    await screen.findByText(/Unsent/);
    expect(visibleText()).toMatch(/6\.5/);
  });

  it("draws no unsent figure when one experiment's store was not read", async () => {
    const fixture = newFixture();
    renderDeployed(fixture);
    await emitStations(fixture, [
      {
        report: stationReport({
          experiments: [
            experiment({ partName: "A", storedData: 2.5 }),
            experiment({ partName: "B", storedData: null }),
          ],
        }),
      },
    ]);
    await screen.findByText("A");
    expect(screen.queryByText(/Unsent/)).toBeNull();
  });

  it("says it is waiting for a station whose report has not arrived", async () => {
    const fixture = newFixture();
    renderDeployed(fixture);
    await emitStations(fixture, [{ report: null }]);
    await screen.findByText("Mun Surface Base");
    expect(
      screen.getByText(/Waiting for the station's report/i),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Power 0\/0/)).toBeNull();
  });

  it("holds only the station whose own link dropped", async () => {
    const fixture = newFixture();
    renderDeployed(fixture);
    await emitStations(fixture, [
      {
        entry: { vesselId: MUN_STATION, name: "Mun Base" },
        report: stationReport({ stationName: "Mun Base" }),
      },
      {
        entry: {
          vesselId: MINMUS_STATION,
          name: "Minmus Base",
          contact: CatalogContact.Silent,
        },
        report: null,
      },
    ]);
    act(() => {
      // The mod stamps the last sample out before a blackout as held.
      fixture.emit(
        reportTopic(MINMUS_STATION),
        stationReport({
          stationName: "Minmus Base",
          experiments: [experiment({ partName: "Ion Detector" })],
        }),
        { staleness: Staleness.LastBeforeBlackout },
      );
    });
    const mun = await screen.findByRole("group", { name: "Mun Base" });
    const minmus = await screen.findByRole("group", { name: "Minmus Base" });
    await waitFor(() =>
      expect(minmus.querySelector("[data-held-mark]")).not.toBeNull(),
    );
    expect(mun.querySelector("[data-held-mark]")).toBeNull();
    // A send verdict means something only while the report is current.
    expect(within(mun).getByText("Sending home")).toBeInTheDocument();
    expect(within(minmus).queryByText("Sending home")).toBeNull();
  });

  it("says the power balance is unknown rather than drawing a zero one", async () => {
    const fixture = newFixture();
    renderDeployed(fixture);
    await emitStations(fixture, [
      {
        report: stationReport({ powerAvailable: null, powerRequired: null }),
      },
    ]);
    await waitFor(() => expect(screen.getByText("Mun")).toBeInTheDocument());
    expect(visibleText()).toMatch(/Power unknown/);
    expect(visibleText()).not.toMatch(/Power \d/);
  });

  it("draws no balance when only one side of it arrived", async () => {
    const fixture = newFixture();
    renderDeployed(fixture);
    await emitStations(fixture, [
      { report: stationReport({ powerRequired: null }) },
    ]);
    await waitFor(() => expect(screen.getByText("Mun")).toBeInTheDocument());
    expect(visibleText()).toMatch(/Power unknown/);
    expect(visibleText()).not.toMatch(/Power 3/);
  });

  // Stock distinguishes only powered and unpowered, so nothing reaches the Brownout label.
  it("labels each of KSP's real power states, and produces no brownout", async () => {
    const fixture = newFixture();
    renderDeployed(fixture);
    await emitStations(fixture, [
      {
        entry: { vesselId: MUN_STATION, name: "Mun Base" },
        report: stationReport({
          stationName: "Mun Base",
          power: DeployedPowerState.Unpowered,
        }),
      },
      {
        entry: { vesselId: MINMUS_STATION, name: "Minmus Base" },
        report: stationReport({
          stationName: "Minmus Base",
          power: DeployedPowerState.ControllerDisabled,
        }),
      },
    ]);
    await waitFor(() =>
      expect(screen.getAllByText(/Unpowered/i).length).toBe(2),
    );
    expect(screen.queryByText(/Brownout/i)).toBeNull();
  });

  it("renders the augment slots with no bound augment (empty is fine)", async () => {
    const fixture = newFixture();
    renderDeployed(fixture);
    await emitStations(fixture);
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
    await emitStations(fixture, [
      {
        report: stationReport({
          body: "Mun",
          experiments: [
            experiment({
              partName: "Seismometer",
              experimentId: "a",
              scienceCompletedPercentage: 50,
            }),
            experiment({
              partName: "Ion Detector",
              experimentId: "b",
              scienceCompletedPercentage: 25,
            }),
          ],
        }),
      },
    ]);

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

describe("parseStation", () => {
  it("returns null for absent or non-object input", () => {
    expect(parseStation("s", undefined)).toBeNull();
    expect(parseStation("s", null)).toBeNull();
    expect(parseStation("s", [])).toBeNull();
  });

  it("clamps experiment progress and keeps the station's id", () => {
    const parsed = parseStation(
      "s",
      stationReport({
        experiments: [experiment({ scienceCompletedPercentage: 500 })],
      }),
    );
    expect(parsed?.id).toBe("s");
    expect(parsed?.experiments[0]?.progress).toBe(1);
  });

  it("reads the unsent data as the experiment's backlog", () => {
    const parsed = parseStation(
      "s",
      stationReport({ experiments: [experiment({ storedData: 3.5 })] }),
    );
    expect(parsed?.experiments[0]?.backlog).toBe(3.5);
  });
});

describe("stationsFromCatalog", () => {
  it("returns null for an unread catalog, which is not an empty one", () => {
    expect(stationsFromCatalog(undefined)).toBeNull();
    expect(stationsFromCatalog(null)).toBeNull();
  });

  it("keeps only controllers, by name, with their contact", () => {
    const listed = stationsFromCatalog({
      entries: [
        catalogEntry({
          vesselId: "b",
          name: "B",
          contact: CatalogContact.Silent,
        }),
        catalogEntry({ vesselId: "ship", name: "Ship", vesselType: 0 }),
        catalogEntry({ vesselId: "a", name: "A", lastContactUt: null }),
      ] as never,
    });
    expect(listed?.map((s) => s.vesselId)).toEqual(["a", "b"]);
    expect(listed?.[0]?.lastContactUt).toBeNull();
    expect(listed?.[1]?.contact).toBe(CatalogContact.Silent);
  });
});
