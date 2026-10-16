import { CORE_UPLINK_CLIENT } from "@ksp-gonogo/core";
import {
  type CatalogEntry,
  CommsHopKind,
  type CommsNetwork,
  RosterCommsControlSource,
  Situation,
  type SystemBodies,
  stillTrue,
  type TopicPayload,
  type TrackingStationCatalog,
  VesselType,
} from "@ksp-gonogo/sitrep-sdk";
import { magnitudeOf, writeQuantity } from "@ksp-gonogo/ui-kit";
import { lastValue } from "../shared/drawnFrom";
import { edgeEntityId } from "./commsPath";
import type {
  SystemEntity,
  SystemEntityMeta,
  SystemEntityPosition,
} from "./systemEntities";

/*
 * The built-in `tracking-station.entities` contribution, sole owner of the fleet and the CommNet relay graph: a graph node's `id` is a vessel's `vesselId`, so both must come off one roster read to stay in sync.
 * Vessels are deliberately unfiltered (debris, flags, EVA kerbals and science hardware all have real positions), and the active vessel is included; the host drops it.
 */

function bodyNameByIndex(
  bodies: SystemBodies | null | undefined,
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

function crewLabel(v: CatalogEntry): string {
  const count = magnitudeOf(v.crewCount);
  const capacity = magnitudeOf(v.crewCapacity);
  if (count == null) return "unknown";
  return capacity != null ? `${count}/${capacity}` : String(count);
}

/** Whether the craft rests on its body: landed, splashed or pre-launch, the situations that have a place on the surface and no orbit worth drawing. */
function isOnGround(v: CatalogEntry): boolean {
  return (
    v.situation === Situation.Landed ||
    v.situation === Situation.Splashed ||
    v.situation === Situation.PreLaunch
  );
}

/** A surface position as signed degrees, such as `-0.05° -74.72°`; null unless both coordinates were read. */
function coordinatesLabel(v: CatalogEntry): string | null {
  if (v.latitude == null || v.longitude == null) return null;
  const lat = writeQuantity(v.latitude, { decimals: 2 });
  const lon = writeQuantity(v.longitude, { decimals: 2 });
  return `${lat} ${lon}`;
}

/** Where a craft is, in the words that tell two same-named craft apart: its site, else its coordinates, else its situation. */
function placeLabel(v: CatalogEntry): string {
  if (!isOnGround(v)) return Situation[v.situation] ?? "Unknown";
  return (
    v.landedAt ?? coordinatesLabel(v) ?? Situation[v.situation] ?? "Unknown"
  );
}

/**
 * The name a craft is shown under: its own, and where it is when another craft in the roster has the same one, so five craft called "Sally-Hut 1" read as five.
 */
function displayName(
  v: CatalogEntry,
  sharedNames: ReadonlySet<string>,
): string {
  return sharedNames.has(v.name) ? `${v.name} · ${placeLabel(v)}` : v.name;
}

/** Names that more than one roster vessel carries. */
function namesInUseTwice(vessels: readonly CatalogEntry[]): Set<string> {
  const seen = new Set<string>();
  const twice = new Set<string>();
  for (const v of vessels) {
    if (seen.has(v.name)) twice.add(v.name);
    seen.add(v.name);
  }
  return twice;
}

/** Roster fields the info panel reads: name, type, situation, body, site and position for a craft on the ground, crew, comms. */
function metaFor(
  v: CatalogEntry,
  bodyName: string,
  sharedNames: ReadonlySet<string>,
): SystemEntityMeta {
  const position = isOnGround(v) ? coordinatesLabel(v) : null;
  return {
    name: displayName(v, sharedNames),
    type: VesselType[v.vesselType] ?? "Unknown",
    situation: Situation[v.situation] ?? "Unknown",
    body: bodyName,
    ...(isOnGround(v) && v.landedAt != null ? { site: v.landedAt } : {}),
    ...(position !== null ? { position } : {}),
    crew: crewLabel(v),
    comms: commsLabel(v.commsControlSource),
  };
}

interface ConicElements {
  sma: number;
  ecc: number;
  lan: number;
  argPe: number;
  inclination: number;
}

/** Where on the ring the craft was, when the roster read both; without them the ring has no marked place. */
interface RingPlace {
  epoch: number;
  meanAnomalyAtEpoch: number;
}

export function ringPlace(v: CatalogEntry): RingPlace | null {
  const epoch = v.orbit?.epoch;
  const meanAnomalyAtEpoch = v.orbit?.meanAnomalyAtEpoch;
  if (!epoch?.isFinite() || !meanAnomalyAtEpoch?.isFinite()) return null;
  // The published entity position states plain numbers, in seconds and radians.
  return {
    epoch: epoch.valueOf(),
    meanAnomalyAtEpoch: meanAnomalyAtEpoch.valueOf(),
  };
}

/**
 * Every element a vessel's path needs, or `null` when any is unread or the
 * size and shape do not make an orbit: a closed one needs a positive `sma`, an
 * open one (`ecc` above 1) any `sma` but zero, and a parabolic one has none.
 * Shared by the vessel entities and the graph's node join. An unreported
 * element is not a zero, and a path drawn from a guessed one is a confident
 * wrong orbit.
 */
export function conicElements(v: CatalogEntry): ConicElements | null {
  const sma = magnitudeOf(v.orbit?.sma);
  const ecc = magnitudeOf(v.orbit?.ecc);
  const lan = magnitudeOf(v.orbit?.lan);
  const argPe = magnitudeOf(v.orbit?.argPe);
  const inclination = magnitudeOf(v.orbit?.inc);
  if (sma == null || ecc == null) return null;
  const drawable = ecc > 1 ? sma !== 0 : ecc < 1 && sma > 0;
  if (!drawable) return null;
  if (lan == null || argPe == null || inclination == null) {
    return null;
  }
  return { sma, ecc, lan, argPe, inclination };
}

/**
 * A vessel's position in `bodyName`'s frame: its Keplerian elements when all are read, else a dot at the body without fabricated elements.
 * A craft on the ground is a dot at its body whatever the roster's orbit says: the game still reports an ellipse for it, one that runs through the planet.
 */
function vesselPosition(
  v: CatalogEntry,
  bodyName: string,
): SystemEntityPosition {
  const elements = isOnGround(v) ? null : conicElements(v);
  const place = ringPlace(v);
  if (!elements) {
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
    ...elements,
    ...place,
  };
}

/**
 * The fleet half of the contribution, exported for direct testing.
 * A fully read orbit draws a faint full ring, anything less degrades to a faint dot at the body, and an unresolvable body omits the vessel.
 */
export function computeVesselOrbitEntities(
  vessels: TrackingStationCatalog | null | undefined,
  bodies: SystemBodies | null | undefined,
): readonly SystemEntity[] {
  if (!vessels) return [];
  const nameByIndex = bodyNameByIndex(bodies);
  const sharedNames = namesInUseTwice(vessels.entries);
  const entities: SystemEntity[] = [];

  for (const v of vessels.entries) {
    const bodyName =
      v.bodyIndex != null ? (nameByIndex.get(v.bodyIndex) ?? null) : null;
    if (bodyName == null) continue;

    const elements = isOnGround(v) ? null : conicElements(v);
    entities.push({
      id: `vessel-orbit:${v.vesselId}`,
      vesselId: v.vesselId,
      position: vesselPosition(v, bodyName),
      shape: elements ? { kind: "orbit-path" } : { kind: "point", radiusPx: 3 },
      style: { emphasis: "faint" },
      meta: metaFor(v, bodyName, sharedNames),
    });
  }

  return entities;
}

/**
 * The flown craft as a catalog entity, built from its own `vessel.identity`
 * and `vessel.orbit`, for a centre whose catalog does not list it yet. Crew
 * and comms read as unknown, since the craft's own report does not carry
 * them; everything else is placed and labelled exactly as a catalog entry
 * would be. Null without an identity or a resolvable body.
 */
export function flownCraftEntity(
  identity: TopicPayload<"vessel.identity"> | undefined,
  orbit: TopicPayload<"vessel.orbit"> | undefined,
  bodies: SystemBodies | null | undefined,
): SystemEntity | null {
  if (identity == null) return null;
  const entry: CatalogEntry = {
    vesselId: identity.vesselId,
    name: identity.name,
    vesselType: identity.vesselType,
    situation: identity.situation,
    bodyIndex: identity.parentBodyIndex,
    orbit:
      orbit == null
        ? null
        : {
            sma: orbit.sma,
            ecc: orbit.ecc,
            inc: orbit.inc,
            lan: orbit.lan,
            argPe: orbit.argPe,
            meanAnomalyAtEpoch: orbit.meanAnomalyAtEpoch,
            epoch: orbit.epoch,
          },
  };
  return computeVesselOrbitEntities({ entries: [entry] }, bodies)[0] ?? null;
}

/** The body flagged `isHome`, or `null` when none is, which keeps the home edge omitted rather than placed at a guessed body. */
function homeBodyName(bodies: SystemBodies | null | undefined): string | null {
  for (const b of bodies?.bodies ?? []) {
    if (b.isHome === true && b.name != null) return b.name;
  }
  return null;
}

/** A graph node's projected position: the home station at the home body's centre, any other node through the matching vessel's `vesselPosition`; `null` when the join cannot be completed honestly. */
function resolveNodePosition(
  nodeId: string,
  isHomeNode: boolean,
  vesselsById: ReadonlyMap<string, CatalogEntry>,
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
  network: CommsNetwork | null | undefined,
  vessels: TrackingStationCatalog | null | undefined,
  bodies: SystemBodies | null | undefined,
): readonly SystemEntity[] {
  if (!network) return [];
  const nameByIndex = bodyNameByIndex(bodies);
  const homeName = homeBodyName(bodies);
  const vesselsById = new Map(
    (vessels?.entries ?? []).map((v) => [v.vesselId, v] as const),
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

/** The entities, marked held where a reading they were placed from is held; the body catalogue names places and so never marks one. */
function heldWhere(
  entities: readonly SystemEntity[],
  held: boolean,
): readonly SystemEntity[] {
  return held
    ? entities.map((entity) => ({ ...entity, currency: "held" as const }))
    : entities;
}

CORE_UPLINK_CLIENT.registerContribution({
  id: "tracking-station-vessel-orbits",
  contributes: "tracking-station.entities",
  deps: ["trackingStation.catalog", "trackingStation.bodies", "comms.network"],
  compute: (topics) => {
    const vesselsReading = topics["trackingStation.catalog"];
    const networkReading = topics["comms.network"];
    const vessels = lastValue(vesselsReading);
    const bodies = stillTrue(topics["trackingStation.bodies"], null);
    const vesselsHeld = vesselsReading.state === "held";
    return [
      ...heldWhere(computeVesselOrbitEntities(vessels, bodies), vesselsHeld),
      ...heldWhere(
        computeCommsNetworkEntities(lastValue(networkReading), vessels, bodies),
        vesselsHeld || networkReading.state === "held",
      ),
    ];
  },
});
