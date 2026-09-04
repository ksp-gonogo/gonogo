import { CORE_UPLINK_CLIENT } from "@ksp-gonogo/core";
import { stockFacilityEntries } from "./facilities";

// The widget's own reading of `career.facilities`, contributed into the widget's
// own grid at priority 0.
//
// It is here rather than read straight out of the component for one reason: at
// priority 0 it is the band every ordinary contribution outranks, so a career
// model that reads a tier LIVE where this one can only hold the last reading
// DISPLACES the grid instead of adding a second copy of it underneath.
//
// `career.facilities` stops arriving away from the space centre, because KSP
// instantiates the buildings behind it only in the SPACECENTER and EDITOR scenes
// and in flight near the KSC. That silence is deliberate and the channel declares
// it (`ChannelDeclaration.NullIsUnreadable`), so what the aggregation samples
// here is the last real reading rather than a row of nulls, and a tier count does
// not change during a save, so it is still true. What it stops being is CURRENT,
// and this compute cannot say so: a contribution is fed payloads and never the
// readings behind them. The widget dates it instead, off its own read of the same
// channel and only while this contribution is the one holding the band. See
// `tiersHeldForSec` in `./index.tsx`.

/** The id as DECLARED, before the handle stamps its owner onto it. */
const DECLARED_ID = "space-center-status-facilities";

/**
 * The id as REGISTERED, which is what the registry answers with and therefore
 * the only form worth comparing against.
 *
 * `CORE_UPLINK_CLIENT.registerContribution` namespaces what it is given
 * (`${owner}:${id}`), so the declared id matches nothing in the registry. Built
 * from the client's own id rather than written out with the prefix inline: a
 * hardcoded `"core:"` is a second copy of a fact the handle owns, and a check
 * that silently stops matching reads exactly like the condition being false.
 *
 * The widget asks this before dating what is on screen. Without that check the
 * age would be drawn over whatever won the band, and on an install whose career
 * model answers live it would caption a current grid with the stock channel's
 * staleness: the sharpest form of the failure the staleness type exists to
 * prevent, committed by the mechanism added to prevent it.
 */
export const STOCK_FACILITY_CONTRIBUTION_ID = `${CORE_UPLINK_CLIENT.id}:${DECLARED_ID}`;

/**
 * Registered at module load, and exported so a test that empties the whole
 * contribution registry can put it back. Nothing else can: the registration is a
 * module side effect, and `clearContributions` takes it with everything else, so
 * a test clearing the registry between cases would silently leave the grid with
 * no stock reading for every case after the first.
 */
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
