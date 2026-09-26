import { CORE_UPLINK_CLIENT } from "@ksp-gonogo/core";
import { buildResourcesByFlightId } from "@ksp-gonogo/data";
import {
  type Reading,
  type TopicReading,
  type Value,
  type VesselParts,
  value,
} from "@ksp-gonogo/sitrep-sdk";
import type { ShipMapPartMeterEntry } from "./shipTopology";

// The built-in half of the `ship-map.part-meters` self-contribution, and this
// repo's flagship demonstration of the pattern: the five classic drainable
// propellants, on the SAME contribution slot an Uplink contributes its own
// supply tanks to. ShipMap
// itself does not know which resource deserves a meter; that judgement call
// lives entirely in contributions, this one included.
//
// Deliberately NOT widened to "every resource on every part": a bar on every
// resource on every part is worse than bars on five well-chosen ones. A
// future contribution is free to add more resources; this one stays at the
// five.
//
// Reads `vessel.parts` (the same Topic `usePartsLive`/`useTopology` already
// derive ShipMap's own view-model from) through a processor, so each amount
// carries the currency of the reading it came from, rather than a React hook:
// contributions are evaluated by the aggregator outside any component, so the
// pure `buildResourcesByFlightId` reshaping helper is shared instead of
// duplicated.
// ---------------------------------------------------------------------------

/**
 * The five classic drainable propellants this contribution watches. This names
 * which resources earn a meter and nothing more: the fill colour is the
 * resource's IDENTITY (`resourceColor(resource)`, derived by the renderer
 * straight from `resource`, not carried on this entry at all), so it is not a
 * colour choice. `statusFor` below supplies the SEPARATE, level-driven status
 * signal.
 */
const DRAINABLE_RESOURCES = [
  "LiquidFuel",
  "Oxidizer",
  "SolidFuel",
  "MonoPropellant",
  "XenonGas",
] as const;

/** Ratio thresholds for the built-in five's status signal (a border tint or
 *  badge, never the fill hue): below this fraction of capacity the meter
 *  reads "low", below `CRITICAL_THRESHOLD` it reads "critical". Mirrors the
 *  default-low-threshold convention an Uplink contribution follows, kept
 *  local rather than shared: the two contributions live in different
 *  packages with no shared "ShipMap contribution helpers" module yet. */
const LOW_THRESHOLD = 0.15;
const CRITICAL_THRESHOLD = 0.05;

function statusFor(
  amount: number,
  capacity: number,
): "low" | "critical" | null {
  if (capacity <= 0) return null;
  const ratio = amount / capacity;
  if (ratio < CRITICAL_THRESHOLD) return "critical";
  if (ratio < LOW_THRESHOLD) return "low";
  return null;
}

/** A meter whose amount is the bare quantity read off the wire. */
type BareMeterEntry = ShipMapPartMeterEntry & { amount: Value<"units"> };

/**
 * Pure core of the built-in contribution, exported so a test can call it
 * directly against a plain `VesselParts` fixture without going through the
 * contribution registry at all (the same export-the-pure-core pattern the
 * Uplink-side contributions follow).
 */
export function computeBuiltinPartMeters(
  wire: VesselParts | undefined,
): readonly BareMeterEntry[] {
  if (!wire) return [];
  const byFlightId = buildResourcesByFlightId(wire);
  const entries: BareMeterEntry[] = [];
  for (const [flightId, resources] of byFlightId) {
    for (const name of DRAINABLE_RESOURCES) {
      const slot = resources[name];
      if (!slot || slot.maxAmount <= 0) continue;
      entries.push({
        partId: String(flightId),
        resource: name,
        displayName: name,
        amount: value("units", slot.amount),
        capacity: value("units", slot.maxAmount),
        status: statusFor(slot.amount, slot.maxAmount),
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
export function builtinPartMeterReadings(
  parts: Reading<VesselParts | undefined> | undefined,
): readonly ShipMapPartMeterEntry[] {
  if (parts?.state !== "observed" && parts?.state !== "stale") return [];
  return computeBuiltinPartMeters(parts.value).map((entry) => ({
    ...entry,
    amount: amountReading(parts, entry.amount),
  }));
}

/**
 * `vessel.parts` as a reading, since a contribution is handed a topic's
 * payload and never its currency.
 */
const VESSEL_PARTS_READING = CORE_UPLINK_CLIENT.registerProcessor({
  id: "ship-map-vessel-parts-reading",
  deps: [{ reading: "vessel.parts" }] as const,
  compute: ([parts]: readonly [TopicReading<VesselParts>]):
    | VesselParts
    | undefined =>
    parts.state === "observed" || parts.state === "stale"
      ? parts.value
      : undefined,
});

CORE_UPLINK_CLIENT.registerContribution({
  id: "ship-map-part-meters",
  contributes: "ship-map.part-meters",
  // `vessel.parts` stays a bare dep beside the reading: the bare id is what
  // subscribes the topic, and the processor only reads what is stored.
  deps: ["vessel.parts", VESSEL_PARTS_READING],
  compute: (topics) =>
    builtinPartMeterReadings(topics[VESSEL_PARTS_READING.id]),
});
