import {
  render,
  screen,
  setupStreamFixture,
  waitFor,
} from "@ksp-gonogo/sitrep-sdk/testing";
import { visibleText } from "@ksp-gonogo/ui-kit/testing";
import { describe, expect, it } from "vitest";
import { FacilityUpgrades } from "./FacilityUpgrades";
import { KscConstruction } from "./KscConstruction";

/**
 * The two RP-1 sections that put a facility's tier on screen, mounted together
 * because that is how the operator meets them: both land in
 * `SpaceCenterStatus`, one above the other, beside the host's own grid.
 *
 * <para>Every tier on the wire is KSP's own zero-based facility level.
 * `career.status.facilities[x].currentTier` is `UpgradeableFacility.FacilityLevel`
 * and `rp1.constructions[].currentLevel` is
 * `RP0.FacilityUpgradeProject.currentLevel`, which `Abort()` feeds straight to
 * `UpgradeableObject.SetLevel`, so the two are the same index in the same
 * domain. An operator counts from one, KSP's own R&amp;D dialog calls a fully
 * upgraded VAB "Level 3", and the host's grid draws `index + 1`. Anything here
 * that draws the raw index puts two numbers for one building on one screen.</para>
 */
const TOPICS = [
  "rp1.available",
  "rp1.constructions",
  "rp1.centres",
  "career.status",
];

const CENTRES = [
  {
    kscName: "Cape",
    kscDisplayName: "Cape Canaveral",
    isActive: true,
    engineers: 24,
    unassignedEngineers: 6,
    launchComplexCount: 2,
    anyOperational: true,
    groundStation: "us_cape_canaveral",
  },
];

/**
 * The reviewed render's career. R&amp;D is mid-upgrade, the Launch Pad and the
 * VAB have a tier to commit to, the Tracking Station is at its ceiling.
 */
const CAREER = {
  economy: { funds: 41_250, reputation: 62, science: 340 },
  facilities: {
    LaunchPad: { currentTier: 1, maxTier: 2, upgradeCost: 112_500 },
    VehicleAssemblyBuilding: {
      currentTier: 0,
      maxTier: 2,
      upgradeCost: 40_000,
    },
    ResearchAndDevelopment: { currentTier: 1, maxTier: 2, upgradeCost: 60_000 },
    TrackingStation: { currentTier: 2, maxTier: 2, upgradeCost: null },
  },
};

const RD_UNDER_CONSTRUCTION = [
  {
    kind: "FacilityUpgrade",
    kscName: "Cape",
    name: "ResearchAndDevelopment",
    facilityType: "ResearchAndDevelopment",
    currentLevel: 1,
    targetLevel: 2,
    cost: 60_000,
    spentCost: 14_200,
    progressRatio: 0.24,
    timeLeftSeconds: 8_200_000,
    workRate: 1,
    stalled: false,
    isModify: false,
  },
];

function mount() {
  const fixture = setupStreamFixture({ carriedChannels: TOPICS });
  const view = render(
    <fixture.Provider>
      <FacilityUpgrades />
      <KscConstruction />
    </fixture.Provider>,
  );
  fixture.emit("rp1.available", true);
  fixture.emit("rp1.centres", CENTRES);
  fixture.emit("career.status", CAREER);
  fixture.emit("rp1.constructions", RD_UNDER_CONSTRUCTION);
  return { fixture, view };
}

describe("RP-1 facility tiers are counted one way across the whole screen", () => {
  /**
   * The reported defect's other half. R&amp;D is at wire tier 1, which the host
   * grid draws "2 / 3"; the construction card drew the raw index as
   * "level 1 to 2", so one building read as two different tiers 300px apart.
   */
  it("counts a construction's tiers the way the operator does", async () => {
    const { view } = mount();

    await waitFor(() => {
      expect(screen.getByText("SITE CONSTRUCTION")).toBeInTheDocument();
    });
    const text = visibleText(view.container);
    expect(text).toContain("tier 2 to 3");
    expect(text).not.toContain("level 1 to 2");
  });

  /**
   * The badge is the tier the press would BUY, and the detail line under it is
   * the tier the building is at now. Both are right and unlabelled they read as
   * a contradiction: the reviewed render had "TIER 3" over "now at tier 2 of 3"
   * beside a grid reading "2 / 3".
   */
  it("says a queued upgrade's badge is the tier it goes to, not the tier it is at", async () => {
    const { view } = mount();

    await waitFor(() => {
      expect(screen.getByText("FACILITY UPGRADES")).toBeInTheDocument();
    });
    const text = visibleText(view.container);
    expect(text).toContain("TO TIER 3");
    expect(text).toContain("now at tier 2 of 3");
    // The bare form is what an operator read as the current tier.
    expect(text).not.toMatch(/(?<!TO )TIER 3/);
  });
});
