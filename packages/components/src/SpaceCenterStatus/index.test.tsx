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
import { beforeEach, describe, expect, it } from "vitest";
import { ContributionHost } from "../test/contributionHost";
import { perItemGateReport } from "../test/perItemGate";
import { setupStreamFixture } from "../test/setupStreamFixture";
import {
  FACILITY_ORDINAL_KEYS,
  parseFacilityLevels,
  SpaceCenterStatusComponent,
} from "./index";

describe("SpaceCenterStatusComponent", () => {
  let stream: ReturnType<typeof setupStreamFixture>;

  beforeEach(async () => {
    stream = setupStreamFixture({
      pinnedUt: 10,
      suspendFrames: true,
    });
  });

  function renderWidget(id = "ksc") {
    return render(
      <stream.Provider>
        {/* `Panel` completes `${componentId}.${segment}` from this identity for the `sections` and `actions` seams. */}
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
    // Nothing has said anything about the pad yet, so no claim about it.
    expect(screen.getByText(/Pad state unknown/i)).toBeInTheDocument();
    expect(screen.queryByText(/No vehicle on pad/i)).toBeNull();
  });

  it("shows facility tiers when telemetry arrives", async () => {
    renderWidget();
    act(() => {
      // Tiers are 0-based on the wire; the widget renders `(tier+1) / (max+1)`.
      stream.emit("career.facilities", {
        facilities: {
          LaunchPad: { currentTier: 1, maxTier: 2 },
          VehicleAssemblyBuilding: { currentTier: 2, maxTier: 2 },
        },
      });
      stream.emit("career.status", {
        balances: { funds: null, reputation: null, science: null },
        contracts: null,
        strategies: null,
        tech: null,
      });
    });
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
        balances: { funds: 200_000, reputation: null, science: null },
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

  /** The scene is the command's to declare, and `career.facility.upgrade` declares none. */
  it("offers the upgrade outside the SC scene", async () => {
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
        balances: { funds: 200_000, reputation: null, science: null },
        contracts: null,
        strategies: null,
        tech: null,
      });
    });

    const upgradeButtons = await screen.findAllByRole("button", {
      name: "Upgrade",
    });
    expect((upgradeButtons[0] as HTMLButtonElement).disabled).toBe(false);
  });

  it("leaves upgrade live on a short balance until the facility's gate refuses it", async () => {
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
        balances: { funds: 1_000, reputation: null, science: null },
        contracts: null,
        strategies: null,
        tech: null,
      });
    });

    const upgradeButtons = await screen.findAllByRole("button", {
      name: "Upgrade",
    });
    expect((upgradeButtons[0] as HTMLButtonElement).disabled).toBe(false);

    act(() => {
      stream.emit(
        "system.uplink.gates",
        perItemGateReport("career.facility.upgrade", "facilityId", {
          VehicleAssemblyBuilding: {
            errorCode: "insufficientFunds",
            detail: "short of funds",
          },
        }),
      );
    });
    const refused = await screen.findByRole("button", {
      name: /short of funds/,
    });
    expect(refused.getAttribute("aria-disabled")).toBe("true");
  });

  it("renders with an empty augment slot when nothing is registered", () => {
    const { container } = renderWidget();
    expect(screen.getByText(/SPACE CENTER/i)).toBeInTheDocument();
    expect(container.textContent).not.toContain("LS DEPOT");
  });

  /** Registers an augment with no clear afterwards, so a test expecting an empty slot must go ABOVE this one. */
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

  /** The short-code table covers KSP's whole `SpaceCenterFacility` enum, so a rename or addition is caught. */
  it("facilityOrdinalTableIsComplete: every SpaceCenterFacility member has a short code", () => {
    const members = [...KSP_SPACE_CENTER_FACILITY_NAMES.keys()].sort(
      (a, b) => a - b,
    );
    // Guards this reader: an empty names table would make any short-code table pass, including an empty one.
    expect(members).toHaveLength(9);
    const missing = members.filter((m) => !FACILITY_ORDINAL_KEYS.has(m));
    expect(missing).toEqual([]);
    // And no short code invented for an ordinal KSP does not declare.
    const extra = [...FACILITY_ORDINAL_KEYS.keys()].filter(
      (k) => !KSP_SPACE_CENTER_FACILITY_NAMES.has(k),
    );
    expect(extra).toEqual([]);
  });

  /** A facility arriving under an unseen map key is still displayed, via its ordinal. */
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
    // The two ways "no facilities" arrives: an empty key, or a null group.
    expect(parseFacilityLevels(undefined)).toEqual({});
    expect(parseFacilityLevels(null)).toEqual({});
  });

  it("retains valid facility entries and drops malformed ones", () => {
    const parsed = parseFacilityLevels({
      VehicleAssemblyBuilding: tier(1, 3, 75000),
      // Both tiers have to read or the building is not carried.
      MissionControl: { currentTier: value("count", 1) },
      // Neither an ordinal nor a name this build knows.
      Cafeteria: tier(1, 3),
      LaunchPad: tier(0, 3),
    });
    // Tier text has no stock equivalent, so it is empty for every entry off this channel.
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

  /** A `level`/`max`/`upgradeFunds` entry keyed by a short code is not the contract's shape and is not carried. */
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
