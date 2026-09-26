import { CORE_UPLINK_CLIENT } from "@ksp-gonogo/core";
import {
  CommsHopKind,
  type CommsNetwork,
  RosterCommsControlSource,
  Situation,
  type SystemBodies,
  type SystemVessels,
  type VesselRosterEntry,
  VesselType,
} from "@ksp-gonogo/sitrep-sdk";
import { magnitudeOf, magnitudeOr } from "@ksp-gonogo/ui-kit";
import { edgeEntityId } from "./commsPath";
import type {
  SystemEntity,
  SystemEntityMeta,
  SystemEntityPosition,
} from "./systemEntities";

/*
 * The built-in `system-view.entities` contribution, sole owner of the fleet and the CommNet relay graph: a graph node's `id` is a vessel's `vesselId`, so both must come off one roster read to stay in sync.
 * Vessels are deliberately unfiltered (debris, flags, EVA kerbals and science hardware all have real positions), and the active vessel is included; the host drops it.
 */

function bodyNameByIndex(
  bodies: SystemBodies | undefined,
): Map<number, string> {
  const m = new Map<number, string>();
  for (const b of bodies?.bodies ?? []) {
    if (b.name != null) m.set(b.index, b.name);
  }
  return m;
}

function commsLabel(
  source: RosterCommsControlSource | null | undefined,
): string {
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

/** Where an unnamed control source lands: `source` is `never`, so a new contract member is a type error, while a newer mod's ordinal still reads as unknown at runtime. */
function unnamedControlSource(_source: never): string {
  return "unknown";
}

function crewLabel(v: VesselRosterEntry): string {
  const count = magnitudeOf(v.crewCount);
  const capacity = magnitudeOf(v.crewCapacity);
  if (count == null) return "unknown";
  return capacity != null ? `${count}/${capacity}` : String(count);
}

/** Roster fields the info panel reads: name, type, situation, body, crew, comms. */
function metaFor(v: VesselRosterEntry, bodyName: string): SystemEntityMeta {
  return {
    name: v.name,
    type: VesselType[v.vesselType] ?? "Unknown",
    situation: Situation[v.situation] ?? "Unknown",
    body: bodyName,
    crew: crewLabel(v),
    comms: commsLabel(v.commsControlSource),
  };
}

/** Whether `v.orbit` has a finite, positive `sma`; shared by the vessel entities and the graph's node join. */
function hasUsableOrbit(v: VesselRosterEntry): boolean {
  const sma = magnitudeOf(v.orbit?.sma);
  return v.orbit != null && sma != null && sma > 0;
}

/** A vessel's position in `bodyName`'s frame: its Keplerian elements when usable, else a dot at the body without fabricated elements. */
function vesselPosition(
  v: VesselRosterEntry,
  bodyName: string,
): SystemEntityPosition {
  if (!hasUsableOrbit(v)) {
    return {
      kind: "fixed",
      parentName: bodyName,
      xMetres: 0,
      yMetres: 0,
      zMetres: 0,
    };
  }
  return {
    kind: "orbit",
    parentName: bodyName,
    sma: magnitudeOf(v.orbit?.sma) as number,
    ecc: magnitudeOr(v.orbit?.ecc, 0),
    lan: magnitudeOr(v.orbit?.lan, 0),
    argPe: magnitudeOr(v.orbit?.argPe, 0),
    inclination: magnitudeOr(v.orbit?.inc, 0),
    trueAnomaly: 0, // ignored by "orbit-path", which draws the whole ring
  };
}

/**
 * The fleet half of the contribution, exported for direct testing.
 * A usable orbit draws a faint full ring, no usable orbit degrades to a faint dot at the body, and an unresolvable body omits the vessel.
 */
export function computeVesselOrbitEntities(
  vessels: SystemVessels | undefined,
  bodies: SystemBodies | undefined,
): readonly SystemEntity[] {
  if (!vessels) return [];
  const nameByIndex = bodyNameByIndex(bodies);
  const entities: SystemEntity[] = [];

  for (const v of vessels.vessels) {
    const bodyName =
      v.bodyIndex != null ? (nameByIndex.get(v.bodyIndex) ?? null) : null;
    if (bodyName == null) continue;

    entities.push({
      id: `vessel-orbit:${v.vesselId}`,
      vesselId: v.vesselId,
      position: vesselPosition(v, bodyName),
      shape: hasUsableOrbit(v)
        ? { kind: "orbit-path" }
        : { kind: "point", radiusPx: 3 },
      style: { emphasis: "faint" },
      meta: metaFor(v, bodyName),
    });
  }

  return entities;
}

/** The body flagged `isHome`, or `null` when none is, which keeps the home edge omitted rather than placed at a guessed body. */
function homeBodyName(bodies: SystemBodies | undefined): string | null {
  for (const b of bodies?.bodies ?? []) {
    if (b.isHome === true && b.name != null) return b.name;
  }
  return null;
}

/** A graph node's projected position: the home station at the home body's centre, any other node through the matching vessel's `vesselPosition`; `null` when the join cannot be completed honestly. */
function resolveNodePosition(
  nodeId: string,
  isHomeNode: boolean,
  vesselsById: ReadonlyMap<string, VesselRosterEntry>,
  nameByIndex: ReadonlyMap<number, string>,
  homeName: string | null,
): SystemEntityPosition | null {
  if (isHomeNode) {
    return homeName
      ? {
          kind: "fixed",
          parentName: homeName,
          xMetres: 0,
          yMetres: 0,
          zMetres: 0,
        }
      : null;
  }
  const vessel = vesselsById.get(nodeId);
  if (!vessel) return null;
  const bodyName =
    vessel.bodyIndex != null
      ? (nameByIndex.get(vessel.bodyIndex) ?? null)
      : null;
  if (bodyName == null) return null;
  return vesselPosition(vessel, bodyName);
}

/** The CommNet half: one faint `connection-line` per `comms.network` edge, omitting any edge whose endpoint cannot be resolved; static topology only. */
export function computeCommsNetworkEntities(
  network: CommsNetwork | undefined,
  vessels: SystemVessels | undefined,
  bodies: SystemBodies | undefined,
): readonly SystemEntity[] {
  if (!network) return [];
  const nameByIndex = bodyNameByIndex(bodies);
  const homeName = homeBodyName(bodies);
  const vesselsById = new Map(
    (vessels?.vessels ?? []).map((v) => [v.vesselId, v] as const),
  );
  // Home is recognised by `kind`, with the literal `"home"` id as a fallback for a backend that leaves the kind unset.
  const homeNodeIds = new Set(
    network.nodes.filter((n) => n.kind === CommsHopKind.Home).map((n) => n.id),
  );
  homeNodeIds.add("home");

  const entities: SystemEntity[] = [];
  for (const edge of network.edges) {
    const from = resolveNodePosition(
      edge.a,
      homeNodeIds.has(edge.a),
      vesselsById,
      nameByIndex,
      homeName,
    );
    const to = resolveNodePosition(
      edge.b,
      homeNodeIds.has(edge.b),
      vesselsById,
      nameByIndex,
      homeName,
    );
    if (!from || !to) continue;

    entities.push({
      id: edgeEntityId(edge),
      position: from,
      shape: { kind: "connection-line", to },
      style: { emphasis: "faint" },
    });
  }
  return entities;
}

CORE_UPLINK_CLIENT.registerContribution({
  id: "system-view-vessel-orbits",
  contributes: "system-view.entities",
  deps: ["system.vessels", "system.bodies", "comms.network"],
  compute: (topics) => [
    ...computeVesselOrbitEntities(
      topics["system.vessels"],
      topics["system.bodies"],
    ),
    ...computeCommsNetworkEntities(
      topics["comms.network"],
      topics["system.vessels"],
      topics["system.bodies"],
    ),
  ],
});
