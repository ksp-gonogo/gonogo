import { CORE_UPLINK_CLIENT } from "@ksp-gonogo/core";
import { stockFacilityEntries } from "./facilities";

/*
 * The widget's own reading of `career.facilities`, contributed into its own grid
 * at priority 0 so a career model that reads tiers live DISPLACES it rather than
 * adding a second copy. The channel goes silent away from the space centre, so
 * this carries the last real reading; the widget dates it (`tiersHeldForSec`).
 */

const DECLARED_ID = "space-center-status-facilities";

/**
 * The id as REGISTERED (`${owner}:${id}`), the only form the registry answers
 * with. The widget checks it before dating the grid, so a live career model's
 * grid is never captioned with the stock channel's staleness.
 */
export const STOCK_FACILITY_CONTRIBUTION_ID = `${CORE_UPLINK_CLIENT.id}:${DECLARED_ID}`;

/** Exported so a test that clears the contribution registry can put the stock reading back. */
export function registerStockFacilityContribution(): void {
  CORE_UPLINK_CLIENT.registerContribution({
    id: DECLARED_ID,
    contributes: "space-center-status.facilities",
    priority: 0,
    deps: ["career.facilities"],
    compute: (topics) =>
      stockFacilityEntries(topics["career.facilities"]?.facilities),
  });
}

registerStockFacilityContribution();
