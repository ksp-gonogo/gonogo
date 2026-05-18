import type { DataKey, MockDataSource } from "@gonogo/core";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  type MockDataSourceFixture,
  setupMockDataSource,
  teardownMockDataSource,
} from "../test/setupMockDataSource";
import { LaunchDirectorComponent, parseCrew, parseSavedShips } from "./index";

const KEYS: DataKey[] = [
  { key: "kc.savedShips" },
  { key: "kc.crewRoster" },
  { key: "kc.padOccupied" },
  { key: "kc.padVesselTitle" },
  { key: "kc.launchSite" },
  { key: "kc.scene" },
  { key: "career.funds" },
  { key: "v.name" },
  { key: "v.missionTime" },
  { key: "v.altitude" },
  { key: "ksp.canRevertToLaunch" },
  { key: "ksp.canRevertToEditor" },
  { key: "crash.hasRecent" },
  { key: "crash.lastCrash" },
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

    fireEvent.click(screen.getByText(/Mun Hopper/));
    fireEvent.click(screen.getByText(/Jebediah Kerman/));

    fireEvent.click(screen.getByText(/Launch Mun Hopper \(1 crew\)/i));
    expect(onExecute).not.toHaveBeenCalled();

    fireEvent.click(screen.getByText(/Confirm launch/i));
    expect(onExecute).toHaveBeenCalledWith(
      "ksp.launch[Mun Hopper,VAB,LaunchPad,Jebediah Kerman]",
    );
  });

  it("switches to recover / revert controls when the pad is occupied", async () => {
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

    fireEvent.click(screen.getByText("Recover"));
    fireEvent.click(screen.getByText(/Confirm recover/i));
    expect(onExecute).toHaveBeenCalledWith("ksp.recover");
  });

  it("shows the in-flight panel with mission time + revert affordances when scene is Flight", async () => {
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

    fireEvent.click(screen.getByText("Revert to launch"));
    fireEvent.click(screen.getByText(/Confirm revert to launch/i));
    expect(onExecute).toHaveBeenCalledWith("ksp.revertToLaunch");
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

  it("greys out unavailable crew chips and ignores clicks", async () => {
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

    fireEvent.click(screen.getByText("Probe"));
    fireEvent.click(screen.getByText("Jeb"));
    // Click should be a no-op; launch button should still say "unmanned".
    expect(screen.getByText(/Launch Probe unmanned/i)).toBeInTheDocument();
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
