import {
  clearAugments,
  DashboardItemContext,
  registerAugment,
} from "@ksp-gonogo/core";
import { act, render, screen } from "@ksp-gonogo/test-utils";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  type MockDataSourceFixture,
  setupMockDataSource,
  teardownMockDataSource,
} from "../test/setupMockDataSource";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { parseFacilityLevels, SpaceCenterStatusComponent } from "./index";

/**
 * Every value this widget reads is canonical now — `career.status`
 * (`?.economy?.funds` + `?.facilities`), `spaceCenter.scene`
 * (`?.scene`/`?.launchSite`), `spaceCenter.partsAvailable` (`?.count`) and the
 * derived `spaceCenter.state` channel (pad occupancy off
 * `spaceCenter.launchSites`) — so every assertion drives real stream emits
 * through `setupStreamFixture`. The one thing still on the legacy path is the
 * `kc.upgradeFacility[...]` COMMAND (`mapCommand` has no home for it, so
 * `useExecuteAction("data")` takes the legacy branch), so a
 * `setupMockDataSource` command spy — registered under the default `"data"`
 * id `BufferedDataSource` uses — is kept purely for `onExecute`.
 */
const CARRIED = [
  "career.status",
  "spaceCenter.scene",
  "spaceCenter.partsAvailable",
  "spaceCenter.launchSites",
];

describe("SpaceCenterStatusComponent", () => {
  let cmdFixture: MockDataSourceFixture;
  let onExecute: ReturnType<typeof vi.fn>;
  let stream: ReturnType<typeof setupStreamFixture>;

  beforeEach(async () => {
    onExecute = vi.fn();
    cmdFixture = await setupMockDataSource({ keys: [], onExecute });
    stream = setupStreamFixture({ carriedChannels: CARRIED, pinnedUt: 10 });
  });

  afterEach(() => {
    // teardownMockDataSource unmounts (cleanup) BEFORE disconnecting, so no
    // status-change state update fires outside act().
    teardownMockDataSource(cmdFixture);
    clearAugments();
  });

  function renderWidget(id = "ksc") {
    return render(
      <stream.Provider>
        <DashboardItemContext.Provider value={{ instanceId: id }}>
          <SpaceCenterStatusComponent config={{}} id={id} />
        </DashboardItemContext.Provider>
      </stream.Provider>,
    );
  }

  it("renders the panel title and an empty pad line before any telemetry", () => {
    renderWidget();
    expect(screen.getByText(/SPACE CENTER/i)).toBeInTheDocument();
    expect(screen.getByText(/No vehicle on pad/i)).toBeInTheDocument();
  });

  it("shows facility tiers when telemetry arrives", async () => {
    renderWidget();
    act(() => {
      // The wire's enum-keyed currentTier/maxTier is 0-based (KSP's
      // GetFacilityLevelCount is "upgrades available", not total tiers), so a
      // 3-tier building arrives as {currentTier: 0..2, maxTier: 2}. Widget
      // renders 1-indexed: `(tier+1) / (max+1)`.
      stream.emit("career.status", {
        economy: { funds: null, reputation: null, science: null },
        facilities: {
          LaunchPad: { currentTier: 1, maxTier: 2 },
          VehicleAssemblyBuilding: { currentTier: 2, maxTier: 2 },
        },
        contracts: null,
        strategies: null,
        tech: null,
      });
    });
    // launchPad: tier 2 of 3, vab: tier 3 of 3 (at max). The tier value
    // exposes an accessible label so we assert on that rather than
    // walking the DOM to stitch the split "2 / 3" spans back together.
    expect(
      await screen.findByLabelText("Launch Pad tier 2 of 3"),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("VAB tier 3 of 3")).toBeInTheDocument();
  });

  it("shows the pad-occupied vessel name when on the pad", async () => {
    renderWidget();
    act(() => {
      stream.emit("spaceCenter.launchSites", [
        { name: "__pad__", padOccupied: true, padVesselTitle: "Kerbal X" },
      ]);
    });
    expect(await screen.findByText(/On pad: Kerbal X/i)).toBeInTheDocument();
  });

  it("falls back to last launch site when not on the pad", async () => {
    renderWidget();
    act(() => {
      stream.emit("spaceCenter.launchSites", [
        { name: "__pad__", padOccupied: false, padVesselTitle: null },
      ]);
      stream.emit("spaceCenter.scene", {
        scene: "SpaceCenter",
        launchSite: "LaunchPad",
      });
    });
    expect(
      await screen.findByText(/Last site: LaunchPad/i),
    ).toBeInTheDocument();
  });

  it("shows the parts-available count", async () => {
    renderWidget();
    act(() => {
      stream.emit("spaceCenter.partsAvailable", { count: 47 });
    });
    expect(await screen.findByText("47")).toBeInTheDocument();
  });

  it("fires kc.upgradeFacility on arm-then-confirm in the SC scene", async () => {
    const user = userEvent.setup();
    renderWidget();
    act(() => {
      stream.emit("spaceCenter.scene", { scene: "SpaceCenter" });
      stream.emit("career.status", {
        economy: { funds: 200_000, reputation: null, science: null },
        facilities: {
          VehicleAssemblyBuilding: {
            currentTier: 0,
            maxTier: 3,
            upgradeCost: 75_000,
          },
        },
        contracts: null,
        strategies: null,
        tech: null,
      });
    });

    const upgradeButtons = await screen.findAllByRole("button", {
      name: "Upgrade",
    });
    expect(upgradeButtons.length).toBeGreaterThan(0);

    await user.click(upgradeButtons[0]);
    expect(onExecute).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Confirm" }));
    expect(onExecute).toHaveBeenCalledWith("kc.upgradeFacility[vab]");
  });

  it("disables upgrade button outside the SC scene", async () => {
    renderWidget();
    act(() => {
      stream.emit("spaceCenter.scene", { scene: "Flight" });
      stream.emit("career.status", {
        economy: { funds: 200_000, reputation: null, science: null },
        facilities: {
          VehicleAssemblyBuilding: {
            currentTier: 0,
            maxTier: 3,
            upgradeCost: 75_000,
          },
        },
        contracts: null,
        strategies: null,
        tech: null,
      });
    });

    const upgradeButtons = await screen.findAllByRole("button", {
      name: "Upgrade",
    });
    expect((upgradeButtons[0] as HTMLButtonElement).disabled).toBe(true);
  });

  it("disables upgrade when funds insufficient", async () => {
    renderWidget();
    act(() => {
      stream.emit("spaceCenter.scene", { scene: "SpaceCenter" });
      stream.emit("career.status", {
        economy: { funds: 1_000, reputation: null, science: null },
        facilities: {
          VehicleAssemblyBuilding: {
            currentTier: 0,
            maxTier: 3,
            upgradeCost: 75_000,
          },
        },
        contracts: null,
        strategies: null,
        tech: null,
      });
    });

    const upgradeButtons = await screen.findAllByRole("button", {
      name: "Upgrade",
    });
    expect((upgradeButtons[0] as HTMLButtonElement).disabled).toBe(true);
  });

  // Augment slots (Uplink architecture §4) — the widget exposes
  // `space-center-status.badges` (header) and `space-center-status.sections`
  // (body, appended to the facility list). With no augment registered the
  // slots render nothing and the widget is unchanged; once an augment binds a
  // slot its component appears in the widget's space.
  it("renders with empty augment slots when nothing is registered", () => {
    const { container } = renderWidget();
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

    const { container } = renderWidget();

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
