import { DashboardItemContext } from "@ksp-gonogo/core";
import { act, render, screen } from "@ksp-gonogo/test-utils";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  type MockDataSourceFixture,
  setupMockDataSource,
  teardownMockDataSource,
} from "../test/setupMockDataSource";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { LaunchDirectorComponent } from "./index";

/**
 * The crew half of the pad panel: which kerbals are offered, which are marked,
 * and what the panel does when the roster cannot be read at all.
 *
 * Kept apart from `index.test.tsx` because the three availability states are
 * one subject and each needs its own roster emit.
 */
const CARRIED = [
  "career.status",
  "spaceCenter.savedShips",
  "spaceCenter.crewRoster",
  "spaceCenter.scene",
  "spaceCenter.launchSites",
];

const PAD = {
  name: "LaunchPad",
  displayName: "KSC Pad",
  editorFacility: "VAB",
  body: "Kerbin",
  isStock: true,
  padOccupied: null,
  padVesselTitle: null,
};

const SHIP = {
  name: "Probe",
  partCount: 4,
  totalMass: 0.5,
  facility: "VAB",
  facilityOrdinal: 1,
  requiresFunds: 500,
  missingParts: [],
};

describe("LaunchDirector crew selection", () => {
  let cmdFixture: MockDataSourceFixture;
  let stream: ReturnType<typeof setupStreamFixture>;

  beforeEach(async () => {
    cmdFixture = await setupMockDataSource({ keys: [] });
    stream = setupStreamFixture({
      carriedChannels: CARRIED,
      pinnedUt: 10,
      suspendFrames: true,
    });
  });

  afterEach(() => {
    teardownMockDataSource(cmdFixture);
  });

  function renderWidget(id = "ld") {
    return render(
      <stream.Provider>
        <DashboardItemContext.Provider value={{ instanceId: id }}>
          <LaunchDirectorComponent id={id} />
        </DashboardItemContext.Provider>
      </stream.Provider>,
    );
  }

  /** Everything but the roster, so each test owns the availability it asserts. */
  function emitPadAndShip() {
    act(() => {
      stream.emit("career.status", {
        economy: { funds: 100_000, reputation: 0, science: 0 },
        facilities: null,
        contracts: null,
        strategies: null,
        tech: null,
      });
      stream.emit("spaceCenter.launchSites", [PAD]);
      stream.emit("spaceCenter.savedShips", [SHIP]);
    });
  }

  it("offers the launch when the roster has not been read", async () => {
    const user = userEvent.setup();
    renderWidget();
    emitPadAndShip();

    await user.click(await screen.findByText("Probe"));

    expect(screen.getByText(/Launch Probe unmanned/i)).toBeInTheDocument();
    expect(screen.getByText(/Roster — no reading/i)).toBeInTheDocument();
  });
});
