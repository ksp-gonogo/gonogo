// ---------------------------------------------------------------------------
// Resource-identity colour primitive (design doc: gonogo main repo,
// local_docs/design/2026-08-08-resource-colour-system.md). Deterministic
// name -> colour mapping so the same resource always renders the same
// colour everywhere it appears (ShipMap's per-part meters today, any future
// resource widget). Pure and stateless: no registry, no memoisation needed,
// same input always produces the same output.
//
// Two tiers:
//   1. A curated substring map for resource names we know the real-world
//      kind of (water, oxidizer, food, ...). Ordered MOST-SPECIFIC-FIRST so
//      a longer/more specific alias always gets first refusal over a
//      shorter one that would also match (see CURATED's own comment). Each
//      family owns a single HUE (its neighbourhood on the wheel); members of
//      a family (waste/wastewater/carbondioxide all share the co2/waste
//      family) are told apart by LIGHTNESS, not hue. Hue-only spreading was
//      tried first and failed for crowded families: waste's three members
//      landed 2.8-6deg apart, boxed in by ElectricCharge's neighbouring
//      band, and read as nearly-identical olives. Lightness has headroom
//      even when hue is crowded, so a family's members now spread along
//      that axis instead, deterministically from a hash of each member's own
//      full name, no per-member table entry required.
//   2. A stateless golden-angle hash fallback for anything unrecognised
//      (mod resources, future KSP resources, typos), so an unknown resource
//      still gets a stable, well-spread, legible colour rather than one
//      shared "unknown" grey. Its reserved-zone check avoids every curated
//      family's hue neighbourhood, not just its exact centre point.
//
// Both tiers are normalised into the SAME saturation band and lightness
// range, so a curated resource and a hashed one read as one system rather
// than two. This retires the old muted `MeterTone`-as-identity workaround in
// ShipMap.
// ---------------------------------------------------------------------------

/** Fixed saturation shared by both tiers, tuned for the dark ShipMap canvas.
 *  Starter value per the design doc; tune by eye on operator review, the
 *  MECHANISM (two tiers, ordered curated match, hue = family identity,
 *  lightness = member identity, golden-angle hash, reserved-zone avoidance)
 *  is what must stay correct, not this number. */
const SATURATION_PCT = 65;

/** Legible lightness range every curated member and Tier 2 fallback is
 *  mapped into. Kept away from the extremes on purpose: below the floor a
 *  fill gets hard to read against the dark ShipMap canvas, above the
 *  ceiling it washes out against the same canvas's highlight chrome. Widened
 *  slightly past the design doc's starter 42-70 (by eye, on the waste
 *  family, the tightest three-member case): 42-70 gave the closest pair
 *  (CarbonDioxide/WasteWater) only ~5.3pts apart, legible but not quite the
 *  confident step the operator asked for; 38-72 pushes the same pair to
 *  ~6.4pts apart while staying inside the same dark-canvas/washed-out
 *  guardrails. */
const LIGHTNESS_MIN_PCT = 38;
const LIGHTNESS_MAX_PCT = 72;
const LIGHTNESS_RANGE_PCT = LIGHTNESS_MAX_PCT - LIGHTNESS_MIN_PCT;

/** Midpoint of the legible lightness range. Used as Tier 2's fixed
 *  lightness (Tier 2 already gets its distinctness from hue spread, it
 *  doesn't need a second axis) and as the anchor lightness for a
 *  single-alias curated family: a family with exactly one alias has no
 *  distinct sibling to spread away from, so it sits at the neutral middle
 *  of the range rather than an arbitrary hash-derived point. */
const LIGHTNESS_MID_PCT = 55;

/** Golden angle in degrees: stepping a hash by this amount spreads hues
 *  maximally without ever having to track which hues are already in use. */
const GOLDEN_ANGLE_DEG = 137.508;

/** Default half-width, in degrees, of a curated family's Tier-2 reserved
 *  zone before it gets clamped down to fit the gap to its nearest
 *  neighbour (see `RESERVED_RADII_DEG` below). This no longer sizes a
 *  member-placement band, members share the family's exact centre hue now,
 *  it only keeps an unknown resource's hashed hue from landing on top of a
 *  curated family's neighbourhood. */
