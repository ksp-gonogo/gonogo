import {
  clearContributions,
  DashboardItemContext,
  getContributionsForSlot,
  registerContribution,
} from "@ksp-gonogo/core";
import { act, render, screen, waitFor } from "@ksp-gonogo/test-utils";
import { visibleText } from "@ksp-gonogo/ui-kit/testing";
import { afterEach, describe, expect, it } from "vitest";
import { ContributionHost } from "../test/contributionHost";
import { setupStreamFixture } from "../test/setupStreamFixture";
import { registerStockFacilityContribution } from "./facilitiesContribution";
import { SpaceCenterStatusComponent } from "./index";

/**
 * The facility ladder outlives the scene it can be read in: KSP answers tier
 * counts only at the space centre, and a tier count does not change during a
 * save, so the grid keeps its last reading and dates it once the channel stops
 * arriving.
 */
const CARRIED = ["career.status", "career.facilities", "spaceCenter.scene"];

const renderedTrees: Array<() => void> = [];

afterEach(() => {
  for (const unmount of renderedTrees) unmount();
  renderedTrees.length = 0;
  // `clearContributions` takes the widget's own band-0 contribution too.
  clearContributions();
  registerStockFacilityContribution();
});

function mount() {
  const fixture = setupStreamFixture({
    carriedChannels: CARRIED,
    suspendFrames: true,
  });
  const { container, unmount } = render(
    <fixture.Provider>
      <DashboardItemContext.Provider value={{ instanceId: "scs-held" }}>
        <ContributionHost
          componentId="space-center-status"
          contributionSlots={["space-center-status.facilities"]}
        >
          <SpaceCenterStatusComponent id="scs-held" w={9} h={10} />
        </ContributionHost>
      </DashboardItemContext.Provider>
    </fixture.Provider>,
  );
  renderedTrees.push(unmount);
  return { ...fixture, container };
}

/**
 * The session minus the ladder. Every emission is dated: one left at UT zero
 * pulls the view clock's anchor back and the ladder would never read overdue.
 */
function emitSession(
  fixture: ReturnType<typeof mount>,
  ut: number,
  scene: string,
): void {
  act(() => {
    fixture.emit(
      "career.status",
      {
        economy: { funds: 500_000, reputation: 0, science: 0 },
        contracts: null,
        strategies: null,
        tech: null,
      },
      { validAt: ut, deliveredAt: ut },
    );
    fixture.emit(
      "spaceCenter.scene",
      { scene },
      { validAt: ut, deliveredAt: ut },
    );
  });
}

/** What the space centre answers: a real ladder for every facility. */
function emitLadder(fixture: ReturnType<typeof mount>, ut: number): void {
  act(() => {
    fixture.emit(
      "career.facilities",
      {
        facilities: {
          LaunchPad: { currentTier: 1, maxTier: 2, upgradeCost: 150_000 },
          VehicleAssemblyBuilding: {
            currentTier: 0,
            maxTier: 2,
            upgradeCost: 40_000,
          },
        },
      },
      { validAt: ut, deliveredAt: ut },
    );
  });
}

/** The player leaves the space centre: the ladder stops while everything else ticks, past the keyframe margin. */
function leaveTheSpaceCentre(fixture: ReturnType<typeof mount>): void {
  for (let ut = 40; ut <= 400; ut += 40) {
    fixture.wall.advanceBy(40);
    emitSession(fixture, ut, "Flight");
  }
}

/** The caption's text is split across elements, so match on composed textContent. */
function tiersCaption(): HTMLElement | null {
  return (Array.from(document.querySelectorAll("*")).find((el) =>
    /Tiers read .* ago/.test(el.textContent ?? ""),
  ) ?? null) as HTMLElement | null;
}

describe("SpaceCenterStatus: a ladder read at the space centre", () => {
  it("keeps reporting the tiers after the channel stops arriving", async () => {
    const fixture = mount();

    emitSession(fixture, 10, "SpaceCenter");
    emitLadder(fixture, 10);
    await waitFor(() =>
      expect(screen.getByLabelText("Launch Pad tier 2 of 3")).toBeTruthy(),
    );

    leaveTheSpaceCentre(fixture);

    await waitFor(() =>
      expect(screen.getByLabelText("Launch Pad tier 2 of 3")).toBeTruthy(),
    );
    expect(screen.getByLabelText("VAB tier 1 of 3")).toBeTruthy();
    // `AutoEmptyState` keeps its fallback mounted and hidden, so only visibility says which state this is.
    expect(screen.getByText("No facility tiers")).not.toBeVisible();
  });

  it("dates the tiers it is no longer reading", async () => {
    const fixture = mount();

    emitSession(fixture, 10, "SpaceCenter");
    emitLadder(fixture, 10);
    await waitFor(() =>
      expect(screen.getByLabelText("Launch Pad tier 2 of 3")).toBeTruthy(),
    );
    expect(tiersCaption()).toBeNull();

    leaveTheSpaceCentre(fixture);

    await waitFor(() => expect(tiersCaption()).toBeTruthy());
  });

  /** A contributor reading live takes the grid, and the stock channel's staleness must not caption it. */
  it("gives up the grid, and the date with it, to a contributor that reads live", async () => {
    registerContribution({
      id: "test-career-model-facilities",
      contributes: "space-center-status.facilities",
      deps: [],
      compute: () => [
        { facility: "LaunchPad", currentTier: 2, maxTier: 2 },
        { facility: "VehicleAssemblyBuilding", currentTier: 1, maxTier: 2 },
      ],
    });
    const fixture = mount();

    emitSession(fixture, 10, "SpaceCenter");
    emitLadder(fixture, 10);
    leaveTheSpaceCentre(fixture);

    // 3 of 3 where `emitLadder` sent 2 of 3, so this cannot be the held grid relabelled.
    await waitFor(() =>
      expect(screen.getByLabelText("Launch Pad tier 3 of 3")).toBeTruthy(),
    );
    expect(screen.queryByLabelText("Launch Pad tier 2 of 3")).toBeNull();
    expect(tiersCaption()).toBeNull();
  });

  /** The band decides whether the stock reading can be displaced at all. */
  it("registers the stock reading at the band every contributor outranks", () => {
    const stock = getContributionsForSlot("space-center-status.facilities");
    expect(stock).toHaveLength(1);
    expect(stock[0].id).toBe("core:space-center-status-facilities");
    expect(stock[0].priority).toBe(0);
    expect(stock[0].deps).toEqual(["career.facilities"]);
  });

  it("says nothing about tiers no career has reported", async () => {
    const fixture = mount();

    emitSession(fixture, 10, "SpaceCenter");

    await waitFor(() =>
      expect(visibleText(fixture.container)).toContain("No facility tiers"),
    );
    expect(tiersCaption()).toBeNull();
  });
});
