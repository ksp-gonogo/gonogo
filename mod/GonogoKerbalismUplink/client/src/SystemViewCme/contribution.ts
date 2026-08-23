import type { ContributionEntry } from "@ksp-gonogo/sitrep-sdk";
import { magnitudeOf } from "@ksp-gonogo/ui-kit";
import type {
  KerbalismSpaceWeather,
  KerbalismStarInfo,
  KerbalismStormEntry,
} from "../__generated__/contract";
import { KERBALISM } from "../uplink";

// ---------------------------------------------------------------------------
// CME / solar-activity overlay: a `system-view.entities` contribution off
// `kerbalism.spaceweather`, the same shape-contribution seam the built-in
// vessel-orbit and CommNet-graph entries ride (`SystemView/
// vesselOrbitsContribution.ts`). One yellow `travelling-pulse` per active
// storm slot, so SystemView renders it without knowing Kerbalism exists.
//
// `KerbalismSpaceWeather.storms` is scoped to the ACTIVE VESSEL's current SOI
// body: one entry per (that body, star) pair (`Storm.StormKey`), so at most
// one entry per star in a single-star system, a handful in a modded
// binary/trinary one. A storm with `stormState === 0` carries no
// `stormTime`/`stormDuration`/`dist` (Kerbalism's own `StormData.Reset()`
// zeroes them) and is skipped outright, never drawn from a fabricated
// position.
//
// HONESTY NOTE on the travelling pulse's geometry: a CME is a targeted mass
// ejection from ONE point on the star travelling in ONE direction, not a
// spherical front (an earlier version drew a `blob`, a concentric circle,
// purely because that was the only directional-less shape available; a
// later version drew a decorative, endlessly looping CSS animation, which
// read as multiple repeating waves rather than one real event). This
// contribution supplies only what IS real: the bearing (below), the
// segment's LENGTH, and the real UT window it occupies; SystemView owns
// turning that into a single, non-looping pass positioned each render
// against its own live UT (`systemEntities.ts`'s doc comment on
// `travelling-pulse`, `SystemEntitiesLayer.tsx`'s `Primitive` case), a
// contribution's `compute()` never receives a wall clock itself
// (contribution-slots-spec: pure function of Topics/Processors only, see
// `contributions.ts`'s own doc comment).
//
// The segment's length is `stormEjectionSpeed * stormDuration` (clamped to
// `dist`): the physical distance the ejecta covers, at its real ejection
// speed, over the real span the storm stays active at the target body,
// `stormDuration`. The UT window is `arriveUt` (Kerbalism's own
// `stormTime`, the storm's arrival) through `clearUt` (`arriveUt +
// stormDuration`, when the trailing edge fully clears the target):
// SystemView derives the wave's DEPARTURE time itself from these two plus
// the segment's own length, at the one constant real rate that already
// makes the crossing phase take exactly `stormDuration`. A storm entry with
// no resolvable duration, ejection speed, or arrival UT is skipped outright,
// the same "no data, no draw" discipline every other field on this entity
// already follows, rather than a fabricated segment or a fabricated time.
//
// The bearing: `KerbalismSpaceWeather.stars` carries each star's
// vessel-to-star unit `direction` (`VesselData.SunInfo.Direction`), captured
// on the same reflection pass as the storm slot itself, so a star entry is
// always present alongside a storm entry for that star. Negating it gives a
// star-to-vessel bearing, a fair stand-in for star-to-body (the vessel sits
// inside that body's SOI, negligible next to interplanetary `dist`). This
// bearing carries all three components: SystemView's arithmetic is
// three-dimensional and its third component is out of the ecliptic, which is
// the game's own `y`. A storm with no matching `stars` entry (defensive: the two
// lists come off the same reflection loop, so this shouldn't happen in
// practice) is skipped outright rather than drawn with a fabricated bearing.
//
// Colour: always the shared yellow token (`--color-tag-yellow-fg`, the same
// one `ThermalStatus`'s "warm" state and `ShipMap`'s highlight already use),
// distinct from the muted warning tokens this used to carry and from the
// accent green SystemView reserves for selection. `stormState` still
// distinguishes inbound (faint) from arrived (normal emphasis, the same
// yellow) so the pulse shows the storm progressing between those two real,
// known states without changing hue.
// ---------------------------------------------------------------------------

