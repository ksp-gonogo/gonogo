import type { DataKey, MockDataSource } from "@ksp-gonogo/core";
import { clearAugments, registerAugment } from "@ksp-gonogo/core";
import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  type MockDataSourceFixture,
  setupMockDataSource,
  teardownMockDataSource,
} from "../test/setupMockDataSource";
import {
  LaunchDirectorComponent,
  type LaunchDirectorSlotContext,
  parseCrew,
  parseLaunchSites,
  parseSavedShips,
} from "./index";

const KEYS: DataKey[] = [
  { key: "kc.savedShips" },
  { key: "kc.crewRoster" },
  { key: "kc.padOccupied" },
  { key: "kc.padVesselTitle" },
  { key: "kc.launchSite" },
  { key: "kc.launchSites" },
  { key: "kc.scene" },
  { key: "career.funds" },
  { key: "v.name" },
  { key: "v.missionTime" },
  { key: "v.altitude" },
  { key: "ksp.canRevertToLaunch" },
  { key: "ksp.canRevertToEditor" },
  { key: "crash.hasRecent" },
  { key: "crash.lastCrash" },
  { key: "t.universalTime" },
  { key: "tar.availableVessels" },
];

describe("LaunchDirectorComponent", () => {
  let fixture: MockDataSourceFixture;
  let source: MockDataSource;

  beforeEach(async () => {
    fixture = await setupMockDataSource({ keys: KEYS });
    source = fixture.source;
  });

  afterEach(() => {
    teardownMockDataSource(fixture);
  });

  it("shows the awaiting placeholder before any telemetry", () => {
    render(<LaunchDirectorComponent config={{}} id="ld" />);
    expect(
      screen.getByText(/Awaiting launch-pad telemetry/i),
    ).toBeInTheDocument();
  });

  it("filters out craft with missing parts and unaffordable cost", () => {
    render(<LaunchDirectorComponent config={{}} id="ld" />);
    act(() => {
      source.emit("career.funds", 5000);
      source.emit("kc.savedShips", [
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
    expect(screen.getByText(/1\/3 ready/i)).toBeInTheDocument();
    expect(screen.getByText(/1 locked/i)).toBeInTheDocument();
  });

  it("requires arm-then-confirm before firing ksp.launch", async () => {
    const user = userEvent.setup();
    const onExecute = vi.fn();
    teardownMockDataSource(fixture);
    fixture = await setupMockDataSource({ keys: KEYS, onExecute });
    source = fixture.source;

    render(<LaunchDirectorComponent config={{}} id="ld" />);
    act(() => {
      source.emit("career.funds", 100_000);
      source.emit("kc.padOccupied", false);
      source.emit("kc.launchSite", "LaunchPad");
      source.emit("kc.savedShips", [
        {
          name: "Mun Hopper",
          partCount: 12,
          totalMass: 5.5,
          facility: "VAB",
          requiresFunds: 8000,
          missingParts: [],
        },
      ]);
      source.emit("kc.crewRoster", [
        {
          name: "Jebediah Kerman",
          trait: "Pilot",
          experienceLevel: 5,
          available: true,
          unavailableReason: "",
        },
      ]);
    });

    await user.click(screen.getByText(/Mun Hopper/));
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
    const onExecute = vi.fn();
    teardownMockDataSource(fixture);
    fixture = await setupMockDataSource({ keys: KEYS, onExecute });
    source = fixture.source;

    render(<LaunchDirectorComponent config={{}} id="ld" />);
    act(() => {
      source.emit("kc.savedShips", []); // present so awaiting placeholder clears
      source.emit("kc.padOccupied", true);
      source.emit("kc.padVesselTitle", "Kerbal X");
    });

    expect(screen.getByText(/On pad: Kerbal X/i)).toBeInTheDocument();

    await user.click(screen.getByText("Recover"));
    await user.click(screen.getByText(/Confirm recover/i));
    expect(onExecute).toHaveBeenCalledWith("ksp.recover");
  });

  it("shows the in-flight panel with mission time + revert affordances when scene is Flight", async () => {
    const user = userEvent.setup();
    const onExecute = vi.fn();
    teardownMockDataSource(fixture);
    fixture = await setupMockDataSource({ keys: KEYS, onExecute });
    source = fixture.source;

    render(<LaunchDirectorComponent config={{}} id="ld" />);
    act(() => {
      source.emit("kc.savedShips", []);
      source.emit("kc.padOccupied", true);
      source.emit("kc.scene", "Flight");
      source.emit("v.name", "Stayputnik X");
      source.emit("v.missionTime", 263);
      source.emit("v.altitude", 72_400);
      source.emit("ksp.canRevertToLaunch", true);
      source.emit("ksp.canRevertToEditor", true);
      source.emit("crash.hasRecent", false);
    });

    expect(screen.getByText(/In flight: Stayputnik X/i)).toBeInTheDocument();
    expect(screen.getByText("T+04:23")).toBeInTheDocument();
    expect(screen.getByText("72.4 km")).toBeInTheDocument();
    expect(screen.getByText("Revert to launch")).toBeInTheDocument();
    expect(screen.getByText("Revert to VAB")).toBeInTheDocument();

    await user.click(screen.getByText("Revert to launch"));
    await user.click(screen.getByText(/Confirm revert to launch/i));
    expect(onExecute).toHaveBeenCalledWith("ksp.revertToLaunch");
  });

  it("requires arm-then-confirm for Revert to VAB (flight-ending)", async () => {
    const user = userEvent.setup();
    const onExecute = vi.fn();
    teardownMockDataSource(fixture);
    fixture = await setupMockDataSource({ keys: KEYS, onExecute });
    source = fixture.source;

    render(<LaunchDirectorComponent config={{}} id="ld" />);
    act(() => {
      source.emit("kc.savedShips", []);
      source.emit("kc.padOccupied", true);
      source.emit("kc.scene", "Flight");
      source.emit("v.name", "Stayputnik X");
      source.emit("ksp.canRevertToEditor", true);
      source.emit("crash.hasRecent", false);
    });

    // First click arms — must NOT fire the flight-ending revert yet.
    await user.click(screen.getByText("Revert to VAB"));
    expect(onExecute).not.toHaveBeenCalledWith("ksp.revertToEditor[vab]");

    await user.click(screen.getByText(/Confirm revert to VAB/i));
    expect(onExecute).toHaveBeenCalledWith("ksp.revertToEditor[vab]");
  });

  it("surfaces a crash chip and disables recover when the active vessel itself crashed", async () => {
    const onExecute = vi.fn();
    teardownMockDataSource(fixture);
    fixture = await setupMockDataSource({ keys: KEYS, onExecute });
    source = fixture.source;

    render(<LaunchDirectorComponent config={{}} id="ld" />);
    act(() => {
      source.emit("kc.savedShips", []);
      source.emit("kc.padOccupied", true);
      source.emit("kc.scene", "Flight");
      source.emit("v.name", "Doomed Probe");
      source.emit("v.missionTime", 12);
      source.emit("v.altitude", 50);
      source.emit("ksp.canRevertToLaunch", false);
      source.emit("ksp.canRevertToEditor", false);
      source.emit("crash.hasRecent", true);
      source.emit("crash.lastCrash", { vesselName: "Doomed Probe" });
    });

    expect(
      screen.getByText(/Crash in progress — return to Space Center/i),
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
    const onExecute = vi.fn();
    teardownMockDataSource(fixture);
    fixture = await setupMockDataSource({ keys: KEYS, onExecute });
    source = fixture.source;

    render(<LaunchDirectorComponent config={{}} id="ld" />);
    act(() => {
      source.emit("kc.savedShips", []);
      source.emit("kc.padOccupied", true);
      source.emit("kc.scene", "Flight");
      source.emit("v.name", "Probe X");
      source.emit("v.missionTime", 30);
      source.emit("v.altitude", 2000);
      source.emit("ksp.canRevertToLaunch", true);
      source.emit("ksp.canRevertToEditor", true);
      source.emit("crash.hasRecent", false);
    });

    // First click arms the confirm — no execute fired yet.
    await user.click(screen.getByText("Tracking Station"));
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
    const onExecute = vi.fn();
    teardownMockDataSource(fixture);
    fixture = await setupMockDataSource({ keys: KEYS, onExecute });
    source = fixture.source;

    render(<LaunchDirectorComponent config={{}} id="ld" />);
    act(() => {
      source.emit("kc.savedShips", []);
      source.emit("kc.padOccupied", true);
      source.emit("kc.scene", "Flight");
      source.emit("v.name", "LFV-1 Lander");
      source.emit("v.missionTime", 530);
      source.emit("v.altitude", 80);
      source.emit("ksp.canRevertToLaunch", false);
      source.emit("ksp.canRevertToEditor", false);
      source.emit("crash.hasRecent", true);
      // Debris from a different vessel earlier in the session.
      source.emit("crash.lastCrash", { vesselName: "Booster A Debris" });
    });

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
    const onExecute = vi.fn();
    teardownMockDataSource(fixture);
    fixture = await setupMockDataSource({ keys: KEYS, onExecute });
    source = fixture.source;

    render(<LaunchDirectorComponent config={{}} id="ld" />);
    act(() => {
      source.emit("kc.savedShips", []);
      source.emit("kc.padOccupied", true);
      source.emit("kc.scene", "Flight");
      source.emit("v.name", "Doomed Probe");
      source.emit("v.missionTime", 0);
      source.emit("v.altitude", 87);
      source.emit("ksp.canRevertToLaunch", true);
      source.emit("ksp.canRevertToEditor", false);
      source.emit("crash.hasRecent", true);
      // Crash captured at ut 125371; the revert rewound the clock to 113270.
      source.emit("crash.lastCrash", {
        vesselName: "Doomed Probe",
        ut: 125371,
      });
      source.emit("t.universalTime", 113270);
    });

    expect(
      screen.queryByText(/Crash in progress — return to Space Center/i),
    ).toBeNull();
    const recoverBtn = screen.getByRole("button", { name: /^Recover$/i });
    expect(recoverBtn).not.toBeDisabled();
  });

  it("greys out unavailable crew chips and ignores clicks", async () => {
    const user = userEvent.setup();
    const onExecute = vi.fn();
    teardownMockDataSource(fixture);
    fixture = await setupMockDataSource({ keys: KEYS, onExecute });
    source = fixture.source;

    render(<LaunchDirectorComponent config={{}} id="ld" />);
    act(() => {
      source.emit("career.funds", 100_000);
      source.emit("kc.padOccupied", false);
      source.emit("kc.savedShips", [
        {
          name: "Probe",
          partCount: 4,
          totalMass: 0.5,
          facility: "VAB",
          requiresFunds: 500,
          missingParts: [],
        },
      ]);
      source.emit("kc.crewRoster", [
        {
          name: "Jeb",
          trait: "Pilot",
          experienceLevel: 5,
          available: false,
          unavailableReason: "Assigned",
        },
      ]);
    });

    await user.click(screen.getByText("Probe"));
    await user.click(screen.getByText("Jeb"));
    // Click should be a no-op; launch button should still say "unmanned".
    expect(screen.getByText(/Launch Probe unmanned/i)).toBeInTheDocument();
  });

  async function setupForLaunch(
    sites: unknown,
    onExecute: ReturnType<typeof vi.fn>,
  ) {
    teardownMockDataSource(fixture);
    fixture = await setupMockDataSource({ keys: KEYS, onExecute });
    source = fixture.source;
    render(<LaunchDirectorComponent config={{}} id="ld" />);
    act(() => {
      source.emit("career.funds", 100_000);
      source.emit("kc.padOccupied", false);
      if (sites !== undefined) source.emit("kc.launchSites", sites);
      source.emit("kc.savedShips", [
        {
          name: "Mun Hopper",
          partCount: 12,
          totalMass: 5.5,
          facility: "VAB",
          requiresFunds: 8000,
          missingParts: [],
        },
      ]);
      source.emit("kc.crewRoster", [
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
    const onExecute = vi.fn();
    await setupForLaunch(
      [
        site("LaunchPad", "KSC Launch Pad", true),
        site("Woomerang_Launch_Site", "Woomerang", true),
        site("Desert_Launch_Site", "Desert Site", false),
      ],
      onExecute,
    );

    await user.click(screen.getByText("Mun Hopper"));
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
    const onExecute = vi.fn();
    await setupForLaunch(
      [site("LaunchPad", "KSC Launch Pad", true)],
      onExecute,
    );

    await user.click(screen.getByText("Mun Hopper"));
    expect(screen.queryByText("Launch site")).not.toBeInTheDocument();

    await user.click(screen.getByText(/Launch Mun Hopper unmanned/i));
    await user.click(screen.getByText(/Confirm launch/i));
    expect(onExecute).toHaveBeenCalledWith(
      "ksp.launch[Mun Hopper,VAB,LaunchPad,]",
    );
  });

  it("hides the picker and defaults to LaunchPad when the key is absent", async () => {
    const user = userEvent.setup();
    const onExecute = vi.fn();
    await setupForLaunch(undefined, onExecute);

    await user.click(screen.getByText("Mun Hopper"));
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
  let fixture: MockDataSourceFixture;
  let source: MockDataSource;

  beforeEach(async () => {
    clearAugments();
    fixture = await setupMockDataSource({ keys: KEYS });
    source = fixture.source;
  });

  afterEach(() => {
    teardownMockDataSource(fixture);
    clearAugments();
  });

  // Drive the widget into the pre-launch checklist branch so both the header
  // (badges) and the appended section slot are on screen.
  function primePreLaunch() {
    act(() => {
      source.emit("career.funds", 100_000);
      source.emit("kc.padOccupied", false);
      source.emit("kc.launchSite", "LaunchPad");
      source.emit("kc.savedShips", [
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

  it("renders both slots with no bound augment (empty is fine)", () => {
    render(<LaunchDirectorComponent config={{}} id="ld" />);
    primePreLaunch();

    // Pre-launch checklist is on screen …
    expect(screen.getByText("Mun Hopper")).toBeInTheDocument();
    // … but nothing composes into either slot.
    expect(screen.queryByTestId("ld-badge")).not.toBeInTheDocument();
    expect(screen.queryByTestId("ld-section")).not.toBeInTheDocument();
  });

  it("renders a bound header-badge augment carrying the slot context", () => {
    registerAugment<"launch-director.badges">({
      id: "test-ld-badge",
      augments: "launch-director.badges",
      component: ({ selectedSite, inFlight }: LaunchDirectorSlotContext) => (
        <span data-testid="ld-badge">
          {selectedSite}/{String(inFlight)}
        </span>
      ),
    });

    render(<LaunchDirectorComponent config={{}} id="ld" />);
    primePreLaunch();

    const badge = screen.getByTestId("ld-badge");
    // Default site is "LaunchPad" and the pre-launch scene is not flight.
    expect(badge).toHaveTextContent("LaunchPad/false");
    // The badge sits in the header, beside the title.
    const header = screen.getByText("LAUNCH & RECOVERY").closest("div");
    expect(header).not.toBeNull();
    expect(within(header as HTMLElement).getByTestId("ld-badge")).toBeTruthy();
  });

  it("appends a bound checklist-section augment carrying the selection", () => {
    registerAugment<"launch-director.sections">({
      id: "test-ld-section",
      augments: "launch-director.sections",
      component: ({ selectedShip, funds }: LaunchDirectorSlotContext) => (
        <div data-testid="ld-section">
          ship:{String(selectedShip)} funds:{String(funds)}
        </div>
      ),
    });

    render(<LaunchDirectorComponent config={{}} id="ld" />);
    primePreLaunch();

    const section = screen.getByTestId("ld-section");
    // No craft selected yet, funds carried through from telemetry.
    expect(section).toHaveTextContent("ship:null funds:100000");
    // The existing funds readout in the subtitle is untouched (CLAUDE.md rule).
    expect(screen.getByTitle("Available funds")).toBeInTheDocument();
  });
});
