import type {
  ContributionEntry,
  KerbalismProfile,
  VesselParts,
} from "@ksp-gonogo/sitrep-sdk";
import { mag, resourceFacts } from "../ecosystem";
import { KERBALISM } from "../uplink";

// ---------------------------------------------------------------------------
// The Kerbalism half of the `ship-map.part-meters` self-contribution (spec
// §13.4, the framework's flagship demonstration): supply-tank resources this
// vessel carries, on the SAME slot the built-in `core` contribution feeds
// its five classic drainable propellants into
// (`packages/components/src/ShipMap/partMetersContribution.ts`). ShipMap
// itself has no idea which of these two contributed the entries it renders,
// and doesn't need to.
//
// Reads `vessel.parts` directly, the same per-part resource stock the
// built-in contribution reads (Kerbalism resources like Water/Food/Oxygen
// are ordinary KSP PartResources, just added by the mod: there is no
// separate "Kerbalism resource" Topic to read instead). `kerbalism.profile`
// supplies the naming/classification `resourceFacts()` already derives for
// the Ship Systems widget: which names are a declared Supply, and whether
// they pool across the whole vessel rather than living on one part.
//
// HONESTY GATE (see `ResourceFacts.pooled`'s own doc comment in
// `ecosystem.ts`): a resource only earns a per-part meter here when
// `pooled === false`, a CONFIRMED per-part reading. `pooled === undefined`
// (the mod hasn't captured `flowMode` for this resource) is treated the
// same as `pooled === true`: skipped, never rendered. Claiming a per-part
// bar for a resource that might actually be a vessel-wide pool would be
// worse than showing nothing. This is real debt, not a hypothetical: as of
// this pass `flowMode` capture is unverified against a live KSP session
// (see the mod's own capture backlog), so today's render may show FEWER
// Kerbalism meters than the profile's supply list would suggest until
// that's confirmed live.
// ---------------------------------------------------------------------------

type PartMeterEntry = ContributionEntry<"ship-map.part-meters">;

/** Default "low" fraction when the profile declares no `lowThreshold` for a
 *  resource: mirrors the stock game's own convention, never invented to
 *  replace a threshold the profile DOES declare (ecosystem.ts's own rule:
 *  a widget must not invent a threshold for a resource whose mod ships
 *  one). */
const DEFAULT_LOW_THRESHOLD = 0.15;

/** "critical" sits at a fixed fraction of whichever "low" threshold applies
 *  (the profile's own `lowThreshold`, or `DEFAULT_LOW_THRESHOLD`), rather
 *  than a second independently-configured number: Kerbalism profiles only
 *  ever declare ONE per-resource threshold, so critical stays derived, not
 *  another value this contribution would have to invent. */
const CRITICAL_FRACTION_OF_LOW = 0.33;

/**
 * Status signal for a resource meter, SEPARATE from its fill colour (the
 * design doc, `local_docs/design/2026-08-08-resource-colour-system.md`,
 * gonogo main repo: the fill is the resource's IDENTITY, derived by the
 * renderer via `resourceColor(resource)`, never carried on this entry).
 * Used to return a `MeterTone` that doubled as the fill colour ("warn" /
 * "neutral"); now returns only the level, a border tint or badge draws it.
 */
function partMeterStatus(
  amount: number,
  capacity: number,
  lowThreshold: { magnitude?: number } | number | undefined,
): "low" | "critical" | null {
  if (capacity <= 0) return null;
  const low =
    lowThreshold === undefined
      ? DEFAULT_LOW_THRESHOLD
      : mag(lowThreshold, DEFAULT_LOW_THRESHOLD);
  const ratio = amount / capacity;
  if (ratio < low * CRITICAL_FRACTION_OF_LOW) return "critical";
  if (ratio < low) return "low";
  return null;
}

/**
 * Pure core of the Kerbalism contribution, exported so a test can call it
 * directly against plain `VesselParts` + `KerbalismProfile` fixtures without
 * going through the contribution registry (mirrors `spaceWeatherBadges`'s
 * export-the-pure-core pattern).
 */
export function computeKerbalismPartMeters(
  wire: VesselParts | undefined,
  profile: KerbalismProfile | undefined,
): PartMeterEntry[] {
  if (!wire || !profile) return [];
  const facts = resourceFacts(profile);
  const entries: PartMeterEntry[] = [];
  for (const part of wire.parts) {
    for (const [name, flow] of Object.entries(part.resources)) {
      const fact = facts.get(name);
      // Supply-only, confirmed-not-pooled: see this file's header.
      if (!fact || !fact.isSupply || fact.pooled !== false) continue;
      const capacity = mag(flow.maxAmount);
      if (capacity <= 0) continue;
      const amount = mag(flow.amount);
      entries.push({
        partId: String(part.id),
        resource: name,
        displayName: fact.displayName,
        amount,
        capacity,
        status: partMeterStatus(
          amount,
          capacity,
          profile.resources?.[name]?.lowThreshold,
        ),
      });
    }
  }
  return entries;
}

KERBALISM.registerContribution({
  id: "ship-map-part-meters",
  contributes: "ship-map.part-meters",
  deps: ["vessel.parts", "kerbalism.profile"],
  requires: "kerbalism",
  compute: (topics) =>
    computeKerbalismPartMeters(
      topics["vessel.parts"] as VesselParts | undefined,
      topics["kerbalism.profile"] as KerbalismProfile | undefined,
    ),
});
