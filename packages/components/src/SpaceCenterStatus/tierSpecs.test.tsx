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
 * What a facility cell does with KSP's own tier descriptions: game copy, not a
 * contract, and either tier's half can be missing. Only a contributor carries
 * them; `career.facilities` does not.
 */
const renderedTrees: Array<() => void> = [];

afterEach(() => {
  for (const unmount of renderedTrees) unmount();
  renderedTrees.length = 0;
  // Emptying the registry takes the widget's own module-side-effect contribution too.
  clearContributions();
  registerStockFacilityContribution();
  clearActionHandlers();
});

/** `settledLabel` is required: facility names render before telemetry, so waiting on one returns on an empty grid. */
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
    // `career.facilities` is never emitted, so the contributed rows are the only thing in the slot.
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
    // One dash, the launch pad's own empty NOW block; unanswered facilities get no cell.
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
