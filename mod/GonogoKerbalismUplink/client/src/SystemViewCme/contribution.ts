import type { ContributionEntry } from "@ksp-gonogo/sitrep-sdk";
import { magnitudeOf } from "@ksp-gonogo/ui-kit";
import type {
  KerbalismSpaceWeather,
  KerbalismStormEntry,
} from "../__generated__/contract";
import { KERBALISM } from "../uplink";

// ---------------------------------------------------------------------------
// CME / solar-activity overlay: a `system-view.entities` contribution off
// `kerbalism.spaceweather`, the same shape-contribution seam the built-in
// vessel-orbit and CommNet-graph entries ride (`SystemView/
// vesselOrbitsContribution.ts`). One faint `blob` per active storm slot, so
// SystemView renders it without knowing Kerbalism exists.
//
// `KerbalismSpaceWeather.storms` is scoped to the ACTIVE VESSEL's current SOI
// body: one entry per (that body, star) pair (`Storm.StormKey`), so at most
// one entry per star in a single-star system, a handful in a modded
// binary/trinary one. A storm with `stormState === 0` carries no
// `stormTime`/`stormDuration`/`dist` (Kerbalism's own `StormData.Reset()`
// zeroes them) and is skipped outright, never drawn from a fabricated
// position.
//
// HONESTY NOTE on the blob's radius: `KerbalismStormEntry.dist` is the LIVE
// sun-to-body distance (`Storm.Update`'s own geometry), not a tracked
// position of the CME's leading edge, Kerbalism's contract has no field for
// "how far has the ejecta travelled so far". A literal expanding shockwave
// would have to interpolate that from wall-clock time, which a contribution's
// `compute()` never receives (contribution-slots-spec: pure function of
// Topics/Processors only, see `contributions.ts`'s own doc comment). Rather
// than fabricate a travelled distance, the blob is drawn at `dist`: a faint
// marker reaching from the star out to the body currently in that storm's
// scope. It reads as "this star has thrown a CME the body's own direction",
// which is exactly what the wire can honestly support; `stormState`
// distinguishes inbound (still faint, neutral) from arrived (faint, warn-
// tinted) so the marker still shows the storm progressing between those two
// real, known states.
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
 * Pure core, exported so a test can call it directly against a plain
 * `KerbalismSpaceWeather` fixture (mirrors `spaceWeatherBadges`'s and
 * `computeKerbalismPartMeters`'s own export-the-pure-core pattern).
 *
 * A storm entry is omitted outright (never a degraded/placeholder entry) when
 * its state is 0/absent, its star name is missing, or its distance is
 * missing/non-positive: the same "no data, no draw" discipline
 * `computeVesselOrbitEntities` already applies to a vessel with no resolvable
 * body.
 */
export function computeCmeEntities(
  weather: KerbalismSpaceWeather | undefined,
): CmeEntity[] {
  if (!weather) return [];
  const ejectionSpeedMps = magnitudeOf(weather.stormEjectionSpeed);
  const entities: CmeEntity[] = [];
  for (const storm of weather.storms ?? []) {
    const entity = computeStormEntity(storm, ejectionSpeedMps);
    if (entity) entities.push(entity);
  }
  return entities;
}

function computeStormEntity(
  storm: KerbalismStormEntry,
  ejectionSpeedMps: number | null,
): CmeEntity | null {
  const state = magnitudeOf(storm.stormState);
  if (state == null || state === 0) return null;
  if (typeof storm.star !== "string" || storm.star.length === 0) return null;
  const dist = magnitudeOf(storm.dist);
  if (dist == null || !(dist > 0)) return null;

  const arrivalUt = magnitudeOf(storm.stormTime);
  const durationS = magnitudeOf(storm.stormDuration);
  const meta: CmeEntityMeta = {
    star: storm.star,
    state: stormStateLabel(state),
    distM: dist,
    ...(arrivalUt != null ? { arrivalUt } : {}),
    ...(durationS != null ? { durationS } : {}),
    ...(ejectionSpeedMps != null ? { ejectionSpeedMps } : {}),
  };

  return {
    id: `cme:${storm.star}`,
    // Fixed at the star's own position: this entity only projects when the
    // diagram's current frame IS that star (SystemView's "root parent" frame
    // setting, the whole-system view a CME threatening the whole neighbourhood
    // belongs on), same off-frame degrade every other entity gets.
    position: { kind: "fixed", parentName: storm.star, xMetres: 0, yMetres: 0 },
    shape: { kind: "blob", radiusMetres: dist },
    // Faint by default, always: an ambient effect that stacks under the
    // CommNet graph and point markers, never a bright alarm competing with
    // them. A storm in progress carries a `warn` severity rather than a
    // raised emphasis, so "arrived" reads as distinct without the marker
    // cutting off what is drawn on top of it. The severity is the meaning;
    // which hue that becomes is SystemView's to decide.
    style: {
      emphasis: "faint",
      ...(state === STORM_STATE_IN_PROGRESS
        ? { severity: "warn" as const }
        : {}),
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
