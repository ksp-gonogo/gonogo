import {
  DashboardItemContext,
  dispatchAction,
  getComponent,
} from "@ksp-gonogo/core";
import { act, render, screen, waitFor } from "@ksp-gonogo/test-utils";
import { expectNoA11yViolations } from "@ksp-gonogo/ui-kit/testing";
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
 * Each action presses the on-screen control it names, so every case here
 * asserts what a click on that control is already asserted to do in
 * `index.test.tsx`: arm on the first press, dispatch on the second, and do
 * nothing where the control is dark or not drawn.
 */
const CARRIED = [
  "career.status",
  "spaceCenter.savedShips",
  "spaceCenter.crewRoster",
  "spaceCenter.scene",
  "spaceCenter.launchSites",
  "vessel.orbit",
  "vessel.flight",
  "vessel.identity",
  "system.bodies",
  "ksp.revertAvailability",
  "crash.hasRecent",
  "crash.lastCrash",
  "target.available",
];

const ID = "ld";

describe("LaunchDirector actions", () => {
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

  function renderWidget() {
    return render(
      <stream.Provider>
        <DashboardItemContext.Provider value={{ instanceId: ID }}>
          <LaunchDirectorComponent id={ID} h={18} />
        </DashboardItemContext.Provider>
      </stream.Provider>,
    );
  }

  function press(action: string, value = true): void {
    act(() => {
      dispatchAction(ID, action, { kind: "button", value });
    });
  }

  function sent(command: string) {
    return stream.transport.sentCommands.filter((c) => c.command === command);
  }

  function emitPad() {
    act(() => {
      stream.emit("career.status", {
        economy: { funds: 100_000, reputation: 0, science: 0 },
        facilities: null,
        contracts: null,
        strategies: null,
        tech: null,
      });
      stream.emit("spaceCenter.scene", {
        scene: "SpaceCenter",
        launchSite: "LaunchPad",
      });
      stream.emit("spaceCenter.launchSites", [
        {
          name: "LaunchPad",
          displayName: "KSC Pad",
          editorFacility: "VAB",
          body: "Kerbin",
          isStock: true,
          padOccupied: null,
          padVesselTitle: null,
        },
      ]);
      stream.emit("spaceCenter.savedShips", [
        {
          name: "Mun Hopper",
          partCount: 12,
          totalMass: 5.5,
          facility: "VAB",
          facilityOrdinal: 1,
          requiresFunds: 8000,
          missingParts: [],
        },
      ]);
      stream.emit("spaceCenter.crewRoster", [
        {
          name: "Jebediah Kerman",
          trait: "Pilot",
          experienceLevel: 5,
          available: true,
          unavailableReason: "",
        },
      ]);
    });
  }

  function emitFlight(opts: {
    name: string;
    canRevertToLaunch?: boolean;
    crashed?: boolean;
  }) {
    act(() => {
      stream.emit("spaceCenter.savedShips", []);
      stream.emit("spaceCenter.scene", { scene: "Flight" });
      stream.emit("vessel.identity", {
        vesselId: opts.name,
        name: opts.name,
        vesselType: 0,
        situation: 0,
        parentBodyIndex: 1,
        launchUt: null,
      });
      stream.emit("ksp.revertAvailability", {
        canRevertToLaunch: opts.canRevertToLaunch ?? true,
        canRevertToEditor: true,
      });
      stream.emit("crash.hasRecent", opts.crashed === true);
      if (opts.crashed) {
        stream.emit("crash.lastCrash", { vesselName: opts.name });
      }
    });
  }

  it("lists every action on the definition the Inputs tab reads", () => {
    expect(getComponent("launch-director")?.actions?.map((a) => a.id)).toEqual([
      "launch",
      "recover",
      "revertToLaunch",
      "revertToEditor",
      "trackingStation",
    ]);
  });

  it("launch arms on the first press and launches the selected craft and crew on the second", async () => {
    const user = userEvent.setup();
    renderWidget();
    emitPad();

    await user.click(await screen.findByText(/Mun Hopper/));
    await user.click(screen.getByText(/Jebediah Kerman/));

    press("launch");
    expect(sent("ksp.launch")).toEqual([]);
    expect(screen.getByText(/Confirm launch/i)).toBeInTheDocument();

    press("launch");
    await waitFor(() =>
      expect(sent("ksp.launch")[0]).toMatchObject({
        args: {
          shipName: "Mun Hopper",
          facility: "VAB",
          site: "LaunchPad",
          crew: ["Jebediah Kerman"],
        },
      }),
    );
  });

  it("launch does nothing while no craft is selected, where there is no Launch control to click", async () => {
    renderWidget();
    emitPad();
    await screen.findByText(/Mun Hopper/);

    press("launch");
    press("launch");
    await act(async () => {});

    expect(sent("ksp.launch")).toEqual([]);
    expect(screen.queryByText(/Confirm launch/i)).not.toBeInTheDocument();
  });

  it("ignores the release of a held button", async () => {
    const user = userEvent.setup();
    renderWidget();
    emitPad();
    await user.click(await screen.findByText(/Mun Hopper/));

    press("launch", false);

    expect(screen.queryByText(/Confirm launch/i)).not.toBeInTheDocument();
    await act(async () => {});
  });

  it("recover does nothing while the control is dark for a crash of the active vessel", async () => {
    renderWidget();
    emitFlight({ name: "Doomed Probe", crashed: true });
    const recover = await screen.findByRole("button", { name: /^Recover$/i });
    expect(recover).toBeDisabled();

    press("recover");
    press("recover");
    await act(async () => {});

    expect(sent("ksp.recover")).toEqual([]);
    expect(screen.queryByText(/Confirm recover/i)).not.toBeInTheDocument();
  });

  it("recover arms, then recovers the vessel in flight", async () => {
    renderWidget();
    emitFlight({ name: "Lander" });
    await screen.findByText(/In flight: Lander/i);

    press("recover");
    expect(sent("ksp.recover")).toEqual([]);
    expect(screen.getByText(/Confirm recover/i)).toBeInTheDocument();

    press("recover");
    await waitFor(() =>
      expect(sent("ksp.recover")[0]).toMatchObject({ vantage: "meta" }),
    );
  });

  it("revertToLaunch does nothing while the save cannot revert", async () => {
    renderWidget();
    emitFlight({ name: "Probe", canRevertToLaunch: false });
    await screen.findByText(/Revert to launch \(n\/a\)/i);

    press("revertToLaunch");
    press("revertToLaunch");
    await act(async () => {});

    expect(sent("ksp.revertToLaunch")).toEqual([]);
  });

  it("revertToLaunch shows the game's refusal on the control, as a click does", async () => {
    stream.transport.setCommandHandler((command) =>
      command === "ksp.revertToLaunch"
        ? { success: false, errorCode: 9, detail: "no revert point" }
        : { success: true },
    );
    renderWidget();
    emitFlight({ name: "Probe" });
    await screen.findByText("Revert to launch");

    press("revertToLaunch");
    expect(screen.getByText(/Confirm revert to launch/i)).toBeInTheDocument();
    press("revertToLaunch");

    await waitFor(() =>
      expect(
        document.querySelector('[data-launch-action="refused-revert"]'),
      ).not.toBeNull(),
    );
    expect(sent("ksp.revertToLaunch")).toHaveLength(1);
  });

  it("revertToEditor arms, then reverts to the VAB", async () => {
    renderWidget();
    emitFlight({ name: "Probe" });
    await screen.findByText("Revert to VAB");

    press("revertToEditor");
    expect(sent("ksp.revertToEditor")).toEqual([]);
    press("revertToEditor");

    await waitFor(() =>
      expect(sent("ksp.revertToEditor")[0]).toMatchObject({
        args: { editor: "vab" },
        vantage: "meta",
      }),
    );
  });

  it("trackingStation arms the confirm, then saves and leaves", async () => {
    renderWidget();
    emitFlight({ name: "Probe" });
    await screen.findByText("Tracking Station");

    press("trackingStation");
    expect(sent("ksp.toTrackingStation")).toEqual([]);
    expect(screen.getByText(/Confirm: save and leave/i)).toBeInTheDocument();

    press("trackingStation");
    await waitFor(() =>
      expect(sent("ksp.toTrackingStation")[0]).toMatchObject({
        vantage: "meta",
      }),
    );
  });

  it("stays accessible with a control armed from an action", async () => {
    const { container } = renderWidget();
    emitFlight({ name: "Probe" });
    await screen.findByText("Revert to VAB");
    press("revertToEditor");
    await expectNoA11yViolations(container);
  });
});
