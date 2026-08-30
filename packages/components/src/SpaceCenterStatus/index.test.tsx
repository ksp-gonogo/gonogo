import {
  clearAugments,
  DashboardItemContext,
  registerAugment,
  WidgetMetaContext,
} from "@ksp-gonogo/core";
import {
  KSP_SPACE_CENTER_FACILITY_NAMES,
  KspSpaceCenterFacility,
} from "@ksp-gonogo/sitrep-sdk";
import { act, render, screen, waitFor } from "@ksp-gonogo/test-utils";
import { visibleText } from "@ksp-gonogo/ui-kit/testing";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  type MockDataSourceFixture,
  setupMockDataSource,
  teardownMockDataSource,
} from "../test/setupMockDataSource";
import { setupStreamFixture } from "../test/setupStreamFixture";
import {
  FACILITY_ORDINAL_KEYS,
  parseFacilityLevels,
  SpaceCenterStatusComponent,
} from "./index";

/**
 * Every value this widget reads is canonical now, `career.status`
 * (`?.economy?.funds` + `?.facilities`), `spaceCenter.scene`
 * (`?.scene`/`?.launchSite`) and the
 * derived `spaceCenter.state` channel (pad occupancy off
 * `spaceCenter.launchSites`): so every assertion drives real stream emits
 * through `setupStreamFixture`. The one thing still on the legacy path is the
 * `kc.upgradeFacility[...]` COMMAND (`mapCommand` has no home for it, so
 * `useExecuteAction("data")` takes the legacy branch), so a
 * `setupMockDataSource` command spy: registered under the default `"data"`
 * id `BufferedDataSource` uses, is kept purely for `onExecute`.
 */
const CARRIED = [
  "career.status",
  "spaceCenter.scene",
  "spaceCenter.launchSites",
];

describe("SpaceCenterStatusComponent", () => {
  let cmdFixture: MockDataSourceFixture;
  let onExecute: ReturnType<typeof vi.fn>;
  let stream: ReturnType<typeof setupStreamFixture>;

  beforeEach(async () => {
    onExecute = vi.fn();
    cmdFixture = await setupMockDataSource({ keys: [], onExecute });
    stream = setupStreamFixture({
      carriedChannels: CARRIED,
      pinnedUt: 10,
      suspendFrames: true,
    });
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
        {/* The identity the dashboard supplies: `Panel` completes
            `${componentId}.${segment}` from it for the universal
            `sections` and `actions` seams. */}
        <WidgetMetaContext.Provider
          value={{ componentId: "space-center-status", contributionSlots: [] }}
        >
          <DashboardItemContext.Provider value={{ instanceId: id }}>
            <SpaceCenterStatusComponent config={{}} id={id} />
          </DashboardItemContext.Provider>
        </WidgetMetaContext.Provider>
      </stream.Provider>,
    );
  }

  it("renders the panel title and an unknown pad line before any telemetry", () => {
    renderWidget();
    expect(screen.getByText(/SPACE CENTER/i)).toBeInTheDocument();
    // Not "No vehicle on pad": that is a claim about the pad, and this line is
    // announced through aria-live. Nothing has said anything about the pad yet.
    expect(screen.getByText(/Pad state unknown/i)).toBeInTheDocument();
    expect(screen.queryByText(/No vehicle on pad/i)).toBeNull();
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
    expect(
      stream.transport.sentCommands.filter(
        (c) => c.command === "career.facility.upgrade",
      ),
    ).toHaveLength(0);

    await user.click(screen.getByRole("button", { name: "Confirm" }));
    await waitFor(() => {
      const sent = stream.transport.sentCommands.find(
        (c) => c.command === "career.facility.upgrade",
      );
      expect(sent).toMatchObject({
        args: { facilityId: "VehicleAssemblyBuilding" },
        vantage: "meta",
      });
    });
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

  // Augment slot: the widget exposes
  // `space-center-status.sections` (body, appended to the facility list). With
  // no augment registered the slot renders nothing and the widget is
  // unchanged; once an augment binds it its component appears in the widget's
  // space.
  it("renders with an empty augment slot when nothing is registered", () => {
    const { container } = renderWidget();
    expect(screen.getByText(/SPACE CENTER/i)).toBeInTheDocument();
    expect(container.textContent).not.toContain("LS DEPOT");
  });

  it("renders an augment bound to the sections slot", () => {
    registerAugment({
      id: "test-ksc-section",
      augments: "space-center-status.sections",
      component: () => <div>LS DEPOT tier 1 of 3</div>,
    });

    const { container } = renderWidget();

    expect(visibleText(container)).toContain("LS DEPOT tier 1 of 3");
  });
});

describe("parseFacilityLevels", () => {
  /**
   * The short-code table has to cover KSP's whole `SpaceCenterFacility` enum.
   *
   * The abbreviations are ours, so the pairing is written down; the enum side is
   * not, so this is what catches a rename or an addition. Before the ordinal
   * existed the wire's map KEY was matched against a nine-entry name table and a
   * key that missed was `continue`d past, so a renamed facility did not error,
   * did not warn, and simply stopped being displayed. Nothing in the tree would
   * have caught that.
   */
  it("facilityOrdinalTableIsComplete: every SpaceCenterFacility member has a short code", () => {
    const members = [...KSP_SPACE_CENTER_FACILITY_NAMES.keys()].sort(
      (a, b) => a - b,
    );
    // Guards this reader: an empty names table would make any short-code table
    // pass, including an empty one.
    expect(members).toHaveLength(9);
    const missing = members.filter((m) => !FACILITY_ORDINAL_KEYS.has(m));
    expect(missing).toEqual([]);
    // And no short code invented for an ordinal KSP does not declare.
    const extra = [...FACILITY_ORDINAL_KEYS.keys()].filter(
      (k) => !KSP_SPACE_CENTER_FACILITY_NAMES.has(k),
    );
    expect(extra).toEqual([]);
  });

  /**
   * A facility identified by its ORDINAL, arriving under a map key this build
   * has never seen. It is still displayed, under the right short code.
   */
  it("resolves a facility from its ordinal, not from the map key", () => {
    const parsed = parseFacilityLevels({
      // What a future KSP might rename VehicleAssemblyBuilding to.
      AssemblyBuilding: {
        facilityOrdinal: KspSpaceCenterFacility.VehicleAssemblyBuilding,
        currentTier: 1,
        maxTier: 3,
      },
    });
    expect(parsed.vab?.level).toBe(1);
    expect(parsed.vab?.max).toBe(3);
  });

  it("still reads the enum-name key when no ordinal arrived", () => {
    const parsed = parseFacilityLevels({
      VehicleAssemblyBuilding: { currentTier: 2, maxTier: 3 },
    });
    expect(parsed.vab?.level).toBe(2);
  });

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
    // currentLevelText / nextLevelText default to empty strings when the producer does not emit them.
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
