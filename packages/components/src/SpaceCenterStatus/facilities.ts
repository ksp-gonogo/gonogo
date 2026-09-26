import type { CareerFacility } from "@ksp-gonogo/sitrep-sdk";
import { KspSpaceCenterFacility } from "@ksp-gonogo/sitrep-sdk";
import { magnitudeOf } from "../shared/magnitude";

/**
 * One building of the space centre, as `space-center-status.facilities` carries
 * it. Every tier is KSP's own zero-based facility level; the display adds one,
 * because operators count from one and so does KSP's own R&D dialog.
 */
export interface SpaceCenterFacilityEntry {
  /** KSP's `SpaceCenterFacility` enum name, e.g. `"VehicleAssemblyBuilding"`. */
  facility: string;
  /** The tier it is at, zero-based. */
  currentTier: number;
  /** The top tier's own index, so a three-tier building says 2. */
  maxTier: number;
  /** What the next tier costs in funds; absent at the ceiling and when no price could be read. */
  upgradeCost?: number;
  /** KSP's own description of the current tier: newline-separated `* Property: setting` lines. */
  currentTierText?: string;
  /** The same, for the tier an upgrade would buy. */
  nextTierText?: string;
}

export const FACILITIES: Array<{ key: FacilityKey; label: string }> = [
  { key: "launchPad", label: "Launch Pad" },
  { key: "runway", label: "Runway" },
  { key: "vab", label: "VAB" },
  { key: "sph", label: "SPH" },
  { key: "mission", label: "Mission Control" },
  { key: "tracking", label: "Tracking" },
  { key: "admin", label: "Admin" },
  { key: "rd", label: "R&D" },
  { key: "astronaut", label: "Astronaut" },
];

export type FacilityKey =
  | "launchPad"
  | "runway"
  | "vab"
  | "sph"
  | "mission"
  | "tracking"
  | "admin"
  | "rd"
  | "astronaut";

/** `career.facilities` is keyed by the full `SpaceCenterFacility` enum name; maps each onto its `FacilityKey`. */
export const ENUM_FACILITY_TO_KEY: Readonly<Record<string, FacilityKey>> = {
  LaunchPad: "launchPad",
  Runway: "runway",
  VehicleAssemblyBuilding: "vab",
  SpaceplaneHangar: "sph",
  MissionControl: "mission",
  TrackingStation: "tracking",
  Administration: "admin",
  ResearchAndDevelopment: "rd",
  AstronautComplex: "astronaut",
};

/**
 * `SpaceCenterFacility` ORDINAL to this widget's short {@link FacilityKey}. The
 * enum side comes from {@link KspSpaceCenterFacility}, so a renamed or added
 * member is a compile-time gap here rather than a facility that silently stops
 * being displayed.
 */
const ORDINAL_TO_FACILITY_KEY: ReadonlyMap<number, FacilityKey> = new Map([
  [KspSpaceCenterFacility.LaunchPad, "launchPad"],
  [KspSpaceCenterFacility.Runway, "runway"],
  [KspSpaceCenterFacility.VehicleAssemblyBuilding, "vab"],
  [KspSpaceCenterFacility.SpaceplaneHangar, "sph"],
  [KspSpaceCenterFacility.MissionControl, "mission"],
  [KspSpaceCenterFacility.TrackingStation, "tracking"],
  [KspSpaceCenterFacility.Administration, "admin"],
  [KspSpaceCenterFacility.ResearchAndDevelopment, "rd"],
  [KspSpaceCenterFacility.AstronautComplex, "astronaut"],
] as const);

export const FACILITY_ORDINAL_KEYS = ORDINAL_TO_FACILITY_KEY;

/** This widget's short `FacilityKey` back to the enum name `career.facility.upgrade` takes as `facilityId`. */
export const KEY_TO_ENUM_FACILITY = Object.fromEntries(
  Object.entries(ENUM_FACILITY_TO_KEY).map(([enumName, key]) => [
    key,
    enumName,
  ]),
) as Readonly<Record<FacilityKey, string>>;

export interface FacilityLevel {
  level: number;
  max: number;
  /** Funds cost for the next-tier upgrade. 0 = unknown / already at max. */
  upgradeFunds: number;
  /** KSP's stock upgrade-dialog text for the current tier; empty when nothing emits it. */
  currentLevelText: string;
  /** The same, for the tier the next upgrade would unlock; empty at max tier. */
  nextLevelText: string;
}

export type FacilityLevels = Partial<Record<FacilityKey, FacilityLevel>>;

/**
 * `career.facilities` into this widget's short-code vocabulary. A facility is
 * carried only once BOTH tiers read as numbers: a building that answered nothing
 * is not a building at tier 0.
 */
export function parseFacilityLevels(
  raw: Readonly<Record<string, CareerFacility>> | null | undefined,
): FacilityLevels {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: FacilityLevels = {};
  for (const [rawKey, entry] of Object.entries(raw)) {
    if (!entry || typeof entry !== "object") continue;

    // The ordinal identifies the facility without trusting the key; the key is the fallback for a producer without `facilityOrdinal`.
    const ordinal = magnitudeOf(entry.facilityOrdinal);
    const key: FacilityKey | undefined =
      (ordinal !== null ? ORDINAL_TO_FACILITY_KEY.get(ordinal) : undefined) ??
      ENUM_FACILITY_TO_KEY[rawKey];
    if (key === undefined) continue;

    const currentTier = magnitudeOf(entry.currentTier);
    const maxTier = magnitudeOf(entry.maxTier);
    if (currentTier === null || maxTier === null) continue;

    out[key] = {
      level: currentTier,
      max: maxTier,
      upgradeFunds: magnitudeOf(entry.upgradeCost) ?? 0,
      currentLevelText: "",
      nextLevelText: "",
    };
  }
  return out;
}

/**
 * The widget's own reading of `career.facilities`, keyed by the
 * `SpaceCenterFacility` enum name the contribution slot declares.
 */
export function stockFacilityEntries(
  raw: Readonly<Record<string, CareerFacility>> | null | undefined,
): readonly SpaceCenterFacilityEntry[] {
  const levels = parseFacilityLevels(raw);
  const entries: SpaceCenterFacilityEntry[] = [];
  for (const { key } of FACILITIES) {
    const level = levels[key];
    if (level === undefined) continue;
    const entry: SpaceCenterFacilityEntry = {
      facility: KEY_TO_ENUM_FACILITY[key],
      currentTier: level.level,
      maxTier: level.max,
    };
    // An absent price, not a zero, which would read as free.
    if (level.upgradeFunds > 0) entry.upgradeCost = level.upgradeFunds;
    entries.push(entry);
  }
  return entries;
}

/**
 * The grid's input, assembled from whichever contributions won the slot. The
 * first entry for a facility keeps it, since the grid has one cell per building;
 * an entry naming a building with no cell is dropped.
 */
export function facilityLevelsFrom(
  entries: readonly SpaceCenterFacilityEntry[],
): FacilityLevels {
  const out: FacilityLevels = {};
  for (const entry of entries) {
    const key = ENUM_FACILITY_TO_KEY[entry.facility];
    if (key === undefined || out[key] !== undefined) continue;
    if (!Number.isFinite(entry.currentTier) || !Number.isFinite(entry.maxTier))
      continue;
    out[key] = {
      level: entry.currentTier,
      max: entry.maxTier,
      upgradeFunds: entry.upgradeCost ?? 0,
      currentLevelText: entry.currentTierText ?? "",
      nextLevelText: entry.nextTierText ?? "",
    };
  }
  return out;
}
