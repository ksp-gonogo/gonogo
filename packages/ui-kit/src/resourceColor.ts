/*
 * Resource-identity colour: a deterministic name -> colour mapping, so the same
 * resource renders the same colour everywhere. Identity, never severity.
 *
 * Two tiers, normalised into the same saturation and lightness range:
 *   1. A curated substring map for known resource kinds, ordered most specific
 *      first. Each family owns one hue; members of a family are told apart by
 *      a lightness hashed from their full name
 *   2. A golden-angle hash fallback for anything unrecognised, steered out of
 *      every curated family's hue neighbourhood
 */

/** Fixed saturation shared by both tiers, tuned by eye for the dark canvas. */
const SATURATION_PCT = 65;

/**
 * Legible lightness range every curated member and Tier 2 fallback is mapped
 * into: below the floor a fill is hard to read on the dark canvas, above the
 * ceiling it washes out against highlight chrome.
 */
const LIGHTNESS_MIN_PCT = 38;
const LIGHTNESS_MAX_PCT = 72;
const LIGHTNESS_RANGE_PCT = LIGHTNESS_MAX_PCT - LIGHTNESS_MIN_PCT;

/** Tier 2's fixed lightness (it gets its distinctness from hue), and a single-alias family's, which has no sibling to spread from. */
const LIGHTNESS_MID_PCT = 55;

/** Golden angle in degrees: stepping a hash by this amount spreads hues
 *  maximally without ever having to track which hues are already in use. */
const GOLDEN_ANGLE_DEG = 137.508;

/** Default half-width, in degrees, of a curated family's Tier 2 reserved zone, before it is clamped to the gap to its nearest neighbour. */
const RESERVED_ZONE_DEFAULT_DEG = 10;

/** Minimum gap, in degrees, kept between two adjacent families' reserved zones. */
const RESERVED_ZONE_MARGIN_DEG = 1.5;

/** Hard stop on the reserved-zone rotation loop, so a pathological `CURATED` table cannot hang it. */
const MAX_ROTATIONS = 64;

/**
 * The reserved-zone escape step is derived from the name and mapped into this
 * range, so two unknowns escaping the same zone rotate by different amounts
 * and diverge.
 */
const ESCAPE_STEP_MIN_DEG = 60;
const ESCAPE_STEP_RANGE_DEG = 241;

/**
 * Fractional dither added to the escape step so it is never a whole number: a
 * whole-number step can orbit a small set of hues that all sit in reserved
 * zones.
 */
const ESCAPE_STEP_DITHER = GOLDEN_ANGLE_DEG - Math.floor(GOLDEN_ANGLE_DEG);

/**
 * One curated family: every alias in `aliases` maps into the same `hue`.
 */
interface CuratedFamily {
  aliases: readonly string[];
  hue: number;
}

/**
 * Tier 1: curated substring matches against a lower-cased name. The first
 * match wins, so families are ordered most specific first: a family whose
 * alias contains another family's alias must come before it. Extend it rather
 * than widen an existing alias.
 */
const CURATED: readonly CuratedFamily[] = [
  { aliases: ["liquidfuel"], hue: 40 }, // amber
  { aliases: ["lqdhydrogen", "hydrogen"], hue: 205 }, // pale blue
  { aliases: ["electriccharge", "ec"], hue: 50 }, // yellow
  { aliases: ["carbondioxide", "co2", "waste"], hue: 65 }, // olive
  { aliases: ["monopropellant", "monoprop"], hue: 95 }, // yellow-green
  { aliases: ["oxidizer"], hue: 15 }, // red-orange
  { aliases: ["oxygen", "air"], hue: 190 }, // cyan
  { aliases: ["water"], hue: 215 }, // blue
  { aliases: ["ore"], hue: 28 }, // tan / brown
  { aliases: ["food"], hue: 130 }, // green
  { aliases: ["xenon"], hue: 275 }, // violet
  { aliases: ["ablator"], hue: 5 }, // grey-orange
  { aliases: ["nitrogen", "ammonia"], hue: 175 }, // teal
];

/** Shortest angular distance between two hues on the 0..360 wheel. */
function hueDistance(a: number, b: number): number {
  const diff = Math.abs(a - b) % 360;
  return diff > 180 ? 360 - diff : diff;
}

/**
 * Each family's effective Tier 2 reserved-zone radius: the default, clamped to
 * half the gap to its nearest neighbour less the margin, so zones never overlap.
 */
