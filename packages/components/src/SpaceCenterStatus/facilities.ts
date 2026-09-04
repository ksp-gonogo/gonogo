import type { CareerFacility } from "@ksp-gonogo/sitrep-sdk";
import { KspSpaceCenterFacility } from "@ksp-gonogo/sitrep-sdk";
import { magnitudeOf } from "../shared/magnitude";

// The facility vocabulary and the two conversions either side of the
// `space-center-status.facilities` contribution slot. Separate from the widget
// so the built-in contribution (`./facilitiesContribution.ts`) can reach them
// without importing the component that hosts it, the same split ShipMap draws
// between `shipTopology.ts` and its own part-meters contribution.

/**
 * One building of the space centre, as `space-center-status.facilities` carries
 * it. Mirrored in the sdk (`api/contribution-slots.ts`), which is where a
 * contributor's `compute` is typed against it; this is the real declaration.
 *
 * <para>Every tier is KSP's own zero-based facility level, the same index
 * `career.facilities` carries: `maxTier` is the TOP tier's own index, so
 * a three-tier building says 2. The display adds one, because operators count
 * from one and so does KSP's own R&D dialog.</para>
 */
export interface SpaceCenterFacilityEntry {
  /** KSP's `SpaceCenterFacility` enum name, e.g. `"VehicleAssemblyBuilding"`. */
  facility: string;
  /** The tier it is at, zero-based. */
  currentTier: number;
  /** The top tier's own index, so a three-tier building says 2. */
  maxTier: number;
  /** What the next tier costs in funds; absent at the ceiling and absent when
   *  no price could be read, which the grid draws the same way. */
  upgradeCost?: number;
  /** KSP's own description of the tier the building is at, as its upgrade
   *  dialog writes it: newline-separated `* Property: setting` lines. */
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

/**
 * `career.facilities` (mod/Sitrep.Host/
 * CareerViewProvider.cs's `BuildFacilities`) is keyed by the full
 * `SpaceCenterFacility` enum name, not this widget's short codes, maps
 * each enum name onto its `FacilityKey`. Names match the real wire
 * (decompile-confirmed; also the exact 9
 * keys observed in a real `career.status` capture).
 */
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
 * `SpaceCenterFacility` ORDINAL to this widget's short {@link FacilityKey}.
 *
 * The abbreviations are ours, so the pairing has to be written down somewhere:
 * nothing derives `vab` from `VehicleAssemblyBuilding`. What is NOT written down
 * is the enum side of it, which comes from {@link KspSpaceCenterFacility}, so a
 * renamed or added member shows up as a compile-time gap here rather than as a
 * facility that silently stops being displayed. `facilityOrdinalTableIsComplete`
 * in this widget's test is the check on that.
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

/** Exported for the completeness test; see {@link ORDINAL_TO_FACILITY_KEY}. */
export const FACILITY_ORDINAL_KEYS = ORDINAL_TO_FACILITY_KEY;

/**
 * Reverse of {@link ENUM_FACILITY_TO_KEY}: this widget's short `FacilityKey`
 * back to the full `SpaceCenterFacility` enum name the `career.facility.upgrade`
 * command's `facilityId` takes (the mod re-resolves the enum server-side).
 */
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
  /**
   * Multi-line text matching what KSP's stock upgrade dialog shows for
   * the current tier (e.g. "* Max Active Strategies: 1\n* Max Commitment: 25.0%").
   * Empty string when nothing is emitting them.
   */
  currentLevelText: string;
  /** Same shape as `currentLevelText`, but for what the *next* upgrade
   *  would unlock. Empty string when at max tier (no next) or when the
   *  producer doesn't emit them. */
  nextLevelText: string;
}

export type FacilityLevels = Partial<Record<FacilityKey, FacilityLevel>>;

/**
 * `career.facilities` into this widget's short-code vocabulary.
 *
 * <para>Every field is read through {@link magnitudeOf} because the contract
 * types them as `Value`s, and a facility is carried only once BOTH tiers read as
 * numbers. A building that answered nothing is not a building at tier 0, and
 * telling those two apart is the grid's whole subject: an entry is how the first
 * one is said, and its absence is how the second one is.</para>
 *
 * <para>`upgradeCost` is absent at the ceiling and absent when no price could be
 * read, and both become `0`, the "unknown or at max" sentinel {@link
 * stockFacilityEntries} turns back into an absent price. `currentLevelText` /
 * `nextLevelText` have no stock equivalent at all: the tier text on the grid
 * comes from a career model that carries its own, through the contribution slot.</para>
 */
export function parseFacilityLevels(
  raw: Readonly<Record<string, CareerFacility>> | null | undefined,
): FacilityLevels {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: FacilityLevels = {};
  for (const [rawKey, entry] of Object.entries(raw)) {
    if (!entry || typeof entry !== "object") continue;

    // The ORDINAL first, when the entry carries one: it identifies the facility
    // without trusting the key it arrived under. The key is the fallback, for a
    // producer that predates `facilityOrdinal`. Before the ordinal existed, a
    // facility whose enum NAME missed the nine-entry table was skipped outright,
    // so it vanished from the display with nothing said.
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
 * The widget's own reading of `career.facilities`, in the vocabulary the
 * contribution slot declares: the `SpaceCenterFacility` enum name rather than
 * this widget's short codes, since the short codes are a display detail nothing
 * outside these two files should have to know.
 *
 * <para>A facility that answered no tier is not carried. `parseFacilityLevels`
 * has already dropped it, and the slot's own rule is the same one for the same
 * reason: a building at tier 0 and a building that said nothing are different
 * readings, and an entry is the way to say the first.</para>
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
    // 0 is this parser's "unknown or at max" sentinel, and the slot says that
    // with an absent price rather than a zero, which would read as free. No tier
    // text: the stock channel carries none, and a career model that has its own
    // contributes it through the slot instead.
    if (level.upgradeFunds > 0) entry.upgradeCost = level.upgradeFunds;
    entries.push(entry);
  }
  return entries;
}

/**
 * The grid's input, assembled from whichever contributions won the slot.
 *
 * <para>The first entry for a facility keeps it. Two contributors sharing the
 * winning band both draw, and the grid has one cell per building, so a second
 * claim on the same building has nowhere to go; taking the first matches the way
 * the Administration Building resolves two screens claiming one id.</para>
 *
 * <para>An entry naming a building this widget has no cell for is dropped, which
 * is what already happens to an unknown key on the wire. A KSC expansion adding
 * buildings renders them through `space-center-status.sections`.</para>
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
