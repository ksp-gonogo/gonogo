import { CORE_UPLINK_CLIENT } from "@ksp-gonogo/core";
import { stockFacilityEntries } from "./facilities";

// The widget's own reading of `career.status.facilities`, contributed into the
// widget's own grid at priority 0.
//
// It is here rather than read straight out of the component for one reason: at
// priority 0 it is the band every ordinary contribution outranks, so a career
// model that can answer where this cannot DISPLACES the grid instead of adding a
// second copy of it underneath. The stock channel comes off the live
// `UpgradeableFacility` objects, which KSP instantiates in the SPACECENTER scene
// only, so away from the space centre every tier and price on it is absent and
// this contributes nothing at all.
//
// There is no stock way round that, which is why the answer is a slot rather
// than a better read. `ProtoUpgradeable.GetLevel()` does parse the level the
// save persists when the scene is empty, but that level is NORMALISED and its
// sibling `GetLevelCount()` returns -1 off-scene, so there is no tier count to
// denormalise it against. A career overhaul carrying its own tier table has one.

/**
 * Registered at module load, and exported so a test that empties the whole
 * contribution registry can put it back. Nothing else can: the registration is a
 * module side effect, and `clearContributions` takes it with everything else, so
 * a test clearing the registry between cases would silently leave the grid with
 * no stock reading for every case after the first.
 */
export function registerStockFacilityContribution(): void {
  CORE_UPLINK_CLIENT.registerContribution({
    id: "space-center-status-facilities",
    contributes: "space-center-status.facilities",
    priority: 0,
    deps: ["career.status"],
    compute: (topics) =>
      stockFacilityEntries(topics["career.status"]?.facilities),
  });
}

registerStockFacilityContribution();
