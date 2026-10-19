import { DashboardItemContext } from "@ksp-gonogo/core";
import { act, render, screen, within } from "@ksp-gonogo/test-utils";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  type MockDataSourceFixture,
  setupMockDataSource,
  teardownMockDataSource,
} from "../test/setupMockDataSource";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { LaunchDirectorComponent } from "./index";

/** The craft list: searching it by name, and the crew and launch control opening under the picked craft. */

const PAD = {
  name: "LaunchPad",
  displayName: "Launchpad",
  editorFacility: "VAB",
  bodyIndex: 1,
  isStock: true,
  padOccupied: false,
  padVesselTitle: null,
};

const RUNWAY = {
  ...PAD,
  name: "Runway",
  displayName: "Island Airfield",
  editorFacility: "SPH",
};

function craft(name: string) {
  return {
    name,
    file: name,
    partCount: 4,
    totalMass: 0.5,
    facility: "VAB",
    facilityOrdinal: 1,
    requiresFunds: 500,
    missingParts: [],
  };
}

describe("LaunchDirector craft list", () => {
  let cmdFixture: MockDataSourceFixture;
  let stream: ReturnType<typeof setupStreamFixture>;

  beforeEach(async () => {
    cmdFixture = await setupMockDataSource({ keys: [] });
    stream = setupStreamFixture({ pinnedUt: 10, suspendFrames: true });
  });

  afterEach(() => {
    teardownMockDataSource(cmdFixture);
  });

  function renderWidget() {
    return render(
      <stream.Provider>
        <DashboardItemContext.Provider value={{ instanceId: "ld" }}>
          <LaunchDirectorComponent id="ld" h={18} />
        </DashboardItemContext.Provider>
      </stream.Provider>,
    );
  }

  function emit(
    sites: unknown[],
    ships: string[],
    roster: unknown[] = [
      {
        name: "Jeb",
        trait: "Pilot",
        experienceLevel: 3,
        available: true,
        unavailableReason: "",
        standing: 2,
        situation: "Available",
      },
    ],
  ) {
    act(() => {
      stream.emit("career.status", {
        balances: { funds: 100_000, reputation: 0, science: 0 },
        facilities: null,
        contracts: null,
        strategies: null,
        tech: null,
      });
      stream.emit("spaceCenter.launchSites", sites);
      stream.emit("spaceCenter.savedShips", ships.map(craft));
      stream.emit("spaceCenter.crewRoster", roster);
    });
  }

  it("lists exactly the launch sites the mod reported", async () => {
    renderWidget();
    emit([PAD, RUNWAY], ["Probe"]);

    expect(await screen.findByText("Launchpad")).toBeInTheDocument();
    expect(screen.getByText("Island Airfield")).toBeInTheDocument();
    expect(document.querySelectorAll("[data-pad-row]")).toHaveLength(2);
  });

  it("narrows the craft by name as the operator types", async () => {
    const user = userEvent.setup();
    renderWidget();
    emit([PAD], ["Station Core", "Station Module", "Mun Hopper"]);

    await user.type(
      await screen.findByRole("searchbox", { name: "Search craft" }),
      "station",
    );

    expect(screen.getByText("Station Core")).toBeInTheDocument();
    expect(screen.getByText("Station Module")).toBeInTheDocument();
    expect(screen.queryByText("Mun Hopper")).not.toBeInTheDocument();
  });

  it("says when no craft matches", async () => {
    const user = userEvent.setup();
    renderWidget();
    emit([PAD], ["Mun Hopper"]);

    await user.type(
      await screen.findByRole("searchbox", { name: "Search craft" }),
      "zzz",
    );

    expect(screen.getByText(/No craft match/)).toBeInTheDocument();
  });

  it("opens the crew and the launch control directly under the picked craft", async () => {
    const user = userEvent.setup();
    renderWidget();
    emit([PAD], ["Alpha", "Bravo", "Charlie"]);

    await user.click(await screen.findByText("Bravo"));

    const rows = Array.from(document.querySelectorAll("[data-ship-row]"));
    const bravo = rows.find((r) => r.textContent?.includes("Bravo"));
    const group = bravo?.closest("div")?.parentElement as HTMLElement;
    expect(within(group).getByText(/Launch Bravo/i)).toBeInTheDocument();
    expect(within(group).getByText("Jeb")).toBeInTheDocument();
    // The craft after the picked one comes below its controls, not above.
    const charlie = rows.find((r) => r.textContent?.includes("Charlie"));
    expect(
      group.compareDocumentPosition(charlie as Element) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });
});
