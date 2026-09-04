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
 * The facility ladder outlives the scene it can be read in.
 *
 * KSP instantiates the `UpgradeableFacility` objects that carry a facility's
 * tier count in the space centre, the editor and flight near the KSC, and
 * nowhere else. `ScenarioUpgradeableFacilities.protoUpgradeables` is rebuilt on
 * every scene load and only registers the live ones, so its `GetLevelCount()`
 * answers -1 from the tracking station or from orbit. The persisted level is
 * NORMALISED, so a save alone cannot say whether 0.5 is tier 1 of 3 or tier 2
 * of 5, and no stock config carries the count: `upgradeLevels` is a serialized
 * field on the scene component.
 *
 * A tier count does not change during a save, so a reading taken at the space
 * centre is still true an hour later in orbit. What that reading needs is a
 * DATE, not a deletion, and `Reading`'s `stale` arm is exactly the shape:
 * the last real observation, the UT it was made at, and a grade. So the ladder
 * rides its own channel, which simply stops arriving once KSP stops being able
 * to answer, and the grid keeps drawing what it last read.
 *
 * Four answers stay distinct, which is the whole reason this is not a nullable
 * field on a channel that keeps ticking:
 *
 * - never seen (`pending`): no career has reported a ladder, the grid is empty
 * - confirmed empty (`absent`): a career with no facilities at all
 * - seen now (`observed`): standing at the space centre
 * - seen an hour ago (`stale`): the tiers, dated
 */
const CARRIED = ["career.status", "career.facilities", "spaceCenter.scene"];

const renderedTrees: Array<() => void> = [];

afterEach(() => {
  for (const unmount of renderedTrees) unmount();
  renderedTrees.length = 0;
  /**
   * Puts the widget's own band-0 reading back after a case that registered a
   * rival: `clearContributions` takes the host's own contribution with
   * everything else, and nothing re-runs a module import.
   */
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
 * The session minus the ladder: what keeps arriving wherever the player stands.
 *
 * Every emission is dated, the scene included. One left at the fixture's default
 * UT of zero pulls the view clock's anchor back to zero with it, so the
 * certainty horizon never passes the keyframe margin, nothing is ever measured
 * as overdue, and the channel under test reads live forever: the test would then
 * prove the opposite of what it says.
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
        /**
         * Keyed by enum name, with no ordinal: the key is a legitimate route on
         * its own, and pinning ordinals here would restate a table the widget
         * already owns.
         */
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

/**
 * Carry the session forward without the ladder: the player has left the space
 * centre, so the channel stops arriving while everything else keeps ticking.
 * Past the keyframe interval and its margin this is what the heartbeat tracker
 * reads as held-stale.
 */
function leaveTheSpaceCentre(fixture: ReturnType<typeof mount>): void {
  for (let ut = 40; ut <= 400; ut += 40) {
    fixture.wall.advanceBy(40);
    emitSession(fixture, ut, "Flight");
  }
}

/**
 * The caption is `Tiers read <Unit/> ago`, so its text is split across elements
 * and a plain text query cannot see it. Match on the composed textContent.
 */
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
    // `AutoEmptyState` keeps its fallback mounted and hides it, so the marker is
    // in the DOM either way and only its visibility says which state this is.
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

  /**
   * The two halves of this problem compose, and this is the case that says so.
   *
   * A career model with its own tier table reads a tier LIVE where the stock
   * channel can only hold its last one, so it takes the slot's higher band and
   * the grid becomes its reading. What must NOT survive that is the caption: the
   * stock channel is still stale, and dating someone else's live grid with it
   * would assert an age about numbers that do not have one.
   */
  it("gives up the grid, and the date with it, to a contributor that reads live", async () => {
    registerContribution({
      id: "test-career-model-facilities",
      contributes: "space-center-status.facilities",
      // The default band, which outranks the widget's own 0.
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

    // The rival's tiers, not the stock channel's: the Launch Pad reads 3 of 3
    // where `emitLadder` sent 2 of 3, so this cannot be the held grid relabelled.
    await waitFor(() =>
      expect(screen.getByLabelText("Launch Pad tier 3 of 3")).toBeTruthy(),
    );
    expect(screen.queryByLabelText("Launch Pad tier 2 of 3")).toBeNull();
    expect(tiersCaption()).toBeNull();
  });

  /**
   * The stock reading is a contribution like any other, so the band it sits in
   * is what decides whether it can be displaced at all. Asserted directly,
   * because it is a one-word property of a registration that nothing else in
   * this file would notice the loss of.
   */
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