const RESERVED_ZONE_DEFAULT_DEG = 10;

/** Minimum gap, in degrees, kept between two adjacent families' reserved
 *  zones. Small on purpose: it only has to stop zones touching, the halved
 *  nearest-neighbour-gap calculation already does the heavy lifting. */
const RESERVED_ZONE_MARGIN_DEG = 1.5;

/** Hard stop on the reserved-zone rotation loop: 360 / GOLDEN_ANGLE_DEG
 *  cycles back to (very nearly) the starting hue, so this is already far
 *  more attempts than a real curated hue count could ever exhaust. Exists
 *  only so a pathological future CURATED table can't hang this function. */
const MAX_ROTATIONS = 64;

/** The reserved-zone escape step is DERIVED FROM THE NAME (upper bits of the
 *  same FNV-1a hash), not the fixed golden angle, and mapped into this range.
 *  Two different unknowns that both land in the same reserved zone then
 *  rotate by DIFFERENT amounts and diverge, instead of converging on one hue
 *  the way a shared fixed step made them. 60..300deg: wide enough to clear a
 *  zone in a step or two, never a small step that crawls. Still fully
 *  deterministic per name. */
const ESCAPE_STEP_MIN_DEG = 60;
const ESCAPE_STEP_RANGE_DEG = 241;

/** Fractional dither (~0.508deg, the golden angle's own fractional part) added
 *  to the name-derived step so it is NEVER a whole number. A whole-number step
 *  can orbit a small set of hues (step and 360 sharing a factor) that all sit
 *  in reserved zones, so the escape loop would run to its cap without ever
 *  clearing; a non-integer step's orbit never exactly repeats, so it always
 *  reaches a clear hue. */
const ESCAPE_STEP_DITHER = GOLDEN_ANGLE_DEG - Math.floor(GOLDEN_ANGLE_DEG);

/**
 * One curated family: every alias in `aliases` maps into the same `hue`,
 * shared exactly by every member (no per-family spread any more, see the
 * module header). Aliases within a family don't need internal ordering, but
 * FAMILIES must be ordered most-specific-first in `CURATED` below whenever
 * one family's alias could also be a substring of a different family's
 * alias, so the more specific family wins the match.
 */
interface CuratedFamily {
  aliases: readonly string[];
  hue: number;
}

/**
 * Tier 1: curated substring matches, case-insensitive (callers normalise
 * to lower-case before matching), most-specific-first. Starter set from the
 * design doc; small and obvious on purpose, extend it rather than widen an
 * existing alias.
 *
 * `liquidfuel` is listed ahead of any future generic `fuel` alias, and
 * `electriccharge` ahead of `ec`, so a later addition of a broader alias
 * can never steal a match that a more specific one earned first; see
 * `resourceColor.test.ts`'s precedence-mechanism tests for the invariant
 * this ordering exists to protect.
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
 * Each family's EFFECTIVE Tier-2 reserved-zone radius:
 * `min(RESERVED_ZONE_DEFAULT_DEG, halfGapToNearestOtherCentre -
 * RESERVED_ZONE_MARGIN_DEG)`, clamped to >= 0, computed once at module load
 * from `CURATED`'s own centres. This is purely an exclusion zone for Tier
 * 2's hash fallback now (member placement no longer needs it, members share
 * the family's exact hue), but the clamp mechanism carries over unchanged:
 * it keeps zones from ever overlapping without hand-tuning any individual
 * family.
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
 * Every curated family's resolved Tier-2 reserved zone (centre + effective
 * radius), exported so tests can assert the non-overlap invariant and
 * per-family reserved-zone membership directly, without recomputing the
 * clamp logic above.
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
 * wins, so `CURATED`'s ordering determines precedence (see the table's own
 * comment). `undefined` when no curated family matches.
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
 * Tier 1 hue lookup, exported (module-local, not from the package index) so
 * the ordering/precedence mechanism can be unit-tested directly against
 * synthetic tables without going through the full `resourceColor` pipeline.
 * `key` must already be lower-cased. Returns the family's hue, shared
 * exactly by every member; `memberLightness` below is what actually tells
 * two members of the same family apart.
 */