type CmeEntity = ContributionEntry<"system-view.entities">;
/** `SystemEntityMeta` isn't part of the sdk's public surface (only the entry
 *  type is); derived here so the meta literal below still type-checks. */
type CmeEntityMeta = NonNullable<CmeEntity["meta"]>;

const STORM_STATE_INBOUND = 1;
const STORM_STATE_IN_PROGRESS = 2;

function stormStateLabel(state: number): string {
  if (state === STORM_STATE_INBOUND) return "inbound";
  if (state === STORM_STATE_IN_PROGRESS) return "in progress";
  return "unknown";
}

/**
 * The star-to-body bearing, in the diagram's own parent-centric metres, from
 * `star.direction` (Kerbalism's vessel-to-star unit vector): negated for
 * star-to-vessel, scaled to `distMetres`. `null` when the direction is absent
 * or degenerate (a zero vector): the caller treats that the same as any other
 * missing datum, no draw rather than a fabricated bearing.
 *
 * <b>All three components, where this used to drop one.</b> It kept x and z and
 * threw the out-of-plane component away, on the stated grounds that SystemView
 * flattened every orbit onto one plane anyway. That diagram's arithmetic is
 * three-dimensional now, so the component this had been discarding is one it can
 * draw, and a bearing missing it would put an interplanetary front in the
 * ecliptic when the storm is not. The game's `y` is out of the ecliptic and the
 * diagram's third component is too.
 */
function bearingMetres(
  direction: KerbalismStarInfo["direction"] | undefined,
  distMetres: number,
): { xMetres: number; yMetres: number; zMetres: number } | null {
  if (!direction) return null;
  const dx = magnitudeOf(direction.x);
  const dy = magnitudeOf(direction.y);
  const dz = magnitudeOf(direction.z);
  if (dx == null || dy == null || dz == null) return null;
  const mag = Math.hypot(dx, dy, dz);
  if (!(mag > 0)) return null;
  // `|| 0` normalises a -0 result (e.g. dz === 0) to plain 0: a real
  // negative bearing is truthy and passes through untouched, only the
  // signed-zero edge case gets folded.
  return {
    xMetres: (-dx / mag) * distMetres || 0,
    yMetres: (-dz / mag) * distMetres || 0,
    zMetres: (-dy / mag) * distMetres || 0,
  };
}

/**
 * Pure core, exported so a test can call it directly against a plain
 * `KerbalismSpaceWeather` fixture (mirrors `spaceWeatherBadges`'s and
 * `computeKerbalismPartMeters`'s own export-the-pure-core pattern).
 *
 * A storm entry is omitted outright (never a degraded/placeholder entry) when
 * its state is 0/absent, its star name is missing, its distance is
 * missing/non-positive, or `stars` carries no resolvable bearing for that
 * star: the same "no data, no draw" discipline `computeVesselOrbitEntities`
 * already applies to a vessel with no resolvable body.
 */
export function computeCmeEntities(
  weather: KerbalismSpaceWeather | undefined,
): CmeEntity[] {
  if (!weather) return [];
  const ejectionSpeedMps = magnitudeOf(weather.stormEjectionSpeed);
  const entities: CmeEntity[] = [];
  for (const storm of weather.storms ?? []) {
    const entity = computeStormEntity(storm, weather.stars, ejectionSpeedMps);
    if (entity) entities.push(entity);
  }
  return entities;
}