const RESERVED_RADII_DEG: readonly number[] = CURATED.map((family, index) => {
  let nearestGap = Infinity;
  for (let other = 0; other < CURATED.length; other++) {
    if (other === index) continue;
    nearestGap = Math.min(
      nearestGap,
      hueDistance(family.hue, CURATED[other].hue),
    );
  }
  const halfGap = nearestGap / 2;
  return Math.max(
    0,
    Math.min(RESERVED_ZONE_DEFAULT_DEG, halfGap - RESERVED_ZONE_MARGIN_DEG),
  );
});

/**
 * Every curated family's resolved Tier 2 reserved zone (centre and effective
 * radius).
 */
export const CURATED_RESERVED_ZONES: ReadonlyArray<{
  aliases: readonly string[];
  centre: number;
  radius: number;
}> = CURATED.map((family, index) => ({
  aliases: family.aliases,
  centre: family.hue,
  radius: RESERVED_RADII_DEG[index],
}));

/**
 * Tier 1 family lookup: `key` must already be lower-cased. First alias match
 * wins; `undefined` when no curated family matches.
 */
function matchCuratedFamily(
  key: string,
  table: readonly CuratedFamily[] = CURATED,
): CuratedFamily | undefined {
  return table.find((candidate) =>
    candidate.aliases.some((alias) => key.includes(alias)),
  );
}

/**
 * Tier 1 hue lookup against a table (not exported from the package index).
 * `key` must already be lower-cased.
 */
export function matchCuratedHue(
  key: string,
  table: readonly CuratedFamily[] = CURATED,
): number | undefined {
  return matchCuratedFamily(key, table)?.hue;
}

/**
 * FNV-1a, 32-bit: a fixed arithmetic definition, so colours stay deterministic
 * across engines and runs.
 */
function fnv1a(str: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** Positive modulo: JS `%` keeps the sign of the dividend. */
function positiveMod(value: number, modulus: number): number {
  return ((value % modulus) + modulus) % modulus;
}

/**
 * Deterministic member lightness for a full resource name, hashed with a
 * namespaced key so it is independent of Tier 2's hue.
 */
export function memberLightness(key: string): number {
  const hash = fnv1a(`light:${key}`);
  const fraction = hash / 0xffffffff;
  return LIGHTNESS_MIN_PCT + fraction * LIGHTNESS_RANGE_PCT;
}

/**
 * Tier 1 hue and lightness for a full resource name, or `undefined` when no
 * curated family matches. A single-alias family sits at the mid lightness; a
 * multi-alias family spreads each member to its own hashed lightness.
 */
export function placedColor(
  key: string,
): { hue: number; lightness: number } | undefined {
  const family = matchCuratedFamily(key);
  if (!family) return undefined;
  const lightness =
    family.aliases.length === 1 ? LIGHTNESS_MID_PCT : memberLightness(key);
  return { hue: family.hue, lightness };
}

/**
 * Whether a hue falls inside any curated family's reserved zone.
 */
function isWithinReservedZone(hue: number): boolean {
  return CURATED_RESERVED_ZONES.some(
    ({ centre, radius }) => hueDistance(hue, centre) < radius,
  );
}

/**
 * Tier 2: `hue = (stableHash(name) * goldenAngle) mod 360`, rotated by a
 * name-derived step until it clears every reserved zone.
 */
export function hashHue(key: string): number {
  const hash = fnv1a(key);
  let hue = positiveMod(hash * GOLDEN_ANGLE_DEG, 360);
  // Upper bits of the hash, decoupled from the initial hue.
  const escapeStep =
    ESCAPE_STEP_MIN_DEG +
    ((hash >>> 8) % ESCAPE_STEP_RANGE_DEG) +
    ESCAPE_STEP_DITHER;
  let rotations = 0;
  while (isWithinReservedZone(hue) && rotations < MAX_ROTATIONS) {
    hue = positiveMod(hue + escapeStep, 360);
    rotations++;
  }
  return hue;
}

/**
 * Resolve a resource name to a stable, legible fill colour, as an `hsl()`
 * string. The same name always gets the same colour, case and surrounding
 * whitespace ignored. Known resources share a hue per family (fuels, for
 * instance) with a lightness that tells members apart; unrecognised names get
 * a hashed hue clear of every known family. The colour is an identity, never
 * a severity: use a tone for state.
 *
 * @example
 * ```tsx
 * <Meter label="LiquidFuel" fillColor={resourceColor("LiquidFuel")} value={amount} capacity={max} />
 * ```
 *
 * @category Theme
 */
export function resourceColor(name: string): string {
  const key = name.trim().toLowerCase();
  const placed = placedColor(key);
  const hue = placed?.hue ?? hashHue(key);
  const lightness = placed?.lightness ?? LIGHTNESS_MID_PCT;
  return `hsl(${Math.round(hue)}deg ${SATURATION_PCT}% ${Math.round(lightness)}%)`;
}
