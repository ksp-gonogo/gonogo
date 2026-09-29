import {
  clearAugments,
  DashboardItemContext,
  registerAugment,
} from "@ksp-gonogo/core";
import { act, render, screen, waitFor } from "@ksp-gonogo/test-utils";
import { NULL_DISPLAY } from "@ksp-gonogo/ui-kit";
import { visibleText } from "@ksp-gonogo/ui-kit/testing";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  type MockDataSourceFixture,
  setupMockDataSource,
  teardownMockDataSource,
} from "../test/setupMockDataSource";
import { setupStreamFixture } from "../test/setupStreamFixture";
import {
  LaunchDirectorComponent,
  type LaunchDirectorSlotContext,
  parseCrew,
  parseLaunchSites,
  parseSavedShips,
} from "./index";

/**
 * Reads are asserted by emitting and writes by reading
 * `stream.transport.sentCommands`. Every in-flight scenario reports a `null`
 * `launchUt`, so the mission clock renders NULL_DISPLAY throughout.
 */

function emitFunds(
  stream: ReturnType<typeof setupStreamFixture>,
  funds: number,
) {
  stream.emit("career.status", {
    balances: { funds, reputation: 0, science: 0 },
    facilities: null,
    contracts: null,
    strategies: null,
    tech: null,
  });
}

function emitScene(
  stream: ReturnType<typeof setupStreamFixture>,
  scene: string,
  launchSite?: string,
) {
  stream.emit("spaceCenter.scene", { scene, launchSite });
}

/** Feeds `vessel.identity` with a `null` launchUt, and `vessel.flight` for the altitude. */
function emitInFlightVessel(
  stream: ReturnType<typeof setupStreamFixture>,
  opts: { name: string; altitudeAsl: number },
) {
  stream.emit("vessel.identity", {
    vesselId: opts.name,
    name: opts.name,
    vesselType: 0,
    situation: 0,
    parentBodyIndex: 1,
    launchUt: null,
  });
  stream.emit("vessel.flight", {
    latitude: -0.1,
    longitude: -74.6,
    altitudeAsl: opts.altitudeAsl,
    altitudeTerrain: opts.altitudeAsl,
    verticalSpeed: 0,
    surfaceSpeed: 0,
    orbitalSpeed: 0,
    gForce: 1,
    dynamicPressureKPa: 0,
    mach: 0,
    atmDensity: 0,
  });
}

/** One `spaceCenter.launchSites` entry in the mod's own shape, occupancy absent unless the scenario is about it. */
function padSite(
  name: string,
  displayName: string,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    name,
    displayName,
    editorFacility: "VAB",
    bodyIndex: 1,
    isStock: true,
    padOccupied: null,
    padVesselTitle: null,
    ...overrides,
  };
}

/** Every `ksp.launch` this render dispatched onto the stream, newest last. */
function sentLaunches(stream: ReturnType<typeof setupStreamFixture>) {
  return stream.transport.sentCommands.filter(
    (c) => c.command === "ksp.launch",
  );
}

