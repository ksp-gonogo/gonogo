import type { ResourceAmount } from "@ksp-gonogo/sitrep-sdk";
import type {
  KerbalismLifeSupport,
  KerbalismProfile,
} from "./__generated__/contract";
import { mag, type Summary, summarise } from "./ecosystem";
import { KERBALISM } from "./uplink";

// ---------------------------------------------------------------------------
// The single per-frame derivation the Ship Systems widget AND its panel badge
// both pull from (contribution-slots-spec.md §13-14, the Processor primitive's
// first real Uplink consumer). `summarise` runs ONCE against the four
// Kerbalism/vessel payloads per Sitrep frame no matter how many surfaces read
// it: the widget via `useProcessor`, the badge via a contribution `deps` on the
// handle this module exports. Before this, the widget re-derived on its own and
// a badge would have derived a second time.
//
// The result also carries the raw inputs the widget re-uses to build a
// per-resource ledger on demand: `buildLedger` is per-resource (one resource
// per call), so it stays a click-time call when a row is expanded, not part of
// this frame model.
// ---------------------------------------------------------------------------

export interface ShipSystems {
  /** Row model + root-cause ordering, the whole widget body renders from this. */
  summary: Summary;
  /** Carried so the widget can `buildLedger` for an expanded row without a re-subscribe. */
  profile: KerbalismProfile | undefined;
  lifeSupport: KerbalismLifeSupport | undefined;
  crew: number;
}

/**
 * `kerbalism:ship-systems`. The owner-stamped Processor handle. Import it to
 * consume the derivation, never re-declare it: a second registration under the
 * same id with a different compute throws (processors.ts).
 */
export const SHIP_SYSTEMS = KERBALISM.registerProcessor({
  id: "ship-systems",
  deps: [
    "kerbalism.profile",
    "kerbalism.lifesupport",
    "vessel.resources",
    "vessel.crew",
  ] as const,
  compute: ([profile, lifeSupport, resources, crew]): ShipSystems => {
    // `stored`/`capacity` were never Kerbalism-specific: they come off the
    // generic `vessel.resources` levels, keyed by KSP resource name.
    const stored: Record<string, number> = {};
    const capacity: Record<string, number> = {};
    const levels: Record<string, ResourceAmount> = resources?.resources ?? {};
    for (const [name, amount] of Object.entries(levels)) {
      stored[name] = mag(amount.current);
      capacity[name] = mag(amount.max);
    }
    const crewCount = mag(crew?.count);
    return {
      summary: summarise({
        profile,
        lifeSupport,
        stored,
        capacity,
        crew: crewCount,
      }),
      profile,
      lifeSupport,
      crew: crewCount,
    };
  },
});
