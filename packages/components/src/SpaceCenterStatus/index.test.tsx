import {
  DashboardItemContext,
  registerAugment,
  WidgetMetaContext,
} from "@ksp-gonogo/core";
import {
  type CareerFacility,
  KSP_SPACE_CENTER_FACILITY_NAMES,
  KspSpaceCenterFacility,
  value,
} from "@ksp-gonogo/sitrep-sdk";
import { act, render, screen, waitFor } from "@ksp-gonogo/test-utils";
import { visibleText } from "@ksp-gonogo/ui-kit/testing";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ContributionHost } from "../test/contributionHost";
import { setupStreamFixture } from "../test/setupStreamFixture";
import {
  FACILITY_ORDINAL_KEYS,
  parseFacilityLevels,
  SpaceCenterStatusComponent,
} from "./index";

/**
 * Every value this widget reads is canonical: `career.status`
 * (`?.economy?.funds`), `career.facilities`, `spaceCenter.scene`
 * (`?.scene`/`?.launchSite`) and the derived `spaceCenter.state` channel (pad
 * occupancy off `spaceCenter.launchSites`), so every assertion drives real
 * stream emits through `setupStreamFixture`. The upgrade spend is canonical
 * too: `career.facility.upgrade` is a mapped command and the arm-then-confirm
 * case reads it off `transport.sentCommands`.
 */
const CARRIED = [
  "career.status",
  "career.facilities",
  "spaceCenter.scene",
  "spaceCenter.launchSites",
];

describe("SpaceCenterStatusComponent", () => {
  let stream: ReturnType<typeof setupStreamFixture>;

  beforeEach(async () => {
    stream = setupStreamFixture({
      carriedChannels: CARRIED,
      pinnedUt: 10,
      suspendFrames: true,
    });
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
            <ContributionHost
              componentId="space-center-status"
              contributionSlots={["space-center-status.facilities"]}
            >
              <SpaceCenterStatusComponent config={{}} id={id} />
            </ContributionHost>
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
      stream.emit("career.facilities", {
        facilities: {
          LaunchPad: { currentTier: 1, maxTier: 2 },
          VehicleAssemblyBuilding: { currentTier: 2, maxTier: 2 },
        },
      });
      stream.emit("career.status", {
        economy: { funds: null, reputation: null, science: null },
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

  it("fires career.facility.upgrade on arm-then-confirm in the SC scene", async () => {
    const user = userEvent.setup();
    renderWidget();
    act(() => {
      stream.emit("spaceCenter.scene", { scene: "SpaceCenter" });
      stream.emit("career.facilities", {
        facilities: {
          VehicleAssemblyBuilding: {
            currentTier: 0,
            maxTier: 3,
            upgradeCost: 75_000,
          },
        },
      });
      stream.emit("career.status", {
        economy: { funds: 200_000, reputation: null, science: null },
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
      stream.emit("career.facilities", {
        facilities: {
          VehicleAssemblyBuilding: {
            currentTier: 0,
            maxTier: 3,
            upgradeCost: 75_000,
          },
        },
      });
      stream.emit("career.status", {
        economy: { funds: 200_000, reputation: null, science: null },
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
      stream.emit("career.facilities", {
        facilities: {
          VehicleAssemblyBuilding: {
            currentTier: 0,
            maxTier: 3,
            upgradeCost: 75_000,
          },
        },
      });
      stream.emit("career.status", {
        economy: { funds: 1_000, reputation: null, science: null },
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

  /**
   * The only registration in this file, and it is deliberately LAST.
   *
   * There is no `afterEach(clearAugments)` here on purpose. Clearing the
   * registry fires `useSyncExternalStore` subscribers while the tree is still
   * mounted, and every one of those updates lands outside `act`: it was worth
   * 18 act warnings across all 16 tests, measured, and removing it took them to
   * 0 with all 16 still passing. Nothing needed the clear, because the
   * empty-slot case above runs BEFORE this one and the registry does not
   * outlive the file (vitest isolates per file).
   *
   * So the ordering IS load-bearing now: a test added AFTER this one that
   * expects an empty slot would see this augment. Add it above, not below.
   */
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
  /** One wire entry, with its tiers minted as the `Value`s the contract declares. */
  const tier = (
    currentTier: number,
    maxTier: number,
    upgradeCost?: number,
  ): CareerFacility => ({
    currentTier: value("count", currentTier),
    maxTier: value("count", maxTier),
    ...(upgradeCost === undefined
      ? {}
      : { upgradeCost: value("funds", upgradeCost) }),
  });

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
        ...tier(1, 3),
        facilityOrdinal: KspSpaceCenterFacility.VehicleAssemblyBuilding,
      },
    });
    expect(parsed.vab?.level).toBe(1);
    expect(parsed.vab?.max).toBe(3);
  });

  it("still reads the enum-name key when no ordinal arrived", () => {
    const parsed = parseFacilityLevels({
      VehicleAssemblyBuilding: tier(2, 3),
    });
    expect(parsed.vab?.level).toBe(2);
  });

  it("returns an empty object for non-object input", () => {
    /* The two ways "no facilities" actually arrives: the channel carries the
       key with nothing under it, or `BuildFacilities` returned null for the
       whole group because the capture had none. */
    expect(parseFacilityLevels(undefined)).toEqual({});
    expect(parseFacilityLevels(null)).toEqual({});
  });

  it("retains valid facility entries and drops malformed ones", () => {
    const parsed = parseFacilityLevels({
      VehicleAssemblyBuilding: tier(1, 3, 75000),
      /* Half an answer is not an answer: both ends have to read or the
         building is not carried, because a building that said nothing is not
         a building at tier 0. */
      MissionControl: { currentTier: value("count", 1) },
      // Neither an ordinal nor a name this build knows.
      Cafeteria: tier(1, 3),
      LaunchPad: tier(0, 3),
    });
    // Tier text has no stock equivalent, so it is empty for every entry off
    // this channel; a career model that has its own contributes it instead.
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

  /**
   * The shape the widget used to accept and nothing has ever sent.
   * `CareerFacility` declares `facilityOrdinal`, `currentTier`, `maxTier` and
   * `upgradeCost`, and `CareerViewProvider.BuildFacilities` emits those four and
   * nothing else, so a `level`/`max`/`upgradeFunds` entry keyed by one of this
   * widget's own short codes cannot arrive. It is not carried.
   */
  it("does not admit a shape the contract cannot express", () => {
    expect(
      parseFacilityLevels({
        // @ts-expect-error is the assertion: `CareerFacility` has no `level`,
        // `max` or `upgradeFunds`, so this shape cannot be built, let alone
        // arrive. If the parameter ever widens back, this line stops erroring
        // and the typecheck fails.
        launchPad: { level: 1, max: 2, upgradeFunds: 150000 },
      }),
    ).toEqual({});
  });

  it("defaults upgradeFunds to 0 when missing", () => {
    const parsed = parseFacilityLevels({
      SpaceplaneHangar: tier(0, 3),
    });
    expect(parsed.sph?.upgradeFunds).toBe(0);
  });
});