function computeStormEntity(
  storm: KerbalismStormEntry,
  stars: readonly KerbalismStarInfo[] | undefined,
  ejectionSpeedMps: number | null,
): CmeEntity | null {
  const state = magnitudeOf(storm.stormState);
  if (state == null || state === 0) return null;
  if (typeof storm.star !== "string" || storm.star.length === 0) return null;
  const dist = magnitudeOf(storm.dist);
  if (dist == null || !(dist > 0)) return null;

  const starInfo = stars?.find((s) => s.star === storm.star);
  const bearing = bearingMetres(starInfo?.direction, dist);
  if (!bearing) return null;

  // The pulse's segment length is real physics, not a stylistic ratio: how
  // far the ejecta covers, at its real speed, over the real span the storm
  // stays active at the target body. Either input missing/non-positive
  // means the length can't be honestly derived, so the whole entity is
  // skipped, same discipline as a missing bearing above.
  const durationS = magnitudeOf(storm.stormDuration);
  if (durationS == null || !(durationS > 0)) return null;
  if (ejectionSpeedMps == null || !(ejectionSpeedMps > 0)) return null;
  const segmentLengthMetres = Math.min(durationS * ejectionSpeedMps, dist);

  // Arrival UT drives BOTH the meta readout below and the shape's own
  // `arriveUt`/`clearUt` (SystemView positions the single, non-looping wave
  // from these against its own live UT, see `systemEntities.ts`'s doc
  // comment on `travelling-pulse`): missing/non-finite means the wave has
  // nothing real to anchor its timing to, so the whole entity is skipped,
  // same "no data, no draw" discipline as dist/duration/speed above. In
  // practice this never fires once `state !== 0` (the fair-vs-cheating
  // boundary already guarantees `stormTime` is populated alongside it), but
  // the check keeps this function honest against a malformed payload rather
  // than assuming the contract.
  const arrivalUt = magnitudeOf(storm.stormTime);
  if (arrivalUt == null || !Number.isFinite(arrivalUt)) return null;
  const meta: CmeEntityMeta = {
    star: storm.star,
    state: stormStateLabel(state),
    distM: dist,
    durationS,
    ejectionSpeedMps,
    arrivalUt,
  };

  return {
    id: `cme:${storm.star}`,
    // Fixed at the star's own position (the pulse's apex): this entity only
    // projects when the diagram's current frame IS that star (SystemView's
    // "root parent" frame setting, the whole-system view a CME threatening
    // the whole neighbourhood belongs on), same off-frame degrade every
    // other entity gets.
    position: {
      kind: "fixed",
      parentName: storm.star,
      xMetres: 0,
      yMetres: 0,
      zMetres: 0,
    },
    shape: {
      kind: "travelling-pulse",
      to: { kind: "fixed", parentName: storm.star, ...bearing },
      segmentLengthMetres,
      arriveUt: arrivalUt,
      // Kerbalism's own `storm_duration` is exactly "how long the storm
      // stays active once it hits" (this contract's own `StormDuration` doc
      // comment): the real UT the trailing edge clears the target.
      clearUt: arrivalUt + durationS,
    },
    // Faint while inbound, normal once arrived: an ambient effect that stacks
    // under the CommNet graph and point markers (the travelling pulse's own
    // default layer sits below connection-line and point), never brighter
    // than that tier. The severity never changes with state, only the
    // emphasis, so "arrived" reads as more present without the marker
    // cutting off what is drawn on top or being mistaken for a selection.
    // `warn` is the meaning; which hue it becomes is SystemView's to decide.
    style: {
      emphasis: state === STORM_STATE_IN_PROGRESS ? "normal" : "faint",
      severity: "warning" as const,
    },
    meta,
  };
}

KERBALISM.registerContribution({
  id: "system-view-cme",
  contributes: "system-view.entities",
  deps: ["kerbalism.spaceweather"],
  requires: "kerbalism",
  compute: (topics) =>
    computeCmeEntities(
      topics["kerbalism.spaceweather"] as KerbalismSpaceWeather | undefined,
    ),
});
