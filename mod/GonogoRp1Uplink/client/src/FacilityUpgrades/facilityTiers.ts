import { magnitudeOf, type Quantityish } from "@ksp-gonogo/sitrep-sdk";
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
 * <para><b>It takes `unknown`, and checks.</b> The aggregation hands a
 * contribution whatever arrived on its deps, typed as `unknown` because the
 * SLOT declares which topics it guarantees and `rp1.facilities` is not one of
 * them. The contract says what the rows should look like; that is a description
 * of a producer, not a promise about a payload, so every field is read through a
 * check and a row that fails one is dropped rather than defaulted.</para>
 *
 * <para><b>A building RP-1 does not upgrade still gets its tier and never gets a
 * price.</b> `upgradedByRp1` is false for the five its config prices at a single
 * fund under a "cosmetic only" comment: RP-1 drives their tier itself from the
 * mean of the ones it does upgrade. The tier is a reading and is reported; the
 * price would be for a step nothing will take, so it is withheld and the grid
 * draws no control beside it.</para>
 */
export function facilityTiers(rows: unknown) {
  if (!Array.isArray(rows)) return [];
  const list: readonly unknown[] = rows;
  return list.flatMap((row) => {
    if (typeof row !== "object" || row === null) return [];
    const facility = fieldAt(row, "facility");
    const currentTier = magnitudeAt(row, "currentTier");
    const maxTier = magnitudeAt(row, "maxTier");
    // Both ends or nothing: a building whose tier could not be read is not a
    // building at tier 0, and the grid's whole subject is telling those apart.
    if (
      typeof facility !== "string" ||
      currentTier === null ||
      maxTier === null
    ) {
      return [];
    }
    const upgradeCost =
      fieldAt(row, "upgradedByRp1") === false
        ? null
        : magnitudeAt(row, "upgradeCost");
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

/** One field of a wire object, without asserting anything about the whole. */
function fieldAt(row: object, key: string): unknown {
  return key in row ? Reflect.get(row, key) : undefined;
}

/** Whether a field is something a magnitude can be read from. */
function isQuantityish(v: unknown): v is Quantityish {
  if (v === null || v === undefined || typeof v === "number") return true;
  return (
    typeof v === "object" && "magnitude" in v && typeof v.magnitude === "number"
  );
}

/** One field as a magnitude, or null when it is absent or is not a quantity. */
function magnitudeAt(row: object, key: string): number | null {
  const raw = fieldAt(row, key);
  return isQuantityish(raw) ? magnitudeOf(raw) : null;
}

RP1.registerContribution({
  id: "facility-tiers",
  contributes: "space-center-status.facilities",
  requires: "rp1",
  deps: ["rp1.facilities"],
  compute: (topics) => facilityTiers(topics["rp1.facilities"]),
});
