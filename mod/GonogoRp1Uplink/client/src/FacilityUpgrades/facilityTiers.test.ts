import { value } from "@ksp-gonogo/sitrep-sdk";
import { describe, expect, it } from "vitest";
import { facilityTiers } from "./facilityTiers";

/**
 * What RP-1 hands the host widget's facility grid.
 *
 * The grid is the surface that was empty in flight, because the stock channel
 * reads the live buildings and KSP only puts those in the space centre. RP-1
 * denormalises the level the save persists against its own tier count, so these
 * rows are the same three facts read a way that survives leaving the scene.
 */
describe("facilityTiers", () => {
  it("carries the tier, the ceiling and the price straight through", () => {
    expect(
      facilityTiers([
        {
          facility: "VehicleAssemblyBuilding",
          currentTier: value("count", 1),
          maxTier: value("count", 4),
          upgradeCost: value("funds", 40_000),
          upgradedByRp1: true,
        },
      ]),
    ).toEqual([
      {
        facility: "VehicleAssemblyBuilding",
        currentTier: 1,
        maxTier: 4,
        upgradeCost: 40_000,
      },
    ]);
  });

  /**
   * Tier 0 is where every career starts, and a building that said nothing is a
   * different reading. Only the second is dropped.
   */
  it("keeps a building at tier 0 and drops one that answered no tier", () => {
    expect(
      facilityTiers([
        {
          facility: "Administration",
          currentTier: value("count", 0),
          maxTier: value("count", 8),
        },
        { facility: "Runway", maxTier: value("count", 2) },
        {
          currentTier: value("count", 1),
          maxTier: value("count", 2),
        },
      ]),
    ).toEqual([{ facility: "Administration", currentTier: 0, maxTier: 8 }]);
  });

  /**
   * RP-1 prices five buildings at a single fund under a "cosmetic only" comment
   * and drives their tier from the mean of the ones it does upgrade. The tier is
   * still a reading; the price is for a step nothing will take.
   */
  it("reports a cosmetic building's tier and withholds its price", () => {
    expect(
      facilityTiers([
        {
          facility: "MissionControl",
          currentTier: value("count", 2),
          maxTier: value("count", 8),
          upgradeCost: value("funds", 1),
          upgradedByRp1: false,
        },
      ]),
    ).toEqual([{ facility: "MissionControl", currentTier: 2, maxTier: 8 }]);
  });

  /** No channel, no rows, and never a fabricated one. */
  it("contributes nothing when the channel is silent", () => {
    expect(facilityTiers(undefined)).toEqual([]);
  });
});
