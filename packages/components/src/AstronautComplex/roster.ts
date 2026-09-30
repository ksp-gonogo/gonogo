import {
  CREW_STANDING_ORDER,
  CrewStanding,
  crewStandingFromRosterStatus,
  crewStandingLabel,
} from "@ksp-gonogo/sitrep-sdk";
import type { KerbalStatFields } from "../shared/KerbalStats";
import { asQuantityish, magnitudeOf } from "../shared/magnitude";

export interface ApplicantRow {
  name: string;
  trait: string;
  /** Retained from the wire and withheld from display; `null` when the pool quoted none. */
  experienceLevel: number | null;
  courage: number | null;
  stupidity: number | null;
  roleDescription: string;
  descriptionEffects: string;
}

/** An applicant's fields; the stats that do not apply to someone not yet hired take their safe zero, and rank is withheld from display. */
export function applicantStats(a: ApplicantRow): KerbalStatFields {
  return {
    name: a.name,
    trait: a.trait,
    experienceLevel: a.experienceLevel,
    veteran: false,
    isBadass: false,
    careerFlights: 0,
    available: true,
    unavailableReason: "",
    // Never rendered while available is true; the pool's implicit standing.
    situation: "Applicant",
    standing: CrewStanding.Applicant,
    // An applicant has no RosterStatus: null is the fact, not a missing read.
    situationOrdinal: null,
    currentVesselName: "",
    courage: a.courage,
    stupidity: a.stupidity,
    roleDescription: a.roleDescription,
    descriptionEffects: a.descriptionEffects,
  };
}

/** One row from `spaceCenter.crewRoster`, the hired-crew roster. */
export interface CrewRosterRow {
  name: string;
  trait: string;
  /** Rank; `null` when none was carried, which renders as a dash rather than rank zero. */
  experienceLevel: number | null;
  /** Display label only, for a row whose {@link standing} this build cannot name. */
  situation: string;
  /** `CrewStanding`: the field every decision reads and the Active tab's grouping key; `null` when none was sent. */
  standing: number | null;
  /** KSP's own `RosterStatus` ordinal, carried and never branched on: it reads `Available` for a kerbal standing down. */
  situationOrdinal: number | null;
  /** `ProtoCrewMember.inactive`, an input to the producer's `Resting` standing; never branched on here. */
  inactive: boolean;
  inactiveUntilUt: number | null;
  /** When the kerbal's unavailability lapses, as universal time; absent when there is no scheduled end. */
  standingEndsAtUt: number | null;
  /** Whether the row is a hireable candidate rather than owned crew. */
  isApplicant: boolean;
  available: boolean;
  unavailableReason: string;
  courage: number | null;
  stupidity: number | null;
  experienceLevelDelta: number | null;
  roleDescription: string;
  descriptionEffects: string;
}

/** Badges not on the wire take their safe zero, as {@link applicantStats} does. */
export function crewRowStats(c: CrewRosterRow): KerbalStatFields {
  return {
    name: c.name,
    trait: c.trait,
    experienceLevel: c.experienceLevel,
    veteran: false,
    isBadass: false,
    careerFlights: 0,
    available: c.available,
    unavailableReason: c.unavailableReason,
    situation: standingLabelOf(c),
    standing: c.standing,
    situationOrdinal: c.situationOrdinal,
    standingEndsAtUt: c.standingEndsAtUt,
    currentVesselName: "",
    courage: c.courage,
    stupidity: c.stupidity,
    experienceLevelDelta: c.experienceLevelDelta,
    roleDescription: c.roleDescription,
    descriptionEffects: c.descriptionEffects,
  };
}

/** The tab order, from the SDK's `CREW_STANDING_ORDER`, so a standing added to the contract takes its place with no edit. */
export function orderStandings(present: Iterable<number>): number[] {
  const seen = new Set(present);
  const known = CREW_STANDING_ORDER.filter((standing) => seen.has(standing));
  // A standing this build cannot name is still a bucket of real kerbals, so it sorts last rather than being dropped.
  const unknown = [...seen]
    .filter((standing) => !CREW_STANDING_ORDER.includes(standing))
    .sort((a, b) => a - b);
  return [...known, ...unknown];
}

