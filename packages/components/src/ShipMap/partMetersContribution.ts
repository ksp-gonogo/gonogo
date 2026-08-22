import { CORE_UPLINK_CLIENT } from "@ksp-gonogo/core";
import { buildResourcesByFlightId } from "@ksp-gonogo/data";
import type { VesselParts } from "@ksp-gonogo/sitrep-sdk";
import type { ShipMapPartMeterEntry } from "./shipTopology";

// ---------------------------------------------------------------------------
// The built-in half of the `ship-map.part-meters` self-contribution (spec
// §13.4, the framework's flagship demonstration): the five classic
// drainable propellants, moved off ShipDiagramSvg's old hardcoded `DRAINABLE`
// Set + `resourceColor` switch and onto the SAME contribution slot a
// Kerbalism-style Uplink contributes its own supply tanks to
// (`mod/GonogoKerbalismUplink/client/src/ShipMap/partMeters.ts`). ShipMap
// itself no longer knows which resource deserves a meter; that judgement
// call now lives entirely in contributions, this one included.
//
// Deliberately NOT widened to "every resource on every part": the deleted
// `DRAINABLE` comment's own reasoning still holds (a bar on every resource on
// every part is worse than bars on five well-chosen ones), it just now lives
// here instead of gating a hardcoded Set. A future contribution is free to
// add more resources; this one keeps the original five so the built-in
// behaviour is unchanged.
//
// Reads `vessel.parts` directly (the same Topic `usePartsLive`/`useTopology`
// already derive ShipMap's own view-model from) rather than a React hook:
// contributions are evaluated by the aggregator outside any component, so the
// pure `buildResourcesByFlightId` reshaping helper is shared instead of
// duplicated.
// ---------------------------------------------------------------------------

/**
 * The five classic drainable propellants this contribution watches. This names
 * which resources earn a meter and nothing more: the fill colour is the
 * resource's IDENTITY (`resourceColor(resource)`, derived by the renderer
 * straight from `resource`, not carried on this entry at all), so it is not a
 * colour choice, and `statusFor` below supplies
 * the SEPARATE, level-driven status signal that tone used to stand in for.
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
 *  Kerbalism contribution's own `DEFAULT_LOW_THRESHOLD` convention
 *  (`mod/GonogoKerbalismUplink/client/src/ShipMap/partMeters.ts`), kept
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

/**
 * Pure core of the built-in contribution, exported so a test can call it
 * directly against a plain `VesselParts` fixture without going through the
 * contribution registry at all (mirrors `spaceWeatherBadges`'s own
 * export-the-pure-core pattern in the Kerbalism Uplink).
 */
export function computeBuiltinPartMeters(
  wire: VesselParts | undefined,
): readonly ShipMapPartMeterEntry[] {
  if (!wire) return [];
  const byFlightId = buildResourcesByFlightId(wire);
  const entries: ShipMapPartMeterEntry[] = [];
  for (const [flightId, resources] of byFlightId) {
    for (const name of DRAINABLE_RESOURCES) {
      const slot = resources[name];
      if (!slot || slot.maxAmount <= 0) continue;
      entries.push({
        partId: String(flightId),
        resource: name,
        displayName: name,
        amount: slot.amount,
        capacity: slot.maxAmount,
        status: statusFor(slot.amount, slot.maxAmount),
      });
    }
  }
  return entries;
}

CORE_UPLINK_CLIENT.registerContribution({
  id: "ship-map-part-meters",
  contributes: "ship-map.part-meters",
  deps: ["vessel.parts"],
  compute: (topics) => computeBuiltinPartMeters(topics["vessel.parts"]),
});
