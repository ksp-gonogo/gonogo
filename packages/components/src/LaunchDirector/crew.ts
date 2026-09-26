import { NULL_DISPLAY } from "@ksp-gonogo/ui-kit";
import { asQuantityish, magnitudeOr } from "../shared/magnitude";

export interface CrewMember {
  name: string;
  trait: string;
  experienceLevel: number;
  /** Whether this kerbal can fly today, or `null` where the wire said nothing, which is not false. */
  available: boolean | null;
  unavailableReason: string;
}

/** What a crew row can be, once availability and its reason are read together. */
export type CrewReading = "available" | "unavailable" | "unread";

/** Grid rows at or above which the crew grid stands open; measured, shorter tiles push the launch control past the fold. */
export const CREW_GRID_MIN_ROWS = 14;

/**
 * Availability and its reason read together. Unavailable with an EMPTY reason
 * is the third state: `CrewStanding.Unknown` carries no reason on purpose, so
 * that is how "nothing could say" arrives.
 */
export function crewReading(k: CrewMember): CrewReading {
  if (k.available === true) return "available";
  if (k.available === false && k.unavailableReason !== "") return "unavailable";
  return "unread";
}

/**
 * The roster's own count and the three exceptions to it, each silent at zero.
 * The selected count lives here because this line is the part that survives a
 * short tile when the grid folds.
 */
export function crewTally(crew: CrewMember[], selected = 0): string {
  const readings = crew.map(crewReading);
  const unavailable = readings.filter((r) => r === "unavailable").length;
  const unread = readings.filter((r) => r === "unread").length;
  const terms = [`(${crew.length})`];
  if (unavailable > 0) terms.push(`${unavailable} unavailable`);
  if (unread > 0) terms.push(`${unread} no reading`);
  if (selected > 0) terms.push(`${selected} selected`);
  return ` ${terms.join(" · ")}`;
}

/** Trait and rank stay reachable on a row whose value line spent itself on the reason. */
export function crewChipTitle(k: CrewMember, reading: CrewReading): string {
  const who = `${k.trait || NULL_DISPLAY} · L${k.experienceLevel}`;
  if (reading === "available") return who;
  if (reading === "unavailable") return `${who} · ${k.unavailableReason}`;
  return `${who} · no availability reading`;
}

/** The chip's second line: trait and rank for a kerbal who can fly, otherwise why not. */
export function crewChipDetail(k: CrewMember, reading: CrewReading): string {
  if (reading === "available") {
    return `${k.trait || NULL_DISPLAY} L${k.experienceLevel}`;
  }
  if (reading === "unavailable") return k.unavailableReason;
  return "no reading";
}

export function parseCrew(raw: unknown): CrewMember[] | null {
  if (raw === null || raw === undefined) return null;
  if (!Array.isArray(raw)) return null;
  const out: CrewMember[] = [];
  const entries: unknown[] = raw;
  for (const entry of entries) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    const e = entry as Record<string, unknown>;
    const name = typeof e.name === "string" ? e.name : null;
    if (!name) continue;
    out.push({
      name,
      trait: typeof e.trait === "string" ? e.trait : "",
      experienceLevel: magnitudeOr(asQuantityish(e.experienceLevel), 0),
      available: typeof e.available === "boolean" ? e.available : null,
      unavailableReason:
        typeof e.unavailableReason === "string" ? e.unavailableReason : "",
    });
  }
  return out;
}
