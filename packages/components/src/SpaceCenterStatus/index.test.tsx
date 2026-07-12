import type { DataKey, MockDataSource } from "@ksp-gonogo/core";
import { clearAugments, registerAugment } from "@ksp-gonogo/core";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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
    clearAugments();
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
    // launchPad: tier 2 of 3, vab: tier 3 of 3 (at max). The tier value
    // exposes an accessible label so we assert on that rather than
    // walking the DOM to stitch the split "2 / 3" spans back together.
    expect(screen.getByLabelText("Launch Pad tier 2 of 3")).toBeInTheDocument();
    expect(screen.getByLabelText("VAB tier 3 of 3")).toBeInTheDocument();
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
    const user = userEvent.setup();
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

    await user.click(upgradeButtons[0]);
    expect(onExecute).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Confirm" }));
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

  // Augment slots (Uplink architecture §4) — the widget exposes
  // `space-center-status.badges` (header) and `space-center-status.sections`
  // (body, appended to the facility list). With no augment registered the
  // slots render nothing and the widget is unchanged; once an augment binds a
  // slot its component appears in the widget's space.
  it("renders with empty augment slots when nothing is registered", () => {
    const { container } = render(
      <SpaceCenterStatusComponent config={{}} id="ksc" />,
    );
    expect(screen.getByText(/SPACE CENTER/i)).toBeInTheDocument();
    expect(container.textContent).not.toContain("LS DEPOT");
    expect(container.textContent).not.toContain("EXPANSION READY");
  });

  it("renders augments bound to the badges and sections slots", () => {
    registerAugment({
      id: "test-ksc-badge",
      augments: "space-center-status.badges",
      component: () => <span>EXPANSION READY</span>,
    });
    registerAugment({
      id: "test-ksc-section",
      augments: "space-center-status.sections",
      component: () => <div>LS DEPOT tier 1 of 3</div>,
    });

    const { container } = render(
      <SpaceCenterStatusComponent config={{}} id="ksc" />,
    );

    expect(container.textContent).toContain("EXPANSION READY");
    expect(container.textContent).toContain("LS DEPOT tier 1 of 3");
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
    // currentLevelText / nextLevelText default to empty strings when the
    // older Telemachus DLL doesn't emit them (pre-2026-05-13).
    expect(parsed).toEqual({
      vab: {
        level: 1,
        max: 3,
        upgradeFunds: 75000,
        currentLevelText: "",
        nextLevelText: "",
      },
      launchPad: {
        level: 0,
        max: 3,
        upgradeFunds: 0,
        currentLevelText: "",
        nextLevelText: "",
      },
    });
  });

  it("defaults upgradeFunds to 0 when missing", () => {
    const parsed = parseFacilityLevels({
      sph: { level: 0, max: 3 },
    });
    expect(parsed.sph?.upgradeFunds).toBe(0);
  });

  it("preserves currentLevelText and nextLevelText when the fork emits them", () => {
    const parsed = parseFacilityLevels({
      vab: {
        level: 2,
        max: 2,
        upgradeFunds: 0,
        currentLevelText: "* Max Parts: Unlimited",
        nextLevelText: "",
      },
      admin: {
        level: 0,
        max: 2,
        upgradeFunds: 150000,
        currentLevelText: "* Max Active Strategies: 1\n* Max Commitment: 25.0%",
        nextLevelText: "* Max Active Strategies: 3\n* Max Commitment: 60.0%",
      },
    });
    expect(parsed.vab?.currentLevelText).toBe("* Max Parts: Unlimited");
    expect(parsed.vab?.nextLevelText).toBe("");
    expect(parsed.admin?.currentLevelText).toContain(
      "Max Active Strategies: 1",
    );
    expect(parsed.admin?.nextLevelText).toContain("Max Commitment: 60.0%");
  });
});