describe("LaunchDirectorComponent", () => {
  let cmdFixture: MockDataSourceFixture;
  let stream: ReturnType<typeof setupStreamFixture>;

  beforeEach(async () => {
    cmdFixture = await setupMockDataSource({ keys: [] });
    stream = setupStreamFixture({
      pinnedUt: 10,
      suspendFrames: true,
    });
  });

  afterEach(() => {
    teardownMockDataSource(cmdFixture);
  });

  /** Tall by default so the crew grid stands open; see the note in crew.test.tsx. */
  function renderWidget(id = "ld", h = 18) {
    return render(
      <stream.Provider>
        <DashboardItemContext.Provider value={{ instanceId: id }}>
          <LaunchDirectorComponent id={id} h={h} />
        </DashboardItemContext.Provider>
      </stream.Provider>,
    );
  }

  it("shows the awaiting placeholder before any telemetry", () => {
    renderWidget();
    expect(
      screen.getByText(/Awaiting launch-pad telemetry/i),
    ).toBeInTheDocument();
  });

  it("filters out craft with missing parts and unaffordable cost", async () => {
    renderWidget();
    act(() => {
      emitFunds(stream, 5000);
      stream.emit("spaceCenter.launchSites", [padSite("LaunchPad", "KSC Pad")]);
      stream.emit("spaceCenter.savedShips", [
        {
          name: "Cheap Probe",
          partCount: 5,
          totalMass: 1.2,
          facility: "VAB",
          requiresFunds: 1500,
          missingParts: [],
        },
        {
          name: "Expensive Lander",
          partCount: 30,
          totalMass: 18,
          facility: "VAB",
          requiresFunds: 99000,
          missingParts: [],
        },
        {
          name: "Tech-Locked Plane",
          partCount: 8,
          totalMass: 3,
          facility: "SPH",
          requiresFunds: 800,
          missingParts: ["nuclearEngine"],
        },
      ]);
    });
    // Two of the three craft come out of the VAB; the spaceplane belongs to the runway.
    await waitFor(() => expect(visibleText()).toMatch(/1\/2 ready/i));
    expect(visibleText()).toMatch(/Expensive Lander/);
    expect(visibleText()).not.toMatch(/Tech-Locked Plane/);
  });

  it("lists the pads with an occupied one first, and says which are unreported", async () => {
    renderWidget();
    act(() => {
      stream.emit("spaceCenter.savedShips", []);
      stream.emit("spaceCenter.launchSites", [
        padSite("Runway", "KSC Runway", { editorFacility: "SPH" }),
        padSite("Woomerang_Launch_Site", "Woomerang"),
        padSite("LaunchPad", "KSC Pad", {
          padOccupied: true,
          padVesselTitle: "Kerbal X",
        }),
      ]);
    });

    const rows = await screen.findAllByRole("button", { pressed: false });
    expect(
      screen
        .getAllByRole("button")
        .filter((b) => b.hasAttribute("data-pad-row"))
        .map((b) => b.textContent),
    ).toEqual([
      expect.stringContaining("KSC Pad"),
      expect.stringContaining("KSC Runway"),
      expect.stringContaining("Woomerang"),
    ]);
    expect(rows.length).toBeGreaterThan(0);
    expect(screen.getByText("On pad: Kerbal X")).toBeInTheDocument();
    // A site that reported no occupancy says so rather than rendering as clear.
    expect(screen.getAllByText("Occupancy unreported")).toHaveLength(2);
  });

  it("names a pad's body only when its index resolves to a body away from home", async () => {
    renderWidget();
    const padRowText = (name: string) =>
      screen
        .getAllByRole("button")
        .find(
          (b) =>
            b.hasAttribute("data-pad-row") && b.textContent?.includes(name),
        )?.textContent;
    act(() => {
      stream.emit("spaceCenter.savedShips", []);
      stream.emit("spaceCenter.launchSites", [
        padSite("LaunchPad", "KSC Pad"),
        padSite("MunBase", "Mun Base", { bodyIndex: 2 }),
        padSite("Farside", "Farside", { bodyIndex: 17 }),
        padSite("Nowhere", "Unplaced", { bodyIndex: null }),
      ]);
    });
    await screen.findByText("Mun Base");
    // Before the catalogue arrives an index names nothing, and nothing stands in for it.
    expect(padRowText("Mun Base")).not.toContain("·");
    expect(padRowText("KSC Pad")).not.toContain("Kerbin");

    act(() => {
      stream.emit("system.bodies", {
        bodies: [
          { name: "Sun", index: 0, isHome: false },
          { name: "Kerbin", index: 1, isHome: true },
          { name: "Mun", index: 2, isHome: false },
        ],
      });
    });
    await waitFor(() => expect(padRowText("Mun Base")).toContain("Pad · Mun"));
    expect(padRowText("KSC Pad")).not.toContain("·");
    expect(padRowText("Farside")).not.toContain("·");
    expect(padRowText("Unplaced")).not.toContain("·");
  });

  it("says it is waiting rather than offering a launch it cannot aim", async () => {
    // Saved craft but no pads: a widget whose subject is the pads has nothing to show and says so.
    renderWidget();
    act(() => {
      emitFunds(stream, 100_000);
      stream.emit("spaceCenter.savedShips", [
        {
          name: "Mun Hopper",
          partCount: 12,
          totalMass: 5.5,
          facility: "VAB",
          requiresFunds: 8000,
          missingParts: [],
        },
      ]);
    });

    expect(
      await screen.findByText(/Awaiting launch-pad telemetry/i),
    ).toBeInTheDocument();
    expect(screen.queryByText("Mun Hopper")).not.toBeInTheDocument();
  });

  it("requires arm-then-confirm before firing ksp.launch", async () => {
    const user = userEvent.setup();
    renderWidget();
    act(() => {
      emitFunds(stream, 100_000);
      emitScene(stream, "SpaceCenter", "LaunchPad");
      stream.emit("spaceCenter.launchSites", [padSite("LaunchPad", "KSC Pad")]);
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

    await user.click(await screen.findByText(/Mun Hopper/));
    await user.click(screen.getByText(/Jebediah Kerman/));

    await user.click(screen.getByText(/Launch Mun Hopper \(1 crew\)/i));
    expect(sentLaunches(stream)).toEqual([]);

    await user.click(screen.getByText(/Confirm launch/i));
    await waitFor(() =>
      expect(sentLaunches(stream)[0]).toMatchObject({
        args: {
          shipName: "Mun Hopper",
          facility: "VAB",
          site: "LaunchPad",
          crew: ["Jebediah Kerman"],
        },
      }),
    );
  });

  /** An unseen facility name is dispatched as the editor its ORDINAL names: ordinal 2 is the SPH whatever KSP calls it. */
  it("dispatches the editor the ORDINAL names, not the unrecognised facility label", async () => {
    const user = userEvent.setup();
    renderWidget();
    act(() => {
      emitFunds(stream, 100_000);
      emitScene(stream, "SpaceCenter", "Runway");
      stream.emit("spaceCenter.launchSites", [
        padSite("Runway", "KSC Runway", { editorFacility: "SPH" }),
      ]);
      stream.emit("spaceCenter.savedShips", [
        {
          name: "Spaceplane",
          partCount: 20,
          totalMass: 9,
          // What a future KSP, or a mod adding an editor, might call the SPH.
          facility: "Hangar",
          facilityOrdinal: 2,
          requiresFunds: 12000,
          missingParts: [],
        },
      ]);
      // Launch controls are gated on the roster having ARRIVED, so an empty one is needed even unmanned.
      stream.emit("spaceCenter.crewRoster", []);
    });

    await user.click(await screen.findByText(/Spaceplane/));
    await user.click(screen.getByText(/Launch Spaceplane unmanned/i));
    await user.click(screen.getByText(/Confirm launch/i));

    await waitFor(() =>
      expect(sentLaunches(stream)[0]).toMatchObject({
        args: { shipName: "Spaceplane", facility: "SPH" },
      }),
    );
  });

  /** With no ordinal, the raw name goes through untouched so the mod can refuse it. */
  it("passes an unresolvable facility through rather than picking an editor", async () => {
    const user = userEvent.setup();
    renderWidget();
    act(() => {
      emitFunds(stream, 100_000);
      emitScene(stream, "SpaceCenter", "Foundry_Site");
      // A site whose editor this build does not recognise offers every craft.
      stream.emit("spaceCenter.launchSites", [
        padSite("Foundry_Site", "The Foundry", { editorFacility: "Foundry" }),
      ]);
      stream.emit("spaceCenter.savedShips", [
        {
          name: "Mystery Craft",
          partCount: 3,
          totalMass: 1,
          facility: "Foundry",
          requiresFunds: 100,
          missingParts: [],
        },
      ]);
      // Launch controls are gated on the roster having ARRIVED, so an empty one is needed even unmanned.
      stream.emit("spaceCenter.crewRoster", []);
    });

    await user.click(await screen.findByText(/Mystery Craft/));
    await user.click(screen.getByText(/Launch Mystery Craft unmanned/i));
    await user.click(screen.getByText(/Confirm launch/i));

    await waitFor(() =>
      expect(sentLaunches(stream)[0]).toMatchObject({
        args: { shipName: "Mystery Craft", facility: "Foundry" },
      }),
    );
  });

  it("switches to recover / revert controls when the pad is occupied", async () => {
    const user = userEvent.setup();
    renderWidget();
    act(() => {
      // Present so the awaiting placeholder clears.
      stream.emit("spaceCenter.savedShips", []);
      stream.emit("spaceCenter.launchSites", [
        padSite("LaunchPad", "KSC Pad", {
          padOccupied: true,
          padVesselTitle: "Kerbal X",
        }),
      ]);
    });

    expect(await screen.findByText(/On pad: Kerbal X/i)).toBeInTheDocument();

    await user.click(screen.getByText("Recover"));
    await user.click(screen.getByText(/Confirm recover/i));
    await waitFor(() => {
      const sent = stream.transport.sentCommands.find(
        (c) => c.command === "ksp.recover",
      );
      expect(sent).toMatchObject({ vantage: "meta" });
    });
  });

  it("shows the in-flight panel with altitude + revert affordances when scene is Flight", async () => {
    const user = userEvent.setup();
    const { container } = renderWidget();
    act(() => {
      stream.emit("spaceCenter.savedShips", []);
      emitScene(stream, "Flight");
      emitInFlightVessel(stream, { name: "Stayputnik X", altitudeAsl: 72_400 });
      stream.emit("ksp.revertAvailability", {
        canRevertToLaunch: true,
        canRevertToEditor: true,
      });
      stream.emit("crash.hasRecent", false);
    });

    expect(
      await screen.findByText(/In flight: Stayputnik X/i),
    ).toBeInTheDocument();
    // `launchUt` is null, so the mission clock shows NULL_DISPLAY.
    expect(screen.getByText(NULL_DISPLAY)).toBeInTheDocument();
    expect(visibleText(container)).toContain("72.4 km");
    expect(screen.getByText("Revert to launch")).toBeInTheDocument();
    expect(screen.getByText("Revert to VAB")).toBeInTheDocument();

    await user.click(screen.getByText("Revert to launch"));
    await user.click(screen.getByText(/Confirm revert to launch/i));
    await waitFor(() => {
      const sent = stream.transport.sentCommands.find(
        (c) => c.command === "ksp.revertToLaunch",
      );
      expect(sent).toMatchObject({ vantage: "meta" });
    });
  });

  it("requires arm-then-confirm for Revert to VAB (flight-ending)", async () => {
    const user = userEvent.setup();
    renderWidget();
    act(() => {
      stream.emit("spaceCenter.savedShips", []);
      emitScene(stream, "Flight");
      emitInFlightVessel(stream, { name: "Stayputnik X", altitudeAsl: 100 });
      stream.emit("ksp.revertAvailability", {
        canRevertToLaunch: false,
        canRevertToEditor: true,
      });
      stream.emit("crash.hasRecent", false);
    });

    // First click arms: must NOT fire the flight-ending revert yet.
    await user.click(await screen.findByText("Revert to VAB"));
    expect(
      stream.transport.sentCommands.filter(
        (c) => c.command === "ksp.revertToEditor",
      ),
    ).toHaveLength(0);

    await user.click(screen.getByText(/Confirm revert to VAB/i));
    await waitFor(() => {
      const sent = stream.transport.sentCommands.find(
        (c) => c.command === "ksp.revertToEditor",
      );
      expect(sent).toMatchObject({ args: { editor: "vab" }, vantage: "meta" });
    });
  });

  it("surfaces a crash chip when the active vessel itself crashed, and leaves Recover to the command", async () => {
    renderWidget();
    act(() => {
      stream.emit("spaceCenter.savedShips", []);
      emitScene(stream, "Flight");
      emitInFlightVessel(stream, { name: "Doomed Probe", altitudeAsl: 50 });
      stream.emit("ksp.revertAvailability", {
        canRevertToLaunch: false,
        canRevertToEditor: false,
      });
      stream.emit("crash.hasRecent", true);
      stream.emit("crash.lastCrash", { vesselName: "Doomed Probe" });
    });

    expect(await screen.findByText(/Crash in progress/i)).toBeInTheDocument();
    const recoverBtn = screen.getByRole("button", { name: /^Recover$/i });
    expect(recoverBtn).not.toHaveAttribute("aria-disabled");
  });

  // Tracking Station mid-flight reverts the flight (KSP cannot save there), so it needs arm-then-confirm.
  it("requires a confirm step before firing ksp.toTrackingStation", async () => {
    const user = userEvent.setup();
    renderWidget();
    act(() => {
      stream.emit("spaceCenter.savedShips", []);
      emitScene(stream, "Flight");
      emitInFlightVessel(stream, { name: "Probe X", altitudeAsl: 2000 });
      stream.emit("ksp.revertAvailability", {
        canRevertToLaunch: true,
        canRevertToEditor: true,
      });
      stream.emit("crash.hasRecent", false);
    });

    // First click arms the confirm: no execute fired yet.
    await user.click(await screen.findByText("Tracking Station"));
    expect(
      stream.transport.sentCommands.filter(
        (c) => c.command === "ksp.toTrackingStation",
      ),
    ).toHaveLength(0);
    // Confirm step is visible.
    const confirm = screen.getByText(/Confirm: save and leave/i);
    await user.click(confirm);
    await waitFor(() => {
      const sent = stream.transport.sentCommands.find(
        (c) => c.command === "ksp.toTrackingStation",
      );
      expect(sent).toMatchObject({ vantage: "meta" });
    });
  });

  /*
   * The switcher dispatches the roster's stable `vesselId` guid, never a
   * positional index. Body-kind entries are not offered, and a SpaceObject
   * stays hidden until the toggle is used.
   */
  it("switches vessel via target.available, dispatching the stable vesselId guid", async () => {
    const user = userEvent.setup();
    renderWidget();
    act(() => {
      stream.emit("spaceCenter.savedShips", []);
      emitScene(stream, "Flight");
      emitInFlightVessel(stream, { name: "Probe X", altitudeAsl: 2000 });
      stream.emit("ksp.revertAvailability", {
        canRevertToLaunch: false,
        canRevertToEditor: false,
      });
      stream.emit("crash.hasRecent", false);
      stream.emit("target.available", {
        entries: [
          {
            kind: 0, // TargetKind.Vessel
            name: "Relay Sat A",
            vesselId: "vessel-guid-aaa",
            vesselType: 6, // VesselType.Relay
            situation: 3, // Situation.Orbiting
            distance: 5000,
            isCurrent: false,
          },
          {
            kind: 0,
            name: "Mun Rock",
            vesselId: "vessel-guid-space-object",
            vesselType: 10, // VesselType.SpaceObject
            situation: 3,
            distance: 1000,
            isCurrent: false,
          },
          {
            kind: 1, // TargetKind.Body: never offered by the switcher
            name: "Mun",
            distance: 12_000_000,
            isCurrent: false,
          },
        ],
      });
    });

    await screen.findByText(/In flight: Probe X/i);

    const switcher = screen.getByRole("button", {
      name: /Switch to vessel/i,
    });
    expect(switcher).not.toBeDisabled();
    await user.click(switcher);

    // SpaceObject is present but hidden until the toggle is used.
    expect(screen.queryByText("Mun Rock")).not.toBeInTheDocument();
    expect(screen.getByText("Relay Sat A")).toBeInTheDocument();

    await user.click(screen.getByText("Relay Sat A"));
    await waitFor(() => {
      const sent = stream.transport.sentCommands.find(
        (c) => c.command === "ksp.switchVessel",
      );
      expect(sent).toMatchObject({
        args: { vesselId: "vessel-guid-aaa" },
        vantage: "meta",
      });
    });
  });

  // Debris from a previous flight is not the active vessel's crash: the chip is scoped to its name.
  it("does not chip a crash when crash.hasRecent is for a different vessel (debris)", async () => {
    renderWidget();
    act(() => {
      stream.emit("spaceCenter.savedShips", []);
      emitScene(stream, "Flight");
      emitInFlightVessel(stream, { name: "LFV-1 Lander", altitudeAsl: 80 });
      stream.emit("ksp.revertAvailability", {
        canRevertToLaunch: false,
        canRevertToEditor: false,
      });
      stream.emit("crash.hasRecent", true);
      // Debris from a different vessel earlier in the session.
      stream.emit("crash.lastCrash", { vesselName: "Booster A Debris" });
    });

    await waitFor(() =>
      expect(visibleText()).toMatch(/In flight: LFV-1 Lander/i),
    );
    expect(screen.queryByText(/Crash in progress/i)).toBeNull();
    const recoverBtn = screen.getByRole("button", { name: /^Recover$/i });
    expect(recoverBtn).not.toBeDisabled();
  });

  // A crash snapshot dated after the current UT is from a reverted timeline.
  it("does not chip a crash when the crash snapshot post-dates current UT (reverted flight)", async () => {
    // Pinned so the crash-staleness comparison below has its UT.
    teardownMockDataSource(cmdFixture);
    cmdFixture = await setupMockDataSource({ keys: [] });
    stream = setupStreamFixture({
      pinnedUt: 113270,
      suspendFrames: true,
    });

    renderWidget();
    act(() => {
      stream.emit("spaceCenter.savedShips", []);
      emitScene(stream, "Flight");
      emitInFlightVessel(stream, { name: "Doomed Probe", altitudeAsl: 87 });
      stream.emit("ksp.revertAvailability", {
        canRevertToLaunch: true,
        canRevertToEditor: false,
      });
      stream.emit("crash.hasRecent", true);
      // Crash captured at ut 125371; the revert rewound the clock to 113270.
      stream.emit("crash.lastCrash", {
        vesselName: "Doomed Probe",
        ut: 125371,
      });
    });

    await waitFor(() =>
      expect(screen.getByText(/In flight: Doomed Probe/i)).toBeInTheDocument(),
    );
    expect(screen.queryByText(/Crash in progress/i)).toBeNull();
    const recoverBtn = screen.getByRole("button", { name: /^Recover$/i });
    expect(recoverBtn).not.toBeDisabled();
  });

  it("greys out unavailable crew chips and ignores clicks", async () => {
    const user = userEvent.setup();
    renderWidget();
    act(() => {
      emitFunds(stream, 100_000);
      stream.emit("spaceCenter.launchSites", [padSite("LaunchPad", "KSC Pad")]);
      stream.emit("spaceCenter.savedShips", [
        {
          name: "Probe",
          partCount: 4,
          totalMass: 0.5,
          facility: "VAB",
          requiresFunds: 500,
          missingParts: [],
        },
      ]);
      stream.emit("spaceCenter.crewRoster", [
        {
          name: "Jeb",
          trait: "Pilot",
          experienceLevel: 5,
          available: false,
          unavailableReason: "Assigned",
        },
      ]);
    });

    await user.click(await screen.findByText("Probe"));
    await user.click(screen.getByText("Jeb"));
    // Click should be a no-op; launch button should still say "unmanned".
    expect(screen.getByText(/Launch Probe unmanned/i)).toBeInTheDocument();
  });

  async function setupForLaunch(sites: unknown) {
    renderWidget();
    act(() => {
      emitFunds(stream, 100_000);
      stream.emit("spaceCenter.launchSites", sites);
      stream.emit("spaceCenter.savedShips", [
        {
          name: "Mun Hopper",
          partCount: 12,
          totalMass: 5.5,
          facility: "VAB",
          requiresFunds: 8000,
          missingParts: [],
        },
      ]);
      stream.emit("spaceCenter.crewRoster", [
        {
          name: "Jeb",
          trait: "Pilot",
          experienceLevel: 5,
          available: true,
          unavailableReason: "",
        },
      ]);
    });
  }

  const site = (
    name: string,
    displayName: string,
  ): Record<string, unknown> => ({
    name,
    displayName,
    editorFacility: "VAB",
    bodyIndex: 1,
    isStock: true,
    padOccupied: null,
    padVesselTitle: null,
  });

  it("launches from the pad the operator opened, not the first in the list", async () => {
    const user = userEvent.setup();
    await setupForLaunch([
      site("LaunchPad", "KSC Launch Pad"),
      site("Woomerang_Launch_Site", "Woomerang"),
    ]);

    expect(await screen.findByText("KSC Launch Pad")).toBeInTheDocument();

    await user.click(screen.getByText("Woomerang"));
    await user.click(await screen.findByText("Mun Hopper"));
    await user.click(screen.getByText(/Launch Mun Hopper unmanned/i));
    await user.click(screen.getByText(/Confirm launch/i));
    await waitFor(() =>
      expect(sentLaunches(stream)[0]).toMatchObject({
        args: { site: "Woomerang_Launch_Site", crew: [] },
      }),
    );
  });

  it("opens the first pad on its own, so a single-pad save is still two clicks", async () => {
    const user = userEvent.setup();
    await setupForLaunch([site("LaunchPad", "KSC Launch Pad")]);

    await user.click(await screen.findByText("Mun Hopper"));
    await user.click(screen.getByText(/Launch Mun Hopper unmanned/i));
    await user.click(screen.getByText(/Confirm launch/i));
    await waitFor(() =>
      expect(sentLaunches(stream)[0]).toMatchObject({
        args: { site: "LaunchPad", crew: [] },
      }),
    );
  });

  it("says a save with no launch sites has none, rather than rendering an empty list", async () => {
    await setupForLaunch([]);

    expect(
      await screen.findByText("No launch sites reported"),
    ).toBeInTheDocument();
    expect(screen.queryByText("Mun Hopper")).not.toBeInTheDocument();
  });
});

describe("parseLaunchSites", () => {
  it("returns null for absent or non-array input", () => {
    expect(parseLaunchSites(undefined)).toBeNull();
    expect(parseLaunchSites(null)).toBeNull();
    expect(parseLaunchSites({})).toBeNull();
  });

  it("drops entries with no name and falls back displayName to name", () => {
    const parsed = parseLaunchSites([
      { name: "LaunchPad", editorFacility: "VAB" },
      { displayName: "orphan" },
    ]);
    expect(parsed).toHaveLength(1);
    expect(parsed?.[0]?.displayName).toBe("LaunchPad");
    expect(parsed?.[0]?.facility).toBe("VAB");
  });

  it("reads the body only as an index, never as a name", () => {
    const parsed = parseLaunchSites([
      { name: "MunBase", bodyIndex: 2 },
      { name: "Named", body: "Mun" },
    ]);
    expect(parsed?.map((p) => p.bodyIndex)).toEqual([2, null]);
  });

  it("reads the facility only from editorFacility, never from an old-shape facility field", () => {
    const parsed = parseLaunchSites([
      { name: "LaunchPad", facility: "VAB", unlocked: false },
    ]);
    expect(parsed).toHaveLength(1);
    expect(parsed?.[0]?.facility).toBe("");
    expect(parsed?.[0]).not.toHaveProperty("unlocked");
  });
});

describe("parseSavedShips", () => {
  it("returns null for non-array input", () => {
    expect(parseSavedShips(null)).toBeNull();
    expect(parseSavedShips({})).toBeNull();
  });

  it("drops entries missing a name", () => {
    const parsed = parseSavedShips([{ name: "ok", facility: "VAB" }, {}]);
    expect(parsed).toHaveLength(1);
  });

  /** An unrecognised `EditorFacility` name is carried verbatim as a label; the ordinal decides the dispatched editor. */
  it("keeps KSP's own facility name and carries the ordinal beside it", () => {
    const parsed = parseSavedShips([
      { name: "x", facility: "ModdedFacility", facilityOrdinal: 9 },
    ]);
    expect(parsed?.[0]?.facility).toBe("ModdedFacility");
    expect(parsed?.[0]?.facilityOrdinal).toBe(9);
  });

  it("carries a null ordinal when the producer sent none, without inventing one", () => {
    const parsed = parseSavedShips([{ name: "x", facility: "SPH" }]);
    expect(parsed?.[0]?.facility).toBe("SPH");
    expect(parsed?.[0]?.facilityOrdinal).toBeNull();
  });
});

describe("parseCrew", () => {
  it("returns null for non-array input", () => {
    expect(parseCrew(null)).toBeNull();
  });

  it("preserves availability and unavailableReason", () => {
    const parsed = parseCrew([
      {
        name: "Bob",
        trait: "Engineer",
        experienceLevel: 3,
        available: false,
        unavailableReason: "Hospitalized",
      },
    ]);
    expect(parsed?.[0]?.available).toBe(false);
    expect(parsed?.[0]?.unavailableReason).toBe("Hospitalized");
  });
});

describe("LaunchDirectorComponent augment slots", () => {
  let cmdFixture: MockDataSourceFixture;
  let stream: ReturnType<typeof setupStreamFixture>;

  beforeEach(async () => {
    clearAugments();
    cmdFixture = await setupMockDataSource({ keys: [] });
    stream = setupStreamFixture({
      pinnedUt: 10,
      suspendFrames: true,
    });
  });

  afterEach(() => {
    teardownMockDataSource(cmdFixture);
    clearAugments();
  });

  function renderWidget() {
    return render(
      <stream.Provider>
        <DashboardItemContext.Provider value={{ instanceId: "ld" }}>
          <LaunchDirectorComponent id="ld" />
        </DashboardItemContext.Provider>
      </stream.Provider>,
    );
  }

  // Drive the widget into the pre-launch checklist branch so both the header (badges) and the appended section slot are on screen.
  function primePreLaunch() {
    act(() => {
      emitFunds(stream, 100_000);
      emitScene(stream, "SpaceCenter", "LaunchPad");
      stream.emit("spaceCenter.launchSites", [padSite("LaunchPad", "KSC Pad")]);
      stream.emit("spaceCenter.savedShips", [
        {
          name: "Mun Hopper",
          partCount: 12,
          totalMass: 5.5,
          facility: "VAB",
          requiresFunds: 8000,
          missingParts: [],
        },
      ]);
    });
  }

  it("renders both slots with no bound augment (empty is fine)", async () => {
    renderWidget();
    primePreLaunch();

    // The pre-launch checklist is on screen, but nothing composes into either slot.
    expect(await screen.findByText("Mun Hopper")).toBeInTheDocument();
    expect(screen.queryByTestId("ld-badge")).not.toBeInTheDocument();
    expect(screen.queryByTestId("ld-section")).not.toBeInTheDocument();
  });

  it("appends a bound checklist-section augment carrying the selection", async () => {
    registerAugment<"launch-director.preflight">({
      id: "test-ld-section",
      augments: "launch-director.preflight",
      component: ({ selectedShip, funds }: LaunchDirectorSlotContext) => (
        <div data-testid="ld-section">
          ship:{String(selectedShip)} funds:{String(funds)}
        </div>
      ),
    });

    renderWidget();
    primePreLaunch();

    const section = await screen.findByTestId("ld-section");
    // No craft selected yet, funds carried through from telemetry.
    expect(section).toHaveTextContent("ship:null funds:100000");
    // The existing funds readout in the subtitle is untouched.
    expect(screen.getByTitle("Available funds")).toBeInTheDocument();
  });
});
