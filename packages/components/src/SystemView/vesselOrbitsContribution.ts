import { CORE_UPLINK_CLIENT } from "@ksp-gonogo/core";
import {
  RosterCommsControlSource,
  Situation,
  type SystemBodies,
  type SystemVessels,
  type VesselRosterEntry,
  VesselType,
} from "@ksp-gonogo/sitrep-sdk";
import { magnitudeOf, magnitudeOr } from "@ksp-gonogo/ui-kit";
import type { SystemEntity, SystemEntityMeta } from "./systemEntities";

// ---------------------------------------------------------------------------
// The built-in `system-view.entities` contribution for Task 3: every vessel
// on `system.vessels` (the same roster FleetRoster reads) drawn as a faint
// orbit ring around its body, using the SAME projection/colour primitives
// `systemEntities.ts` already built for the diagram's own bodies (Task 2).
//
// Deliberately UNFILTERED, unlike FleetRoster's `isRosterCraft`: the roster
// carries debris, asteroids/comets, planted flags, EVA kerbals, and deployed
// science hardware alongside real craft, and every one of them has a real
// orbit (or a real landed position) worth showing on the system diagram.
// FleetRoster's craft-only filter answers "what do I fly"; this contribution
// answers "what's actually out there", a different question with a wider
// answer.
//
// Includes the active/framed vessel too: this contribution has no notion of
// "active", it's static data computed from `system.vessels` alone. Excluding
// the active vessel's own entity from the render is host-side state (which
// vessel is framed), and belongs in `index.tsx`, which drops the entity whose
// `vesselId` matches `vessel.identity` before handing entities to
// `SystemEntitiesLayer`: `SystemDiagram` already draws that vessel's own
// bright ring, so a contributed faint one would sit duplicated on top of it.
// ---------------------------------------------------------------------------

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
    default:
      return "unknown";
  }
}

function crewLabel(v: VesselRosterEntry): string {
  const count = magnitudeOf(v.crewCount);
  const capacity = magnitudeOf(v.crewCapacity);
  if (count == null) return "unknown";
  return capacity != null ? `${count}/${capacity}` : String(count);
}

/** Roster fields carried for the future info panel (task-3-brief: name, type, situation, body, crew, comms). */
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

/**
 * Pure core of the contribution, exported so a test can call it directly
 * against plain `SystemVessels`/`SystemBodies` fixtures (mirrors
 * `partMetersContribution.ts`'s own `computeBuiltinPartMeters` pattern).
 *
 * A vessel with a usable orbit (`orbit.sma` present, finite, positive) draws
 * the full ring, faint, via `orbitEllipseGeometry`/`projectOrbitRing` (same
 * conic math and colour rules a body's own orbit ring uses). A vessel with no
 * usable orbit (landed/splashed/pre-launch, or a producer that simply hasn't
 * read one yet) but a resolved body degrades to a faint dot AT that body:
 * `xMetres: 0, yMetres: 0` in the body's own frame, honestly "this vessel is
 * here" without fabricating orbital elements it doesn't have. A vessel whose
 * body can't be resolved at all (no `bodyIndex`, or an index `system.bodies`
 * hasn't caught up on) is omitted outright, the same "no data" honesty.
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

    const sma = magnitudeOf(v.orbit?.sma);
    const hasOrbit = v.orbit != null && sma != null && sma > 0;

    entities.push({
      id: `vessel-orbit:${v.vesselId}`,
      vesselId: v.vesselId,
      position: hasOrbit
        ? {
            kind: "orbit",
            parentName: bodyName,
            sma: sma as number,
            ecc: magnitudeOr(v.orbit?.ecc, 0),
            lan: magnitudeOr(v.orbit?.lan, 0),
            argPe: magnitudeOr(v.orbit?.argPe, 0),
            trueAnomaly: 0, // ignored by "orbit-path", which draws the whole ring
          }
        : { kind: "fixed", parentName: bodyName, xMetres: 0, yMetres: 0 },
      shape: hasOrbit ? { kind: "orbit-path" } : { kind: "point", radiusPx: 3 },
      style: { emphasis: "faint" },
      meta: metaFor(v, bodyName),
    });
  }

  return entities;
}

CORE_UPLINK_CLIENT.registerContribution({
  id: "system-view-vessel-orbits",
  contributes: "system-view.entities",
  deps: ["system.vessels", "system.bodies"],
  compute: (topics) =>
    computeVesselOrbitEntities(
      topics["system.vessels"],
      topics["system.bodies"],
    ),
});
