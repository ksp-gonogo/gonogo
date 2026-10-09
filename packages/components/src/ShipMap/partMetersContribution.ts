import { CORE_UPLINK_CLIENT } from "@ksp-gonogo/core";
import { buildResourcesByFlightId } from "@ksp-gonogo/data";
import {
  type Reading,
  type TopicCurrency,
  type Value,
  type VesselParts,
  value,
} from "@ksp-gonogo/sitrep-sdk";
import type { ShipMapPartMeterEntry } from "./shipTopology";

/*
 * The built-in `ship-map.part-meters` contribution: the five classic drainable
 * propellants, on the same slot an Uplink contributes its supply tanks to.
 * ShipMap itself does not decide which resource earns a meter. Five
 * well-chosen bars beat a bar on every resource. Each amount carries the
 * currency of the `vessel.parts` reading it came from.
 */

/** The five drainable propellants that earn a meter. The fill colour is the resource's identity, derived by the renderer. */
const DRAINABLE_RESOURCES = [
  "LiquidFuel",
  "Oxidizer",
  "SolidFuel",
  "MonoPropellant",
  "XenonGas",
] as const;

/** Status thresholds as a fraction of capacity: below LOW reads "low", below CRITICAL "critical". */
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

/** A meter whose amount and capacity are the bare quantities read off the wire. */
type BareMeterEntry = ShipMapPartMeterEntry & {
  amount: Value<"units">;
  capacity: Value<"units">;
};

/** Pure core of the built-in contribution, exported so a test can call it against a plain `VesselParts` fixture. */
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
 * One tank's amount or capacity on the arm the parts reading it came from
 * arrived on, so ShipMap can mark a held figure rather than draw it as the
 * tank now.
 */
function figureReading(
  parts: TopicCurrency<VesselParts>,
  figure: Value<"units">,
): Reading<Value<"units">> {
  if (parts.state === "observed") {
    return {
      state: "observed",
      value: figure,
      atUt: parts.atUt,
      reckoning: { status: "none" },
    };
  }
  if (parts.state === "held") {
    return {
      state: "held",
      value: figure,
      asOfUt: parts.asOfUt,
      grade: parts.grade,
      reckoning: { status: "none" },
    };
  }
  return { state: parts.state, reckoning: { status: "none" } };
}

/**
 * The meters with each amount and capacity carrying the currency of the
 * `vessel.parts` reading. Both come off the one stream, so they go held
 * together; a level that stopped arriving is still drawn, and marked.
 */
export function builtinPartMeterReadings(
  parts: TopicCurrency<VesselParts>,
): readonly ShipMapPartMeterEntry[] {
  if (parts.state !== "observed" && parts.state !== "held") return [];
  return computeBuiltinPartMeters(parts.value).map((entry) => ({
    ...entry,
    amount: figureReading(parts, entry.amount),
    capacity: figureReading(parts, entry.capacity),
  }));
}

CORE_UPLINK_CLIENT.registerContribution({
  id: "ship-map-part-meters",
  contributes: "ship-map.part-meters",
  deps: ["vessel.parts"],
  compute: (topics) => builtinPartMeterReadings(topics["vessel.parts"]),
});