/** Groups active crew by `standing`, one bucket per value present; a row with no standing buckets as `Unknown`. */
export function groupByStanding(
  crew: readonly CrewRosterRow[],
): Map<number, CrewRosterRow[]> {
  const groups = new Map<number, CrewRosterRow[]>();
  for (const row of crew) {
    const key = row.standing ?? CrewStanding.Unknown;
    const bucket = groups.get(key);
    if (bucket) {
      bucket.push(row);
      continue;
    }
    groups.set(key, [row]);
  }
  return groups;
}

/** A standing's label: the contract's word, then the producer's label, then a dash, never a bare number. */
function standingLabelOf(row: {
  standing: number | null;
  situation: string;
}): string {
  return crewStandingLabel(row.standing) ?? row.situation ?? "";
}

/** Stable per-row keys: name plus an occurrence count, since a re-hired duplicate name is legal. */
export function crewRowKeys(members: readonly CrewRosterRow[]): string[] {
  const seen = new Map<string, number>();
  return members.map((m) => {
    const n = seen.get(m.name) ?? 0;
    seen.set(m.name, n + 1);
    return `${m.name}#${n}`;
  });
}

export function readCrewRoster(raw: unknown): CrewRosterRow[] {
  if (!Array.isArray(raw)) return [];
  const out: CrewRosterRow[] = [];
  const entries: unknown[] = raw;
  for (const entry of entries) {
    if (!entry || typeof entry !== "object") continue;
    const e = entry as Record<string, unknown>;
    out.push({
      name: typeof e.name === "string" ? e.name : "",
      trait: typeof e.trait === "string" ? e.trait : "",
      experienceLevel: magnitudeOf(asQuantityish(e.experienceLevel)),
      situation: typeof e.situation === "string" ? e.situation : "",
      standing: standingOf(e),
      situationOrdinal:
        typeof e.situationOrdinal === "number" ? e.situationOrdinal : null,
      inactive: e.inactive === true,
      inactiveUntilUt: magnitudeOf(asQuantityish(e.inactiveUntilUt)),
      standingEndsAtUt: magnitudeOf(asQuantityish(e.standingEndsAtUt)),
      isApplicant: e.isApplicant === true,
      available: e.available === true,
      unavailableReason:
        typeof e.unavailableReason === "string" ? e.unavailableReason : "",
      courage: magnitudeOf(asQuantityish(e.courage)),
      stupidity: magnitudeOf(asQuantityish(e.stupidity)),
      experienceLevelDelta: magnitudeOf(asQuantityish(e.experienceLevelDelta)),
      roleDescription:
        typeof e.roleDescription === "string" ? e.roleDescription : "",
      descriptionEffects:
        typeof e.descriptionEffects === "string" ? e.descriptionEffects : "",
    });
  }
  return out;
}

export function readApplicants(raw: unknown): ApplicantRow[] {
  if (!Array.isArray(raw)) return [];
  const out: ApplicantRow[] = [];
  const entries: unknown[] = raw;
  for (const entry of entries) {
    if (!entry || typeof entry !== "object") continue;
    const e = entry as Record<string, unknown>;
    out.push({
      name: typeof e.name === "string" ? e.name : "",
      trait: typeof e.trait === "string" ? e.trait : "",
      experienceLevel: magnitudeOf(asQuantityish(e.experienceLevel)),
      courage: magnitudeOf(asQuantityish(e.courage)),
      stupidity: magnitudeOf(asQuantityish(e.stupidity)),
      roleDescription:
        typeof e.roleDescription === "string" ? e.roleDescription : "",
      descriptionEffects:
        typeof e.descriptionEffects === "string" ? e.descriptionEffects : "",
    });
  }
  return out;
}

/** The producer's standing, or, from a mod build without the crew-standing capability, one derived from KSP's roster status. */
function standingOf(e: Record<string, unknown>): number | null {
  if (typeof e.standing === "number") return e.standing;
  const ordinal =
    typeof e.situationOrdinal === "number" ? e.situationOrdinal : null;
  if (ordinal === null && e.isApplicant !== true) return null;
  return crewStandingFromRosterStatus(ordinal, e.isApplicant === true);
}
