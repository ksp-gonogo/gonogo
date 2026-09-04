import { clearActionHandlers, DashboardItemContext } from "@ksp-gonogo/core";
import { act, render, screen, waitFor } from "@ksp-gonogo/test-utils";
import { afterEach, describe, expect, it } from "vitest";
import { ContributionHost } from "../test/contributionHost";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { SpaceCenterStatusComponent } from "./index";

/**
 * What the upgrade control may claim about the operator's money, and what it
 * may not.
 *
 * <para>This widget draws its own affordability verdict: a red price and a dark
 * button whenever the balance will not cover an upgrade. On a stock career that
 * is exactly right, because <c>career.facility.upgrade</c> buys a tier outright
 * and a short balance is the whole reason it cannot be had.</para>
 *
 * <para>Under a career overhaul it is a falsehood in both directions, and RP-1
 * is the shipped case. <c>Rp1CareerProjectGate</c> BLOCKS this command outright
 * and names the RP-1 command that queues the tier instead, so:</para>
 *
 * <para>- a tier the balance cannot cover goes dark for a reason that has
 * nothing to do with money, and a red price over it tells the operator they are
 * short of something they are not being charged for. RP-1 queues the same tier
 * as a construction project and <c>ConstructionProject.AddProgress</c> bills it
 * AS IT BUILDS, spending whatever fraction the career can meet
 * (<c>CurrencyUtils.GetAffordableFundsFraction</c>, read off the shipped RP-1
 * v4.6.0.0 RP0.dll). A short career gets a slower upgrade, never a refused one.
 * "You cannot afford this" is the one sentence that is certainly wrong;</para>
 *
 * <para>- a tier the balance CAN cover is drawn as a live purchase for a press
 * the game has already said it will refuse.</para>
 *
 * <para>So the rule the tests below hold is: the gate has the last word on
 * whether this control is a purchase at all, and a money verdict is drawn only
 * where money is what decides.</para>
 */

const CARRIED = [
  "career.status",
  "spaceCenter.scene",
  "spaceCenter.launchSites",
  "system.uplink.gates",
];

/** RP-1's own sentence, as `Rp1CareerProjectGate.FacilityDetail` writes it. */
const RP1_DETAIL =
  "RP-1 builds a facility upgrade as a construction project with its own cost " +
  "and duration, so it has to be queued rather than bought outright. Use " +
  "rp1.facility.upgrade";

const renderedTrees: Array<() => void> = [];

afterEach(() => {
  for (const unmount of renderedTrees) unmount();
  renderedTrees.length = 0;
  clearActionHandlers();
});

function mount(
  fixture: ReturnType<typeof setupStreamFixture>,
  instanceId: string,
) {
  const { container, unmount } = render(
    <fixture.Provider>
      <DashboardItemContext.Provider value={{ instanceId }}>
        <ContributionHost
          componentId="space-center-status"
          contributionSlots={["space-center-status.facilities"]}
        >
          <SpaceCenterStatusComponent id={instanceId} w={9} h={8} />
        </ContributionHost>
      </DashboardItemContext.Provider>
    </fixture.Provider>,
  );
  renderedTrees.push(unmount);
  return container;
}

/**
 * A career standing in the space centre with ONE facility that has a tier left,
 * so the single Upgrade control on screen is unambiguous.
 *
 * The figures are the ones the RP-1 render fixture uses, read off the Deck's own
 * career: 41,250f held against a 112,500f Launch Pad tier and a 40,000f VAB
 * tier, which is a balance that covers one of them and not the other.
 */
function emitCareer(
  fixture: ReturnType<typeof setupStreamFixture>,
  facilities: Record<string, unknown>,
): void {
  act(() => {
    fixture.emit("spaceCenter.scene", {
      scene: "SpaceCenter",
      launchSite: "LaunchPad",
    });
    fixture.emit("spaceCenter.launchSites", [
      { name: "__pad_occupancy__", padOccupied: false, padVesselTitle: null },
    ]);
    fixture.emit("career.status", {
      economy: { funds: 41250, reputation: 62, science: 340 },
      facilities,
      contracts: null,
      strategies: null,
      tech: null,
    });
  });
}

/** The mod's standing verdict, exactly as `system.uplink.gates` publishes it. */
function blockFacilityUpgrade(
  fixture: ReturnType<typeof setupStreamFixture>,
): void {
  act(() => {
    fixture.emit("system.uplink.gates", {
      gates: [
        {
          command: "career.facility.upgrade",
          verdict: {
            // GateOutcome.Fail / CommandErrorCode.ModeUnavailable, which is what
            // Rp1CareerProjectGate returns on a save RP-1 manages.
            outcome: 1,
            errorCode: 3,
            detail: RP1_DETAIL,
          },
        },
      ],
    });
  });
}

