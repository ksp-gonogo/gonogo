import {
  clearAugments,
  DashboardItemContext,
  registerAugment,
} from "@ksp-gonogo/core";
import { act, render, screen, waitFor, within } from "@ksp-gonogo/test-utils";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
 * Every read this widget makes now has a real wire home (see
 * `stream.test.tsx`'s doc comment for the full read list) — only the
 * `ksp.*` COMMANDS still fall back to the legacy `DataSource` (their
 * `mapCommand` entries aren't promoted into `carriedChannels` below, so
 * `useExecuteAction("data")` takes the legacy branch every time), so
 * `setupMockDataSource`'s `onExecute` spy is the one thing left worth a
 * mock registration in this file. Every other assertion drives real stream
 * emits through `setupStreamFixture`.
 *
 * `vessel.state.met`/`altitudeAsl` are mutually exclusive by design — `met`
 * only derives in the OnRails/"propagated" basis, `altitudeAsl` only in the
 * Loaded/"measured" basis (`vessel-state.ts`'s own doc). The ACTIVE (flying)
 * vessel this widget's in-flight panel describes is always Loaded, so
 * `missionTime` genuinely renders "—" in every in-flight scenario below —
 * a real, documented gap in the migrated data, not a test omission.
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
  "vessel.control",
  "vessel.target",
  "vessel.comms",
  "vessel.propulsion",
  "ksp.revertAvailability",
  "crash.hasRecent",
  "crash.lastCrash",
];

function emitFunds(
  stream: ReturnType<typeof setupStreamFixture>,
  funds: number,
) {
  stream.emit("career.status", {
    economy: { funds, reputation: 0, science: 0 },
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

/**
 * Feeds `vessel.orbit`/`vessel.flight`/`vessel.identity` in the Loaded/
 * "measured" basis (quality 1) so `vessel.state.altitudeAsl` resolves —
 * `met` stays null, per this file's doc comment.
 */
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
  stream.emit(
    "vessel.orbit",
    {
      referenceBodyIndex: 1,
      sma: 700000,
      ecc: 0.01,
      inc: 0,
      lan: 0,
      argPe: 0,
      meanAnomalyAtEpoch: 0,
      epoch: 10,
      mu: 3.5316e12,
    },
    { quality: 1 },
  );
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

describe("LaunchDirectorComponent", () => {
  let cmdFixture: MockDataSourceFixture;
  let onExecute: ReturnType<typeof vi.fn>;
  let stream: ReturnType<typeof setupStreamFixture>;

  beforeEach(async () => {
    onExecute = vi.fn();
    cmdFixture = await setupMockDataSource({ keys: [], onExecute });
    stream = setupStreamFixture({ carriedChannels: CARRIED, pinnedUt: 10 });
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
    expect(await screen.findByText(/1\/3 ready/i)).toBeInTheDocument();
    expect(screen.getByText(/1 locked/i)).toBeInTheDocument();
  });

  it("requires arm-then-confirm before firing ksp.launch", async () => {
    const user = userEvent.setup();
    renderWidget();
    act(() => {
      emitFunds(stream, 100_000);
      emitScene(stream, "SpaceCenter", "LaunchPad");
      stream.emit("spaceCenter.launchSites", []);
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
    expect(onExecute).not.toHaveBeenCalled();

    await user.click(screen.getByText(/Confirm launch/i));
    expect(onExecute).toHaveBeenCalledWith(
      "ksp.launch[Mun Hopper,VAB,LaunchPad,Jebediah Kerman]",
    );
  });

  it("switches to recover / revert controls when the pad is occupied", async () => {
    const user = userEvent.setup();
    renderWidget();
    act(() => {
      // present so awaiting placeholder clears
      stream.emit("spaceCenter.savedShips", []);
      stream.emit("spaceCenter.launchSites", [
        { name: "LaunchPad", padOccupied: true, padVesselTitle: "Kerbal X" },
      ]);
    });

    expect(await screen.findByText(/On pad: Kerbal X/i)).toBeInTheDocument();

    await user.click(screen.getByText("Recover"));
    await user.click(screen.getByText(/Confirm recover/i));
    expect(onExecute).toHaveBeenCalledWith("ksp.recover");
  });

  it("shows the in-flight panel with altitude + revert affordances when scene is Flight", async () => {
    const user = userEvent.setup();
    renderWidget();
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
    // missionTime (`vessel.state.met`) is null in the Loaded/measured basis
    // (see this file's doc comment) — the panel shows its "—" placeholder.
    expect(screen.getByText("—")).toBeInTheDocument();
    expect(screen.getByText("72.4 km")).toBeInTheDocument();
    expect(screen.getByText("Revert to launch")).toBeInTheDocument();
    expect(screen.getByText("Revert to VAB")).toBeInTheDocument();

    await user.click(screen.getByText("Revert to launch"));
    await user.click(screen.getByText(/Confirm revert to launch/i));
    expect(onExecute).toHaveBeenCalledWith("ksp.revertToLaunch");
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

    // First click arms — must NOT fire the flight-ending revert yet.
    await user.click(await screen.findByText("Revert to VAB"));
    expect(onExecute).not.toHaveBeenCalledWith("ksp.revertToEditor[vab]");

    await user.click(screen.getByText(/Confirm revert to VAB/i));
    expect(onExecute).toHaveBeenCalledWith("ksp.revertToEditor[vab]");
  });

  it("surfaces a crash chip and disables recover when the active vessel itself crashed", async () => {
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

    expect(
      await screen.findByText(/Crash in progress — return to Space Center/i),
    ).toBeInTheDocument();
    const recoverBtn = screen.getByRole("button", { name: /^Recover$/i });
    expect(recoverBtn).toBeDisabled();
  });

  // 2026-05-17 23:12 BST: tapping "Tracking Station" mid-flight took the
  // operator to the TS scene but reverted the flight because KSP can't
  // save in that scene. Telemachus has no equivalent of the in-game
  // warning dialog, so the gonogo button now requires an arm-then-confirm
  // step so a casual mis-tap doesn't lose progress.
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

    // First click arms the confirm — no execute fired yet.
    await user.click(await screen.findByText("Tracking Station"));
    expect(onExecute).not.toHaveBeenCalledWith("ksp.toTrackingStation");
    // Confirm step is visible.
    const confirm = screen.getByText(/Confirm — flight may revert/i);
    await user.click(confirm);
    expect(onExecute).toHaveBeenCalledWith("ksp.toTrackingStation");
  });

  // Regression from 2026-05-17 (21:15, 23:12 BST): debris from a previous
  // flight crashed and the session-wide `crash.hasRecent` blocked recovery
  // on a successful landing. The scoped gate compares against the active
  // vessel's name, so debris no longer interferes.
  it("does not block recovery when crash.hasRecent is for a different vessel (debris)", async () => {
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
      expect(screen.getByText(/In flight: LFV-1 Lander/i)).toBeInTheDocument(),
    );
    expect(
      screen.queryByText(/Crash in progress — return to Space Center/i),
    ).toBeNull();
    const recoverBtn = screen.getByRole("button", { name: /^Recover$/i });
    expect(recoverBtn).not.toBeDisabled();
  });

  // 2026-06-12: after a crash + revert-to-launch, the chip blocked recovery
  // forever — the reverted vessel shares the crashed vessel's name, and
  // crash.hasRecent is session-sticky. Reverting rewinds universal time
  // below the snapshot's capture ut, so a future-dated snapshot is provably
  // from an undone timeline and must not gate recovery. (Telemachus now
  // clears it server-side on the same rule; this is the client mirror for
  // older deployed builds.)
  it("does not block recovery when the crash snapshot post-dates current UT (reverted flight)", async () => {
    // universalTime reads off `useViewUt()` — pin the view clock at the same
    // 113270 the crash-staleness math below needs (replaces the outer
    // beforeEach's pinnedUt: 10).
    teardownMockDataSource(cmdFixture);
    onExecute = vi.fn();
    cmdFixture = await setupMockDataSource({ keys: [], onExecute });
    stream = setupStreamFixture({ carriedChannels: CARRIED, pinnedUt: 113270 });

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
    expect(
      screen.queryByText(/Crash in progress — return to Space Center/i),
    ).toBeNull();
    const recoverBtn = screen.getByRole("button", { name: /^Recover$/i });
    expect(recoverBtn).not.toBeDisabled();
  });

  it("greys out unavailable crew chips and ignores clicks", async () => {
    const user = userEvent.setup();
    renderWidget();
    act(() => {
      emitFunds(stream, 100_000);
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
      if (sites !== undefined) stream.emit("spaceCenter.launchSites", sites);
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
    unlocked: boolean,
  ): Record<string, unknown> => ({
    name,
    displayName,
    facility: "VAB",
    body: "Kerbin",
    ready: true,
    unlocked,
  });

  it("offers a picker and launches from the chosen unlocked site", async () => {
    const user = userEvent.setup();
    await setupForLaunch([
      site("LaunchPad", "KSC Launch Pad", true),
      site("Woomerang_Launch_Site", "Woomerang", true),
      site("Desert_Launch_Site", "Desert Site", false),
    ]);

    await user.click(await screen.findByText("Mun Hopper"));
    // Locked site is not offered.
    expect(screen.queryByText("Desert Site")).not.toBeInTheDocument();

    await user.click(screen.getByText("Woomerang"));
    await user.click(screen.getByText(/Launch Mun Hopper unmanned/i));
    await user.click(screen.getByText(/Confirm launch/i));
    expect(onExecute).toHaveBeenCalledWith(
      "ksp.launch[Mun Hopper,VAB,Woomerang_Launch_Site,]",
    );
  });

  it("hides the picker when only one site is unlocked (DLC absent)", async () => {
    const user = userEvent.setup();
    await setupForLaunch([site("LaunchPad", "KSC Launch Pad", true)]);

    await user.click(await screen.findByText("Mun Hopper"));
    expect(screen.queryByText("Launch site")).not.toBeInTheDocument();

    await user.click(screen.getByText(/Launch Mun Hopper unmanned/i));
    await user.click(screen.getByText(/Confirm launch/i));
    expect(onExecute).toHaveBeenCalledWith(
      "ksp.launch[Mun Hopper,VAB,LaunchPad,]",
    );
  });

  it("hides the picker and defaults to LaunchPad when the key is absent", async () => {
    const user = userEvent.setup();
    await setupForLaunch(undefined);

    await user.click(await screen.findByText("Mun Hopper"));
    expect(screen.queryByText("Launch site")).not.toBeInTheDocument();

    await user.click(screen.getByText(/Launch Mun Hopper unmanned/i));
    await user.click(screen.getByText(/Confirm launch/i));
    expect(onExecute).toHaveBeenCalledWith(
      "ksp.launch[Mun Hopper,VAB,LaunchPad,]",
    );
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
      { name: "LaunchPad", unlocked: true },
      { displayName: "orphan" },
    ]);
    expect(parsed).toHaveLength(1);
    expect(parsed?.[0]?.displayName).toBe("LaunchPad");
    expect(parsed?.[0]?.unlocked).toBe(true);
  });

  it("coerces ready/unlocked to booleans", () => {
    const parsed = parseLaunchSites([{ name: "x" }]);
    expect(parsed?.[0]?.ready).toBe(false);
    expect(parsed?.[0]?.unlocked).toBe(false);
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

  it("falls back to VAB for unknown facility values", () => {
    const parsed = parseSavedShips([{ name: "x", facility: "ModdedFacility" }]);
    expect(parsed?.[0]?.facility).toBe("VAB");
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
    stream = setupStreamFixture({ carriedChannels: CARRIED, pinnedUt: 10 });
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

  // Drive the widget into the pre-launch checklist branch so both the header
  // (badges) and the appended section slot are on screen.
  function primePreLaunch() {
    act(() => {
      emitFunds(stream, 100_000);
      emitScene(stream, "SpaceCenter", "LaunchPad");
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

    // Pre-launch checklist is on screen ...
    expect(await screen.findByText("Mun Hopper")).toBeInTheDocument();
    // ... but nothing composes into either slot.
    expect(screen.queryByTestId("ld-badge")).not.toBeInTheDocument();
    expect(screen.queryByTestId("ld-section")).not.toBeInTheDocument();
  });

  it("renders a bound header-badge augment carrying the slot context", async () => {
    registerAugment<"launch-director.badges">({
      id: "test-ld-badge",
      augments: "launch-director.badges",
      component: ({ selectedSite, inFlight }: LaunchDirectorSlotContext) => (
        <span data-testid="ld-badge">
          {selectedSite}/{String(inFlight)}
        </span>
      ),
    });

    renderWidget();
    primePreLaunch();

    const badge = await screen.findByTestId("ld-badge");
    // Default site is "LaunchPad" and the pre-launch scene is not flight.
    expect(badge).toHaveTextContent("LaunchPad/false");
    // The badge sits in the header, beside the title.
    const header = screen.getByText("LAUNCH & RECOVERY").closest("div");
    expect(header).not.toBeNull();
    expect(within(header as HTMLElement).getByTestId("ld-badge")).toBeTruthy();
  });

  it("appends a bound checklist-section augment carrying the selection", async () => {
    registerAugment<"launch-director.sections">({
      id: "test-ld-section",
      augments: "launch-director.sections",
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
    // The existing funds readout in the subtitle is untouched (CLAUDE.md rule).
    expect(screen.getByTitle("Available funds")).toBeInTheDocument();
  });
});
