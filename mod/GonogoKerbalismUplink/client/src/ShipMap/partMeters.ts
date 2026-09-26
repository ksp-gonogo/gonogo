import {
  type ContributionEntry,
  value as quantity,
  type Reading,
  type TopicReading,
  type Value,
  type VesselParts,
} from "@ksp-gonogo/sitrep-sdk";
import { magnitudeOf, magnitudeOr, type Quantityish } from "@ksp-gonogo/ui-kit";
import type { KerbalismProfile } from "../__generated__/contract";
import { resourceFacts } from "../ecosystem";
import { KERBALISM } from "../uplink";

// The Kerbalism half of the `ship-map.part-meters` self-contribution:
// supply-tank resources this
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
 * Status signal for a resource meter, SEPARATE from its fill colour: the fill is
 * the resource's IDENTITY, derived by the renderer via
 * `resourceColor(resource)` and never carried on this entry. This returns only
 * the level, which a border tint or a badge draws.
 */
function partMeterStatus(
  amount: number,
  capacity: number,
  lowThreshold: Quantityish,
): "low" | "critical" | null {
  if (capacity <= 0) return null;
  const low =
    lowThreshold === undefined
      ? DEFAULT_LOW_THRESHOLD
      : magnitudeOr(lowThreshold, DEFAULT_LOW_THRESHOLD);
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
      if (!fact?.isSupply || fact.pooled !== false) continue;
      const capacity = magnitudeOr(flow.maxAmount, 0);
      if (capacity <= 0) continue;
      // No amount reported is not an empty tank: a meter drawn from it would
      // read as a part in deficit. Skipped, so nothing is claimed.
      const amount = magnitudeOf(flow.amount);
      if (amount === null) continue;
      entries.push({
        partId: String(part.id),
        resource: name,
        displayName: fact.displayName,
        amount: quantity("units", amount),
        capacity: quantity("units", capacity),
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

/**
 * One tank's amount on the arm the parts reading it came from arrived on, so
 * ShipMap can mark a held level rather than draw it as the tank now.
 */
function amountReading(
  parts: Reading<VesselParts | undefined>,
  amount: Value<"units">,
): Reading<Value<"units">> {
  if (parts.state === "observed") {
    return {
      state: "observed",
      value: amount,
      atUt: parts.atUt,
      reckoning: { status: "none" },
    };
  }
  if (parts.state === "stale") {
    return {
      state: "stale",
      value: amount,
      asOfUt: parts.asOfUt,
      grade: parts.grade,
      reckoning: { status: "none" },
    };
  }
  return { state: parts.state, reckoning: { status: "none" } };
}

/**
 * The meters with each amount carrying the currency of the `vessel.parts`
 * reading it was read from. A level that has stopped arriving is still the
 * last one there was, so it is drawn, and marked.
 */
export function kerbalismPartMeterReadings(
  parts: Reading<VesselParts | undefined> | undefined,
  profile: KerbalismProfile | undefined,
): PartMeterEntry[] {
  if (parts?.state !== "observed" && parts?.state !== "stale") return [];
  return computeKerbalismPartMeters(parts.value, profile).map((entry) => ({
    ...entry,
    amount:
      "state" in entry.amount
        ? entry.amount
        : amountReading(parts, entry.amount),
  }));
}

/**
 * `kerbalism:vessel-parts-reading`. `vessel.parts` as a reading, since a
 * contribution is handed a topic's payload and never its currency.
 */
const VESSEL_PARTS_READING = KERBALISM.registerProcessor({
  id: "vessel-parts-reading",
  deps: [{ reading: "vessel.parts" }] as const,
  compute: ([parts]: readonly [TopicReading<VesselParts>]):
    | VesselParts
    | undefined =>
    parts.state === "observed" || parts.state === "stale"
      ? parts.value
      : undefined,
});

KERBALISM.registerContribution({
  id: "ship-map-part-meters",
  contributes: "ship-map.part-meters",
  // `vessel.parts` stays a bare dep beside the reading: the bare id is what
  // subscribes the topic, and the processor only reads what is stored.
  deps: ["vessel.parts", VESSEL_PARTS_READING, "kerbalism.profile"],
  requires: "kerbalism",
  compute: (topics) =>
    kerbalismPartMeterReadings(
      topics[VESSEL_PARTS_READING.id],
      topics["kerbalism.profile"],
    ),
});
