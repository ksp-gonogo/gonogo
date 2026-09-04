import {
  clearActionHandlers,
  clearContributions,
  DashboardItemContext,
  registerContribution,
} from "@ksp-gonogo/core";
import { act, render, screen, waitFor } from "@ksp-gonogo/test-utils";
import { NULL_DISPLAY } from "@ksp-gonogo/ui-kit";
import { afterEach, describe, expect, it } from "vitest";
import { ContributionHost } from "../test/contributionHost";
import { setupStreamFixture } from "../test/setupStreamFixture";
import type { SpaceCenterFacilityEntry } from "./facilities";
import { registerStockFacilityContribution } from "./facilitiesContribution";
import { SpaceCenterStatusComponent } from "./index";

/**
 * What a facility cell does with KSP's own tier descriptions. They arrive as the
 * stock upgrade dialog's asterisk-bulleted blob, they are game copy rather than
 * a contract, and either tier's half can be missing.
 *
 * They arrive through the `space-center-status.facilities` slot, which is the
 * only thing that carries them. `career.facilities` does not:
 * `CareerViewProvider.BuildFacilities` emits `facilityOrdinal`, `currentTier`,
 * `maxTier` and `upgradeCost`, and KSP's tier copy is not among them. A career
 * model that keeps its own tier table has the text and contributes it.
 */
const renderedTrees: Array<() => void> = [];

afterEach(() => {
  for (const unmount of renderedTrees) unmount();
  renderedTrees.length = 0;
  /* The widget's own contribution registers as a module side effect, so
     emptying the registry takes it too; put it back rather than leave every
     case after the first with no stock reading. */
  clearContributions();
  registerStockFacilityContribution();
  clearActionHandlers();
});

/**
 * `settledLabel` is the accessible name of a tier the contribution sets, and it
 * is required: the facility NAMES render before any telemetry arrives, so
 * waiting on one of those returns on the first tick with an empty grid behind
 * it.
 */
async function renderWithTiers(
  rows: readonly SpaceCenterFacilityEntry[],
  settledLabel: string,
  size: { w: number; h: number } = { w: 9, h: 10 },
) {
  registerContribution({
    id: "tier-text-model",
    contributes: "space-center-status.facilities",
    compute: () => rows,
  });
  const fixture = setupStreamFixture({
    carriedChannels: [
      "career.status",
      "career.facilities",
      "spaceCenter.scene",
    ],
    pinnedUt: 10,
    suspendFrames: true,
  });
  const { unmount } = render(
    <fixture.Provider>
      <DashboardItemContext.Provider value={{ instanceId: "scs-tiers" }}>
        <ContributionHost
          componentId="space-center-status"
          contributionSlots={["space-center-status.facilities"]}
        >
          <SpaceCenterStatusComponent id="scs-tiers" w={size.w} h={size.h} />
        </ContributionHost>
      </DashboardItemContext.Provider>
    </fixture.Provider>,
  );
  renderedTrees.push(unmount);
  act(() => {
    fixture.emit("spaceCenter.scene", { scene: "SpaceCenter" });
    /* `career.facilities` is deliberately never emitted: the stock contribution
       deps on it, so leaving it silent is what makes the contributed rows below
       the only thing in the slot. */
    fixture.emit("career.status", {
      economy: { funds: 100000, reputation: 0, science: 0 },
      contracts: null,
      strategies: null,
      tech: null,
    });
  });
  await waitFor(() => expect(screen.getByLabelText(settledLabel)).toBeTruthy());
}

describe("SpaceCenterStatus tier descriptions", () => {
  it("shows a bulleted property as a label and a value, with no asterisk", async () => {
    await renderWithTiers(
      [
        {
          facility: "LaunchPad",
          currentTier: 1,
          maxTier: 2,
          upgradeCost: 150000,
          currentTierText: "* Max Size: 140t\n* Max Parts: 255",
          nextTierText: "* Max Size: Unlimited\n* Max Parts: Unlimited",
        },
      ],
      "Launch Pad tier 2 of 3",
    );

    const texts = screen.getAllByRole("listitem").map((li) => li.textContent);
    expect(texts).toContain("Max Size140t");
    expect(texts).toContain("Max Parts255");
    expect(texts).toContain("Max SizeUnlimited");
    expect(texts.join("")).not.toContain("*");
  });

  it("keeps a line that names no property, rather than dropping it", async () => {
    await renderWithTiers(
      [
        {
          facility: "TrackingStation",
          currentTier: 0,
          maxTier: 2,
          upgradeCost: 45000,
          currentTierText: "* No maneuver nodes",
          nextTierText: "Patched conics (full)",
        },
      ],
      "Tracking tier 1 of 3",
    );

    const texts = screen.getAllByRole("listitem").map((li) => li.textContent);
    expect(texts).toContain("No maneuver nodes");
    expect(texts).toContain("Patched conics (full)");
  });

  it("names a missing tier description instead of leaving a gap", async () => {
    await renderWithTiers(
      [
        {
          facility: "LaunchPad",
          currentTier: 1,
          maxTier: 2,
          upgradeCost: 150000,
          nextTierText: "* Max Size: Unlimited",
        },
      ],
      "Launch Pad tier 2 of 3",
    );

    expect(screen.getByText("Now")).toBeInTheDocument();
    expect(screen.getByText("Next")).toBeInTheDocument();
    // One dash, and it is the launch pad's own empty NOW block. The eight
    // facilities nothing answered for get no cell at all: an absent facility has
    // no description to be missing, and eight dashes for them buried the one
    // that genuinely is.
    expect(screen.getAllByText(NULL_DISPLAY)).toHaveLength(1);
  });

  it("offers no next tier once the facility is at its ceiling", async () => {
    await renderWithTiers(
      [
        {
          facility: "VehicleAssemblyBuilding",
          currentTier: 2,
          maxTier: 2,
          currentTierText: "* Max Parts: Unlimited",
        },
      ],
      "VAB tier 3 of 3",
    );

    expect(screen.getByText("Now")).toBeInTheDocument();
    expect(screen.queryByText("Next")).not.toBeInTheDocument();
  });

  it("says once that the telemetry carries no tier descriptions at all", async () => {
    await renderWithTiers(
      [
        {
          facility: "LaunchPad",
          currentTier: 1,
          maxTier: 2,
          upgradeCost: 150000,
        },
        { facility: "VehicleAssemblyBuilding", currentTier: 2, maxTier: 2 },
      ],
      "Launch Pad tier 2 of 3",
    );

    expect(screen.getByText("No tier detail")).toBeInTheDocument();
    expect(screen.queryByText("Now")).not.toBeInTheDocument();
  });

  it("drops the tier lists where a cell is too narrow to hold them", async () => {
    await renderWithTiers(
      [
        {
          facility: "LaunchPad",
          currentTier: 1,
          maxTier: 2,
          upgradeCost: 150000,
          currentTierText: "* Max Size: 140t",
          nextTierText: "* Max Size: Unlimited",
        },
      ],
      "Launch Pad tier 2 of 3",
      { w: 6, h: 7 },
    );

    expect(screen.queryByText("Now")).not.toBeInTheDocument();
    expect(screen.queryAllByRole("listitem")).toHaveLength(0);
  });
});