const LAUNCH_PAD_SHORT = {
  LaunchPad: { currentTier: 1, maxTier: 2, upgradeCost: 112500 },
};
const VAB_AFFORDABLE = {
  VehicleAssemblyBuilding: { currentTier: 0, maxTier: 2, upgradeCost: 40000 },
};

describe("SpaceCenterStatus: what the upgrade control claims about money", () => {
  /**
   * The control, and the half that must not change. On a stock career nothing
   * blocks the command, the balance IS what decides, and the verdict is honest.
   * Without this every assertion below would also pass on a widget that had
   * simply stopped judging affordability at all.
   */
  it("still calls a short balance short when nothing has blocked the command", async () => {
    const fixture = setupStreamFixture({
      carriedChannels: CARRIED,
      pinnedUt: 10,
    });
    const container = mount(fixture, "scs-spend-stock");
    emitCareer(fixture, LAUNCH_PAD_SHORT);

    const button = await screen.findByRole("button", { name: "Upgrade" });
    expect((button as HTMLButtonElement).disabled).toBe(true);
    expect(
      container.querySelector("[data-afford]")?.getAttribute("data-afford"),
    ).toBe("no");
  });

  /**
   * The other side of the same control: a balance that covers the tier arms the
   * press, and the price carries no shortfall.
   */
  it("calls an affordable balance affordable when nothing has blocked the command", async () => {
    const fixture = setupStreamFixture({
      carriedChannels: CARRIED,
      pinnedUt: 10,
    });
    const container = mount(fixture, "scs-spend-stock-ok");
    emitCareer(fixture, VAB_AFFORDABLE);

    const button = await screen.findByRole("button", { name: "Upgrade" });
    expect((button as HTMLButtonElement).disabled).toBe(false);
    expect(
      container.querySelector("[data-afford]")?.getAttribute("data-afford"),
    ).toBe("yes");
  });

  /**
   * The falsehood this file exists for. RP-1 has blocked the command, so the
   * balance decides nothing, and the tier the operator is looking at is one RP-1
   * would queue and build at whatever rate the career can meet.
   */
  it("draws no shortfall over a price the blocked command is not charging", async () => {
    const fixture = setupStreamFixture({
      carriedChannels: CARRIED,
      pinnedUt: 10,
    });
    const container = mount(fixture, "scs-spend-blocked-short");
    emitCareer(fixture, LAUNCH_PAD_SHORT);
    blockFacilityUpgrade(fixture);

    await waitFor(() => {
      expect(container.querySelector('[data-gate="blocked"]')).not.toBeNull();
    });
    // The price is still on screen: what it costs is a fact, and the operator
    // needs it beside the control. What is gone is the VERDICT over it.
    expect(container.textContent).toContain("112.5k");
    expect(container.querySelector("[data-afford]")).toBeNull();
  });

  /**
   * And the reason, on the control, before anyone presses it. A dark button with
   * nothing to say is indistinguishable from a fully-upgraded facility and from
   * a short balance, and only one of those three is what happened.
   */
  it("names the gate's own reason rather than going quietly dark", async () => {
    const fixture = setupStreamFixture({
      carriedChannels: CARRIED,
      pinnedUt: 10,
    });
    mount(fixture, "scs-spend-blocked-reason");
    emitCareer(fixture, LAUNCH_PAD_SHORT);
    blockFacilityUpgrade(fixture);

    const button = await screen.findByRole("button", {
      name: /rp1\.facility\.upgrade/,
    });
    /* aria-disabled and NOT disabled, the ruling CommandButton's `blocked`
       phase sets out, so a screen reader still finds the control and a press
       can surface the reason. */
    expect(button.getAttribute("aria-disabled")).toBe("true");
    expect((button as HTMLButtonElement).disabled).toBe(false);
  });

  /**
   * The direction that costs money rather than confusing. An affordable tier is
   * the one the operator would actually press, and under RP-1 that press cannot
   * land: `career.facility.upgrade` writes `UpgradeableFacility.SetLevel` at the
   * stock price into a construction queue that never heard of it, which is the
   * state the gate exists to keep out of the save.
   */
  it("does not offer an affordable tier as a live purchase the game will refuse", async () => {
    const fixture = setupStreamFixture({
      carriedChannels: CARRIED,
      pinnedUt: 10,
    });
    mount(fixture, "scs-spend-blocked-affordable");
    emitCareer(fixture, VAB_AFFORDABLE);
    blockFacilityUpgrade(fixture);

    const button = await screen.findByRole("button", {
      name: /rp1\.facility\.upgrade/,
    });
    expect(button.getAttribute("aria-disabled")).toBe("true");
  });
});
