import { clearActionHandlers, DashboardItemContext } from "@ksp-gonogo/core";
import { act, render, screen, waitFor } from "@ksp-gonogo/test-utils";
import { afterEach, describe, expect, it } from "vitest";
import { ContributionHost } from "../test/contributionHost";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { SpaceCenterStatusComponent } from "./index";

/**
 * What the upgrade control may claim about the operator's money. The gate has
 * the last word on whether the control is a purchase at all, and a money
 * verdict is drawn only where money is what decides. Under a career mod that
 * blocks the command and builds a tier progressively, "cannot afford" would be
 * false.
 */

/** A planted career mod's refusal, naming the command of its own that replaces this one. */
const PLANTED_DETAIL =
  "This career builds a facility upgrade as a project of its own, so it has " +
  "to be queued rather than bought outright. Use planted.facility.upgrade";

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

/** One facility with a tier left, so the single Upgrade control is unambiguous; the balance covers the VAB tier and not the Launch Pad's. */
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
    fixture.emit("career.facilities", { facilities });
    fixture.emit("career.status", {
      balances: { funds: 41250, reputation: 62, science: 340 },
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
            // GateOutcome.Fail / CommandErrorCode.ModeUnavailable.
            outcome: 1,
            errorCode: "modeUnavailable",
            detail: PLANTED_DETAIL,
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
  /** The control case: without it every assertion below would pass on a widget that stopped judging affordability. */
  it("still calls a short balance short when nothing has blocked the command", async () => {
    const fixture = setupStreamFixture({
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

  it("calls an affordable balance affordable when nothing has blocked the command", async () => {
    const fixture = setupStreamFixture({
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

  /** The career mod has blocked the command, so the balance decides nothing. */
  it("draws no shortfall over a price the blocked command is not charging", async () => {
    const fixture = setupStreamFixture({
      pinnedUt: 10,
    });
    const container = mount(fixture, "scs-spend-blocked-short");
    emitCareer(fixture, LAUNCH_PAD_SHORT);
    blockFacilityUpgrade(fixture);

    await waitFor(() => {
      expect(container.querySelector('[data-gate="blocked"]')).not.toBeNull();
    });
    // The price stays on screen; only the verdict over it goes.
    expect(container.textContent).toContain("112.5k");
    expect(container.querySelector("[data-afford]")).toBeNull();
  });

  /** A dark button with nothing to say reads like a maxed facility or a short balance. */
  it("names the gate's own reason rather than going quietly dark", async () => {
    const fixture = setupStreamFixture({
      pinnedUt: 10,
    });
    mount(fixture, "scs-spend-blocked-reason");
    emitCareer(fixture, LAUNCH_PAD_SHORT);
    blockFacilityUpgrade(fixture);

    const button = await screen.findByRole("button", {
      name: /planted\.facility\.upgrade/,
    });
    // aria-disabled, not disabled, so a screen reader still finds it and a press surfaces the reason.
    expect(button.getAttribute("aria-disabled")).toBe("true");
    expect((button as HTMLButtonElement).disabled).toBe(false);
  });

  /** An affordable tier is the one the operator would press, and under a blocking career mod the press cannot land. */
  it("does not offer an affordable tier as a live purchase the game will refuse", async () => {
    const fixture = setupStreamFixture({
      pinnedUt: 10,
    });
    mount(fixture, "scs-spend-blocked-affordable");
    emitCareer(fixture, VAB_AFFORDABLE);
    blockFacilityUpgrade(fixture);

    const button = await screen.findByRole("button", {
      name: /planted\.facility\.upgrade/,
    });
    expect(button.getAttribute("aria-disabled")).toBe("true");
  });
});
