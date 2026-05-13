import type { DataKey, MockDataSource } from "@gonogo/core";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  type MockDataSourceFixture,
  setupMockDataSource,
  teardownMockDataSource,
} from "../test/setupMockDataSource";
import { parseFacilityLevels, SpaceCenterStatusComponent } from "./index";

const KEYS: DataKey[] = [
  { key: "kc.facilityLevels" },
  { key: "kc.partsAvailable" },
  { key: "kc.launchSite" },
  { key: "kc.padOccupied" },
  { key: "kc.padVesselTitle" },
  { key: "kc.scene" },
  { key: "career.funds" },
];

describe("SpaceCenterStatusComponent", () => {
  let fixture: MockDataSourceFixture;
  let source: MockDataSource;

  beforeEach(async () => {
    fixture = await setupMockDataSource({ keys: KEYS });
    source = fixture.source;
  });

  afterEach(() => {
    teardownMockDataSource(fixture);
  });

  it("renders the panel title and an empty pad line before any telemetry", () => {
    render(<SpaceCenterStatusComponent config={{}} id="ksc" />);
    expect(screen.getByText(/SPACE CENTER/i)).toBeInTheDocument();
    expect(screen.getByText(/No vehicle on pad/i)).toBeInTheDocument();
  });

  it("shows facility tiers when telemetry arrives", () => {
    render(<SpaceCenterStatusComponent config={{}} id="ksc" />);
    act(() => {
      // Fork emits `max` as KSP's `GetFacilityLevelCount` — number of
      // upgrades available, not total tiers. So a 3-tier building shows
      // up as `{level: 0..2, max: 2}`. Widget renders 1-indexed:
      // `(level+1) / (max+1)`. Verified live 2026-05-13.
      source.emit("kc.facilityLevels", {
        launchPad: { level: 1, max: 2 },
        vab: { level: 2, max: 2 },
      });
    });
    // launchPad: tier 2 of 3
    const launchPadCell = screen.getByText(/Launch Pad/i).closest("div");
    expect(launchPadCell?.textContent).toMatch(/2\s*\/\s*3/);
    // vab: tier 3 of 3 (at max)
    const vabCell = screen.getByText(/^VAB$/i).closest("div");
    expect(vabCell?.textContent).toMatch(/3\s*\/\s*3/);
  });

  it("shows the pad-occupied vessel name when on the pad", () => {
    render(<SpaceCenterStatusComponent config={{}} id="ksc" />);
    act(() => {
      source.emit("kc.padOccupied", true);
      source.emit("kc.padVesselTitle", "Kerbal X");
    });
    expect(screen.getByText(/On pad: Kerbal X/i)).toBeInTheDocument();
  });

  it("falls back to last launch site when not on the pad", () => {
    render(<SpaceCenterStatusComponent config={{}} id="ksc" />);
    act(() => {
      source.emit("kc.padOccupied", false);
      source.emit("kc.launchSite", "LaunchPad");
    });
    expect(screen.getByText(/Last site: LaunchPad/i)).toBeInTheDocument();
  });

  it("shows the parts-available count", () => {
    render(<SpaceCenterStatusComponent config={{}} id="ksc" />);
    act(() => {
      source.emit("kc.partsAvailable", 47);
    });
    expect(screen.getByText("47")).toBeInTheDocument();
  });

  it("fires kc.upgradeFacility on arm-then-confirm in the SC scene", async () => {
    const onExecute = vi.fn();
    teardownMockDataSource(fixture);
    fixture = await setupMockDataSource({ keys: KEYS, onExecute });
    source = fixture.source;

    render(<SpaceCenterStatusComponent config={{}} id="ksc" />);
    act(() => {
      source.emit("kc.scene", "SpaceCenter");
      source.emit("career.funds", 200_000);
      source.emit("kc.facilityLevels", {
        vab: { level: 0, max: 3, upgradeFunds: 75_000 },
      });
    });

    const upgradeButtons = screen.getAllByRole("button", { name: "Upgrade" });
    expect(upgradeButtons.length).toBeGreaterThan(0);

    fireEvent.click(upgradeButtons[0]);
    expect(onExecute).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));
    expect(onExecute).toHaveBeenCalledWith("kc.upgradeFacility[vab]");
  });

  it("disables upgrade button outside the SC scene", () => {
    render(<SpaceCenterStatusComponent config={{}} id="ksc" />);
    act(() => {
      source.emit("kc.scene", "Flight");
      source.emit("career.funds", 200_000);
      source.emit("kc.facilityLevels", {
        vab: { level: 0, max: 3, upgradeFunds: 75_000 },
      });
    });

    const upgradeButtons = screen.getAllByRole("button", { name: "Upgrade" });
    expect((upgradeButtons[0] as HTMLButtonElement).disabled).toBe(true);
  });

  it("disables upgrade when funds insufficient", () => {
    render(<SpaceCenterStatusComponent config={{}} id="ksc" />);
    act(() => {
      source.emit("kc.scene", "SpaceCenter");
      source.emit("career.funds", 1_000);
      source.emit("kc.facilityLevels", {
        vab: { level: 0, max: 3, upgradeFunds: 75_000 },
      });
    });

    const upgradeButtons = screen.getAllByRole("button", { name: "Upgrade" });
    expect((upgradeButtons[0] as HTMLButtonElement).disabled).toBe(true);
  });
});

describe("parseFacilityLevels", () => {
  it("returns an empty object for non-object input", () => {
    expect(parseFacilityLevels(null)).toEqual({});
    expect(parseFacilityLevels(undefined)).toEqual({});
    expect(parseFacilityLevels(42)).toEqual({});
    expect(parseFacilityLevels([])).toEqual({});
  });

  it("retains valid facility entries and drops malformed ones", () => {
    const parsed = parseFacilityLevels({
      vab: { level: 1, max: 3, upgradeFunds: 75000 },
      runway: { level: "broken", max: 3 },
      unknownFacility: { level: 1, max: 3 },
      launchPad: { level: 0, max: 3 },
    });
    expect(parsed).toEqual({
      vab: { level: 1, max: 3, upgradeFunds: 75000 },
      launchPad: { level: 0, max: 3, upgradeFunds: 0 },
    });
  });

  it("defaults upgradeFunds to 0 when missing", () => {
    const parsed = parseFacilityLevels({
      sph: { level: 0, max: 3 },
    });
    expect(parsed.sph?.upgradeFunds).toBe(0);
  });
});
