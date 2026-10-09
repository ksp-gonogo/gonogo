import { CORE_UPLINK_CLIENT } from "@ksp-gonogo/core";
import { lastValue } from "../shared/drawnFrom";
import { stockFacilityEntries } from "./facilities";

/*
 * The widget's own reading of `career.facilities`, contributed into its own grid
 * at priority 0 so a career model that reads tiers live DISPLACES it rather than
 * adding a second copy. The channel goes silent away from the space centre, so
 * this carries the last real reading, and each entry carries that reading so the
 * widget dates it.
 */

const DECLARED_ID = "space-center-status-facilities";

/** Exported so a test that clears the contribution registry can put the stock reading back. */
export function registerStockFacilityContribution(): void {
  CORE_UPLINK_CLIENT.registerContribution({
    id: DECLARED_ID,
    contributes: "space-center-status.facilities",
    priority: 0,
    deps: ["career.facilities"],
    compute: (topics) => {
      const reading = topics["career.facilities"];
      return stockFacilityEntries(lastValue(reading)?.facilities).map(
        (entry) => ({ ...entry, held: reading }),
      );
    },
  });
}

registerStockFacilityContribution();
