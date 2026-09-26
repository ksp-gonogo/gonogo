import {
  TargetKind,
  type TargetListEntry,
  VesselType,
} from "@ksp-gonogo/sitrep-sdk";
import { magnitudeOf } from "../shared/magnitude";

/**
 * `Sitrep.Contract.VesselType`'s C# declared order: ordinal to display label
 * for a `target.available` entry's `vesselType`. Alignment with the SDK enum is
 * locked by `enumLabelDrift.test.ts`.
 */
export const VESSEL_TYPE_LABELS: readonly string[] = [
  "Ship",
  "Station",
  "Lander",
  "Probe",
  "Rover",
  "Base",
  "Relay",
  "EVA",
  "Flag",
  "Debris",
  "SpaceObject",
  "DeployedScienceController",
  "DeployedSciencePart",
  "DroppedPart",
  "Unknown",
];

/** Derived from the generated SDK enum, so it tracks the C# declaration order. */
export const SPACE_OBJECT_VESSEL_TYPE = VesselType.SpaceObject;

/** `Sitrep.Contract.Situation`'s C# declared order: ordinal to label, locked by `enumLabelDrift.test.ts`. */
export const SITUATION_LABELS: readonly string[] = [
  "Landed",
  "Splashed",
  "Pre-Launch",
  "Orbiting",
  "Escaping",
  "Flying",
  "Sub-Orbital",
  "Docked",
  "Unknown",
];

/** Stable per-entry id, the pending-spinner key and React key, baked from the id `vessel.target.set` takes. */
export function entryId(entry: TargetListEntry): string {
  switch (entry.kind) {
    case TargetKind.Body:
      return `body:${entry.bodyIndex}`;
    case TargetKind.Vessel:
      return `vessel:${entry.vesselId}`;
    case TargetKind.Part:
      return `part:${entry.vesselId}:${entry.partId}`;
    default:
      return `other:${entry.name}`;
  }
}

/** Type and situation subtitle for a Vessel/Part row; `null` for a Body or when neither resolves. */
export function entrySubtitle(entry: TargetListEntry): string | null {
  if (entry.kind !== TargetKind.Vessel && entry.kind !== TargetKind.Part) {
    return null;
  }
  // `!= null`: an unclassified entry arrives as an explicit null.
  const type =
    entry.vesselType != null ? VESSEL_TYPE_LABELS[entry.vesselType] : undefined;
  const situation =
    entry.situation != null ? SITUATION_LABELS[entry.situation] : undefined;
  const parts = [type, situation].filter((v): v is string => Boolean(v));
  return parts.length > 0 ? parts.join(" · ") : null;
}

/** Ascending by `distance`, undefined last. */
export function sortByDistance(
  list: readonly TargetListEntry[],
): TargetListEntry[] {
  return [...list].sort((a, b) => {
    const da = magnitudeOf(a.distance) ?? Number.POSITIVE_INFINITY;
    const db = magnitudeOf(b.distance) ?? Number.POSITIVE_INFINITY;
    return da - db;
  });
}

/** The `vessel.target.set` arguments for an entry, or `null` when it carries no id to set by. */
export function targetArgsFor(entry: TargetListEntry) {
  if (entry.kind === TargetKind.Body) {
    // A null index is a refusal: never command the craft on a guess.
    if (typeof entry.bodyIndex !== "number") return null;
    return { kind: TargetKind.Body, bodyIndex: entry.bodyIndex } as const;
  }
  if (entry.kind === TargetKind.Vessel) {
    if (!entry.vesselId) return null;
    return { kind: TargetKind.Vessel, vesselId: entry.vesselId } as const;
  }
  if (entry.kind === TargetKind.Part) {
    // `== null`: an unidentified part arrives as an explicit null.
    if (!entry.vesselId || entry.partId == null) return null;
    return {
      kind: TargetKind.Part,
      vesselId: entry.vesselId,
      partId: entry.partId,
    } as const;
  }
  // An `Other`-kind entry has no id-based set command, so a click is intentionally a no-op.
  return null;
}
