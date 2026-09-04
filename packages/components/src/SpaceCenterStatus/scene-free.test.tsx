import {
  clearContributions,
  DashboardItemContext,
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
 * The facility grid away from the space centre.
 *
 * `career.status.facilities` is read off the live `UpgradeableFacility`
 * MonoBehaviours, which KSP instantiates in the SPACECENTER scene only, and
 * stock has no off-scene fallback to offer: `ProtoUpgradeable.GetLevel()` parses
 * the persisted `lvl` when the scene is empty, but its sibling `GetLevelCount()`
 * returns -1 there, so the normalised level cannot be turned back into a tier.
 * A career model that keeps its own tier table can answer anywhere, and
 * `space-center-status.facilities` is how it hands that answer to the grid.
 *
 * Priority is what stops the two answers being drawn twice: the widget
 * contributes its own `career.status` rows at 0, everything else defaults to 1,
 * and only the highest band present renders.
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
});

function mount() {
  const fixture = setupStreamFixture({
    carriedChannels: ["career.status", "spaceCenter.scene"],
    pinnedUt: 10,
    suspendFrames: true,
  });
  const { container, unmount } = render(
    <fixture.Provider>
      <ContributionHost
        componentId="space-center-status"
        contributionSlots={["space-center-status.facilities"]}
      >
        <DashboardItemContext.Provider value={{ instanceId: "scs-scene" }}>
          <SpaceCenterStatusComponent id="scs-scene" w={9} h={10} />
        </DashboardItemContext.Provider>
      </ContributionHost>
    </fixture.Provider>,
  );
  renderedTrees.push(unmount);
  return { ...fixture, container };
}

/** All nine keys the way the producer writes them off-scene: nothing to say. */
const NINE_SILENT = Object.fromEntries(
  [
    "LaunchPad",
    "Runway",
    "VehicleAssemblyBuilding",
    "SpaceplaneHangar",
    "MissionControl",
    "TrackingStation",
    "Administration",
    "ResearchAndDevelopment",
    "AstronautComplex",
  ].map((name) => [
    name,
    { currentTier: null, maxTier: null, upgradeCost: null },
  ]),
);

function emit(
  fixture: ReturnType<typeof mount>,
  scene: string,
  facilities: Record<string, unknown>,
) {
  act(() => {
    fixture.emit("spaceCenter.scene", { scene });
    fixture.emit("career.status", {
      economy: { funds: 100_000, reputation: 0, science: 0 },
      facilities,
      contracts: null,
      strategies: null,
      tech: null,
    });
  });
}

/** What a career model that reads its own tier table contributes. */
function contributeTiers(
  id: string,
  rows: ReadonlyArray<{
    facility: string;
    currentTier: number;
    maxTier: number;
    upgradeCost?: number;
  }>,
  priority?: number,
) {
  registerContribution({
    id,
    contributes: "space-center-status.facilities",
    priority,
    compute: () => rows,
  });
}

describe("SpaceCenterStatus: the facility grid away from the space centre", () => {
  /**
   * The case the operator has been shown twice: in flight, with a career model
   * answering, the grid above it was empty.
   */
  it("draws a contributed tier while the stock channel is silent in flight", async () => {
    contributeTiers("career-model-tiers", [
      { facility: "VehicleAssemblyBuilding", currentTier: 1, maxTier: 4 },
      { facility: "LaunchPad", currentTier: 0, maxTier: 2 },
    ]);
    const fixture = mount();

    emit(fixture, "Flight", NINE_SILENT);

    await waitFor(() =>
      expect(screen.getByLabelText("VAB tier 2 of 5")).toBeTruthy(),
    );
    expect(screen.getByLabelText("Launch Pad tier 1 of 3")).toBeTruthy();
    expect(visibleText(fixture.container)).not.toContain(
      "No facility tiers on this telemetry",
    );
  });

  /**
   * Equal priority is not a tie to break. Only a strictly higher band
   * displaces, so the widget's own rows step aside for a contributor and two
   * contributors at the same band both draw.
   */
  it("lets a contributed tier displace the stock one at the space centre", async () => {
    contributeTiers("career-model-tiers", [
      { facility: "VehicleAssemblyBuilding", currentTier: 3, maxTier: 4 },
    ]);
    const fixture = mount();

    emit(fixture, "SpaceCenter", {
      ...NINE_SILENT,
      VehicleAssemblyBuilding: { currentTier: 0, maxTier: 2, upgradeCost: 40 },
    });

    await waitFor(() =>
      expect(screen.getByLabelText("VAB tier 4 of 5")).toBeTruthy(),
    );
    expect(screen.queryByLabelText("VAB tier 1 of 3")).toBeNull();
  });

  /** Nobody contributing leaves the widget reading its own channel, unchanged. */
  it("still draws its own channel when nothing else contributes", async () => {
    const fixture = mount();

    emit(fixture, "SpaceCenter", {
      ...NINE_SILENT,
      Runway: { currentTier: 0, maxTier: 2, upgradeCost: 9_000 },
    });

    await waitFor(() =>
      expect(screen.getByLabelText("Runway tier 1 of 3")).toBeTruthy(),
    );
  });

  /**
   * Absent and zero stay different. A contributed tier 0 keeps its cell; a
   * facility nobody answered for gets none.
   */
  it("keeps a contributed tier 0 and gives no cell to a facility nobody answered", async () => {
    contributeTiers("career-model-tiers", [
      { facility: "Administration", currentTier: 0, maxTier: 8 },
    ]);
    const fixture = mount();

    emit(fixture, "Flight", NINE_SILENT);

    await waitFor(() =>
      expect(screen.getByLabelText("Admin tier 1 of 9")).toBeTruthy(),
    );
    for (const label of ["Launch Pad", "Runway", "VAB", "SPH"]) {
      expect(screen.queryByText(label)).toBeNull();
    }
  });

  /** Two career models at the same band both draw; neither silences the other. */
  it("draws both contributors when they share the winning band", async () => {
    contributeTiers("model-a", [
      { facility: "VehicleAssemblyBuilding", currentTier: 1, maxTier: 4 },
    ]);
    contributeTiers("model-b", [
      { facility: "Runway", currentTier: 2, maxTier: 4 },
    ]);
    const fixture = mount();

    emit(fixture, "Flight", NINE_SILENT);

    await waitFor(() =>
      expect(screen.getByLabelText("VAB tier 2 of 5")).toBeTruthy(),
    );
    expect(screen.getByLabelText("Runway tier 3 of 5")).toBeTruthy();
  });
});
