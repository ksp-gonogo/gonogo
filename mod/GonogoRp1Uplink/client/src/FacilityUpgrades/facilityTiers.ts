import { magnitudeOf } from "@ksp-gonogo/sitrep-sdk";
import type { Rp1FacilityEntry } from "../__generated__/contract";
import { RP1 } from "../uplink";

/**
 * RP-1's tiers, into the host widget's own facility grid.
 *
 * <para><b>The grid above this Uplink's section used to be empty in flight, and
 * this is why.</b> `career.status.facilities` is read off the live
 * `UpgradeableFacility` objects, which KSP instantiates in the SPACECENTER scene
 * only, so away from the space centre every tier and price on it is absent. That
 * is not a gap the host could close for itself: stock's off-scene fallback,
 * `ProtoUpgradeable.GetLevel()`, returns a NORMALISED level, and its sibling
 * `GetLevelCount()` answers -1 when the scene has no buildings in it, so there is
 * no tier count to denormalise against. RP-1 has one, out of its own config, and
 * bills the career off it in all four scenes.</para>
 *
 * <para><b>It DISPLACES the host's rows rather than joining them.</b> The widget
 * contributes its own reading of the stock channel at priority 0; this one takes
 * the default, so wherever RP-1 answers the grid is RP-1's and there is no
 * second copy of the same nine buildings underneath. Where RP-1 is not running
 * the contribution is not registered at all and the grid is the host's own.</para>
 *
 * <para><b>A building RP-1 does not upgrade still gets its tier and never gets a
 * price.</b> `upgradedByRp1` is false for the five its config prices at a single
 * fund under a "cosmetic only" comment: RP-1 drives their tier itself from the
 * mean of the ones it does upgrade. The tier is a reading and is reported; the
 * price would be for a step nothing will take, so it is withheld and the grid
 * draws no control beside it.</para>
 */
export function facilityTiers(rows: readonly Rp1FacilityEntry[] | undefined) {
  if (!rows) return [];
  return rows.flatMap((row) => {
    const facility = row.facility;
    const currentTier = magnitudeOf(row.currentTier);
    const maxTier = magnitudeOf(row.maxTier);
    // Both ends or nothing: a building whose tier could not be read is not a
    // building at tier 0, and the grid's whole subject is telling those apart.
    if (
      facility === undefined ||
      facility === null ||
      currentTier === null ||
      maxTier === null
    ) {
      return [];
    }
    const upgradeCost =
      row.upgradedByRp1 === false ? null : magnitudeOf(row.upgradeCost);
    return [
      {
        facility,
        currentTier,
        maxTier,
        ...(upgradeCost === null ? {} : { upgradeCost }),
      },
    ];
  });
}

RP1.registerContribution({
  id: "facility-tiers",
  contributes: "space-center-status.facilities",
  requires: "rp1",
  deps: ["rp1.facilities"],
  compute: (topics) =>
    facilityTiers(topics["rp1.facilities"] as readonly Rp1FacilityEntry[]),
});