export function matchCuratedHue(
  key: string,
  table: readonly CuratedFamily[] = CURATED,
): number | undefined {
  return matchCuratedFamily(key, table)?.hue;
}

/**
 * FNV-1a, 32-bit. Deliberately NOT `String.prototype`-derived hashing or
 * anything that could vary by engine/run: FNV-1a is a fixed arithmetic
 * definition, so `resourceColor` stays deterministic across processes,
 * browsers, and time, which is the whole point of Tier 2 (and of Tier 1's
 * member-lightness placement below).
 */
function fnv1a(str: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** Positive modulo: JS `%` keeps the sign of the dividend, which would
 *  otherwise hand back a negative "hue". */
function positiveMod(value: number, modulus: number): number {
  return ((value % modulus) + modulus) % modulus;
}

/**
 * Deterministic member lightness for a full resource name, hashed with a
 * namespaced key (`light:<name>`) so this placement and Tier 2's hue
 * fallback derive independently, mapped into
 * `[LIGHTNESS_MIN_PCT, LIGHTNESS_MAX_PCT]`. Same name -> same lightness
 * always. Exported for direct testing of the placement mechanism.
 */
export function memberLightness(key: string): number {
  const hash = fnv1a(`light:${key}`);
  const fraction = hash / 0xffffffff;
  return LIGHTNESS_MIN_PCT + fraction * LIGHTNESS_RANGE_PCT;
}

/**
 * Tier 1 resolved hue + lightness for a full resource name. `undefined`
 * when no curated family matches (falls through to Tier 2 in
 * `resourceColor`). A single-alias family (nothing else could plausibly
 * share its neighbourhood) sits at the neutral `LIGHTNESS_MID_PCT`; a
 * multi-alias family (waste/wastewater/carbondioxide, electriccharge/ec,
 * ...) spreads each matching full name to its own hash-derived lightness,
 * so members stay tellable apart even when the family's hue neighbourhood
 * is tightly boxed in by its neighbours. Exported for direct testing.
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
 * A hue is "reserved" for Tier 2 purposes when it falls inside any curated
 * family's reserved zone (centre +/- effective radius). This keeps an
 * unknown resource's hashed hue from landing on top of, or right next to, a
 * curated family's own neighbourhood.
 */
function isWithinReservedZone(hue: number): boolean {
  return CURATED_RESERVED_ZONES.some(
    ({ centre, radius }) => hueDistance(hue, centre) < radius,
  );
}

/**
 * Tier 2: stateless golden-angle hash fallback, exported for the same
 * synthetic-table testing reason as `matchCuratedHue`.
 *
 * `hue = (stableHash(name) * goldenAngle) mod 360`, then, if it lands
 * inside a curated family's reserved zone, rotated by a NAME-DERIVED step
 * (deterministic, no randomness) as many times as it takes to clear every
 * zone. The step is per-name so two unknowns escaping the SAME zone
 * diverge, see `ESCAPE_STEP_MIN_DEG`'s comment.
 */
export function hashHue(key: string): number {
  const hash = fnv1a(key);
  let hue = positiveMod(hash * GOLDEN_ANGLE_DEG, 360);
  // Escape step from the name's own hash (upper bits, decoupled from the
  // initial-hue derivation above), so a different name escaping the same zone
  // rotates by a different amount and lands somewhere else.
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
 * Resolve a resource name to a stable, legible fill colour. Same name ->
 * same colour always; curated names get a hue matching the real resource
 * kind (shared with every other member of that family) plus a lightness
 * that tells family members apart, unrecognised names get a well-spread
 * hashed hue at the neutral mid-lightness, never colliding with a curated
 * family's reserved zone.
 */
export function resourceColor(name: string): string {
  const key = name.trim().toLowerCase();
  const placed = placedColor(key);
  const hue = placed?.hue ?? hashHue(key);
  const lightness = placed?.lightness ?? LIGHTNESS_MID_PCT;
  return `hsl(${Math.round(hue)}deg ${SATURATION_PCT}% ${Math.round(lightness)}%)`;
}
