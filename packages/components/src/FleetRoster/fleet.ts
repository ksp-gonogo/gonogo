import {
  type CatalogEntry,
  combineReadings,
  type Reading,
  RosterCommsControlSource,
  stillTrue,
  type Value,
  VesselType,
  value,
} from "@ksp-gonogo/sitrep-sdk";
import { NULL_DISPLAY } from "@ksp-gonogo/ui-kit";
import { useMemo } from "react";
import { magnitudeOf } from "../shared/magnitude";
import { fleetRosterTopics } from "./topics";

// `trackingStation.catalog` is deliberately unfiltered (other consumers want asteroids and debris as targets), so this widget filters to craft client-side.

/** Real, flyable craft. Debris, space objects, EVA kerbals, flags and deployed hardware are not fleet vessels. */
const CRAFT_VESSEL_TYPES: ReadonlySet<VesselType> = new Set([
  VesselType.Ship,
  VesselType.Station,
  VesselType.Lander,
  VesselType.Probe,
  VesselType.Rover,
  VesselType.Base,
  VesselType.Relay,
]);

/** `Unknown` means the producer could not classify the vessel this tick, not that it is not a craft, so it stays on the roster. */
function isRosterCraft(vesselType: VesselType): boolean {
  return (
    vesselType === VesselType.Unknown || CRAFT_VESSEL_TYPES.has(vesselType)
  );
}

/** `"unknown"` is a null `commsControlSource` from the producer and must never be presented the same as a confirmed `"none"`. */
export type CommsLink = "connected" | "relay" | "none" | "unknown";

/** What the centre knows of its contact with a craft, as its catalog entry carries it. */
export type FleetContact = Pick<
  CatalogEntry,
  "contact" | "lastContactUt" | "expectedReturnUt" | "overdueAfterUt"
>;

export interface FleetVessel {
  /** Stable vessel id, the row key and the line-updates slot correlation key. */
  id: string;
  name: string;
  /** Body the vessel orbits/sits on, resolved via `system.bodies`; null when unresolved. */
  body: string | null;
  /** Kerbals aboard; null when the producer could not read it this tick (never a fabricated 0). */
  crewCount: number | null;
  /** Seat capacity; null under the same condition as `crewCount`. */
  crewCapacity: number | null;
  comms: CommsLink;
  contact: FleetContact;
}

function rosterCommsLink(
  source: RosterCommsControlSource | null | undefined,
): CommsLink {
  switch (source) {
    case RosterCommsControlSource.Full:
      return "connected";
    case RosterCommsControlSource.Partial:
      return "relay";
    case RosterCommsControlSource.None:
      return "none";
    case RosterCommsControlSource.Unknown:
    case null:
    case undefined:
      return "unknown";
    default:
      return unnamedControlSource(source);
  }
}

/** `source` is `never` here, so a new contract member is a type error; an ordinal from a newer mod still reads as unknown at runtime. */
function unnamedControlSource(_source: never): CommsLink {
  return "unknown";
}

/** A link that carries commands, which is what coverage counts; shared by the badge rollup and the coverage reading so they cannot disagree. */
export function isLinked(link: CommsLink): boolean {
  return link === "connected" || link === "relay";
}

/** A confirmed-no-other-vessels tombstone: a fleet, and it is empty. */
const EMPTY_FLEET = { entries: [] as never[] };

/** `trackingStation.catalog` to the widget's row shape. `known` separates "never delivered" from "delivered an empty fleet". */
export function useFleet(): {
  known: boolean;
  /** The roster's own reading, so a badge drawn from it can say it is held. */
  reading: ReturnType<
    typeof fleetRosterTopics.useTelemetry<"trackingStation.catalog">
  >;
  vessels: FleetVessel[];
  coverage: Reading<Value<"ratio">>;
} {
  // A held roster counts as known (vessels do not vanish with a missing frame), and a tombstone is a confirmed empty fleet, not a wait that never ends.
  const systemReading = fleetRosterTopics.useTelemetry(
    "trackingStation.catalog",
  );
  const system = stillTrue(systemReading, EMPTY_FLEET);
  // The body catalogue is a fact, and a tombstone for it would mean a save with no celestial bodies, which cannot happen; `undefined` is the honest answer there.
  const bodiesReading = fleetRosterTopics.useTelemetry("system.bodies");
  const bodies = stillTrue(bodiesReading, undefined);

  const nameByIndex = useMemo(() => {
    const m = new Map<number, string>();
    for (const b of bodies?.bodies ?? []) {
      if (b.name != null) m.set(b.index, b.name);
    }
    return m;
  }, [bodies]);

  const vessels = useMemo<FleetVessel[]>(
    () =>
      (system?.entries ?? [])
        .filter((v) => isRosterCraft(v.vesselType))
        .map((v) => ({
          id: v.vesselId,
          name: v.name,
          body:
            v.bodyIndex != null ? (nameByIndex.get(v.bodyIndex) ?? null) : null,
          crewCount: magnitudeOf(v.crewCount),
          crewCapacity: magnitudeOf(v.crewCapacity),
          comms: rosterCommsLink(v.commsControlSource),
          contact: {
            contact: v.contact,
            lastContactUt: v.lastContactUt,
            expectedReturnUt: v.expectedReturnUt,
            overdueAfterUt: v.overdueAfterUt,
          },
        })),
    [system, nameByIndex],
  );

  /** Comms coverage as a reading derived from the catalog alone, so it is exactly as current as the roster. */
  const coverage = useMemo(
    () =>
      combineReadings([systemReading.entries], (entries) => {
        // A craft whose link nobody has reported is neither covered nor uncovered, so it stays out of the count.
        const known = (entries ?? [])
          .filter((v) => isRosterCraft(v.vesselType))
          .map((v) => rosterCommsLink(v.commsControlSource))
          .filter((link) => link !== "unknown");
        const linked = known.filter(isLinked).length;
        // No craft with a known link has no coverage to state, which is not zero percent.
        if (known.length === 0) return undefined;
        return value("ratio", linked / known.length);
      }),
    [systemReading],
  );

  return {
    known: system !== undefined,
    reading: systemReading,
    vessels,
    coverage,
  };
}

export function crewLabel(v: FleetVessel): string {
  if (v.crewCount == null) return NULL_DISPLAY;
  if (v.crewCount === 0 && v.crewCapacity == null) return "0";
  if (v.crewCapacity != null) return `${v.crewCount}/${v.crewCapacity}`;
  return String(v.crewCount);
}
