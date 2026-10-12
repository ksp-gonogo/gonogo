import { CORE_UPLINK_CLIENT, crashEndingOf } from "@ksp-gonogo/core";
import {
  datedFrom,
  observedAt,
  type PlotEntry,
  type TopicPayload,
  type Value,
  value,
} from "@ksp-gonogo/sitrep-sdk";
import { writeQuantity } from "@ksp-gonogo/ui-kit";
import { drawnFrom, lastValue } from "../shared/drawnFrom";
import { magnitudeOf } from "../shared/magnitude";
import { parentBodyFromTopics } from "../shared/streamBody";
import { crashImpactOf } from "./crashImpact";
import { greatCircle } from "./geo";
import type { SceneInputs } from "./vesselView";

/**
 * What the two touchdown plots draw from: the view from the vessel and the map that projects it. Both are worked out from the same Topics here, so what the map says the craft can see is what the view shows.
 */
export interface TouchdownInputs extends SceneInputs {
  /** Radius of the possible-touchdown circle around the site, metres. */
  zoneRadiusMeters: number | null;
  /** Where the vessel is known to have crashed, measured from its last reading: the stretch between them is drawn as unknown. */
  impact?: { distanceMeters: number; bearingDeg: number } | null;
  /** Where the cross-section's ground track starts and ends along the line from the craft through the site, metres from beneath the craft (negative behind it). */
  trackBehindMeters?: number | null;
  trackAheadMeters?: number | null;
  /** Terrain slope at the site. */
  slope: Value<"°"> | null;
  /** Biome at the site. */
  biome: string | null;
  /** Whether the parent body has an atmosphere: gates the entry phase out. */
  hasAtmosphere: boolean;
  /** How wide a patch of ground the site's roughness was measured across. */
  roughnessFootprint?: Value<"m"> | null;
}

/** The heading when the craft is over the site, degrees clockwise from north. */
const DUE_EAST_DEG = 90;

/** The magnitudes of a payload's array of quantities, or null when it is absent or any one is not a finite number: a grid with a hole in it is not drawn. */
export function finiteMagnitudes(
  values: readonly Parameters<typeof magnitudeOf>[0][] | null | undefined,
): number[] | null {
  if (!values) return null;
  // The one read for every sample array: they are plain numbers for the camera's per-pixel sampler, which no unit algebra can index.
  const out = values.map((v) => magnitudeOf(v) ?? Number.NaN);
  return out.every(Number.isFinite) ? out : null;
}

/** The side of the square grid of samples, when the wire's own count of its side agrees: a count that disagrees with the samples means no grid. */
export function gridSideOf(
  samples: readonly number[] | null,
  declared: Value<"count"> | null | undefined,
): number | null {
  if (!samples || !declared) return null;
  const side = Math.sqrt(samples.length);
  return Number.isInteger(side) && declared.equals(side) ? side : null;
}

/** The ground's elevation under the site: the one the wire states, or else the craft's altitude less its height above the ground. */
export function siteElevationOf(
  stated: Value<"m"> | null | undefined,
  altitudeAsl: Value<"m"> | null | undefined,
  heightAboveGround: Value<"m"> | null | undefined,
): Value<"m"> | null {
  if (stated) return stated;
  if (!altitudeAsl) return null;
  return heightAboveGround
    ? altitudeAsl.minus(heightAboveGround.max(0))
    : altitudeAsl;
}

/** Slope and biome, each only when known: an absent slope is not a flat site. */
export function siteDescription(
  slope: Value<"°"> | null,
  biome: string | null,
  roughnessFootprint: Value<"m"> | null,
): string {
  const parts = ["predicted touchdown site"];
  if (slope?.isFinite()) {
    parts.push(`${writeQuantity(slope, { decimals: 1 })} slope`);
  }
  if (biome) parts.push(biome);
  if (roughnessFootprint?.isFinite()) {
    parts.push(
      `roughness measured across ${writeQuantity(roughnessFootprint, { decimals: 0 })}`,
    );
  }
  return parts.join(", ");
}

/**
 * The dispersion circle, derived since nothing on the wire carries one: how far from the predicted point the craft may yet come down. That is a share of the sideways travel still to come and a share of the height still to fall, both of which shrink as the craft descends, on top of a floor for what a predicted point can never know, so the circle narrows all the way to the floor at touchdown.
 * Null when no site was sampled.
 */
const ZONE_DISPERSION = 0.12;
/**
 * The sideways error a steered fall can still pick up, per metre of height left: about six degrees.
 * The window frames the craft's height at a fixed slope, so a circle that fell slower than the window would be drawn growing as the descent closed in on it; this keeps the circle shrinking on screen at least as fast as the window tightens, even when nothing moves sideways.
 */
const ZONE_PER_HEIGHT = 0.1;
/** About a lander's own size: no prediction says where the legs come down more closely than that. */
const ZONE_FLOOR_M = 10;

export function dispersionRadiusMeters(inputs: {
  sampled: boolean;
  heightMeters: number | null;
  horizontalSpeed: number | null;
  timeToImpact: number | null;
}): number | null {
  if (!inputs.sampled) return null;
  const { horizontalSpeed, timeToImpact } = inputs;
  const travel =
    horizontalSpeed != null &&
    timeToImpact != null &&
    horizontalSpeed > 0 &&
    timeToImpact > 0
      ? horizontalSpeed * timeToImpact
      : 0;
  const fall =
    inputs.heightMeters != null && inputs.heightMeters > 0
      ? ZONE_PER_HEIGHT * inputs.heightMeters
      : 0;
  return ZONE_FLOOR_M + ZONE_DISPERSION * travel + fall;
}

/** The speed over the ground, from the surface speed and the part of it that is vertical; null when either is missing. */
export function horizontalSpeedOf(
  surfaceSpeed: number | null,
  verticalSpeed: number | null,
): number | null {
  if (surfaceSpeed == null || verticalSpeed == null) return null;
  return Math.sqrt(Math.max(0, surfaceSpeed ** 2 - verticalSpeed ** 2));
}

/** Seconds to the ground if nothing changes: the mod's figure in an atmosphere, the ballistic drop from surface gravity in vacuum; null when any term is missing. */
export function timeToImpact(inputs: {
  atmosphericTimeToImpact: number | null;
  aglMeters: number | null;
  descentRate: number | null;
  mu: number | null;
  radiusFromCentre: number | null;
}): number | null {
  if (inputs.atmosphericTimeToImpact != null) {
    return inputs.atmosphericTimeToImpact;
  }
  const { aglMeters, descentRate, mu, radiusFromCentre } = inputs;
  if (
    aglMeters == null ||
    descentRate == null ||
    mu == null ||
    radiusFromCentre == null ||
    !(aglMeters > 0) ||
    !(descentRate > 0) ||
    !(radiusFromCentre > 0)
  ) {
    return null;
  }
  const g = mu / (radiusFromCentre * radiusFromCentre);
  if (!(g > 0) || !Number.isFinite(g)) return null;
  const t =
    (-descentRate + Math.sqrt(descentRate * descentRate + 2 * g * aglMeters)) /
    g;
  return Number.isFinite(t) && t > 0 ? t : null;
}

/** The readings a touchdown plot was last drawn from while the vessel was reporting. */
interface Kept {
  flight: TopicPayload<"vessel.flight"> | undefined;
  landing: TopicPayload<"vessel.landing"> | undefined;
  surface: TopicPayload<"vessel.surface"> | undefined;
  elements: TopicPayload<"vessel.orbit"> | undefined;
  body: ReturnType<typeof parentBodyFromTopics>;
  vesselId: string | undefined;
  /** When the flight reading it rests on was made. */
  at: Value<"ut"> | undefined;
}

/**
 * Registers a plot of the touchdown: `build` is handed what the two touchdown plots share, worked out once from the Topics here, and returns the plot or null.
 */
export function registerTouchdownPlot(
  id: string,
  build: (inputs: TouchdownInputs) => PlotEntry | null,
): void {
  // The last whole set of readings this plot was drawn from, kept for a flight that ends in a crash: the vessel's own topics go with it, and the plot holds what it last drew.
  let kept: Kept | undefined;
  // The crash report of the vessel the kept scene belongs to: the topic holds only the latest crash, and after one the game moves the player on to the wreck, whose own report replaces it.
  let keptCrash: TopicPayload<"crash.lastCrash"> | undefined;
  CORE_UPLINK_CLIENT.registerContribution({
    id,
    contributes: "plots",
    deps: [
      "vessel.identity",
      "system.bodies",
      "vessel.flight",
      "vessel.surface",
      "vessel.landing",
      "vessel.orbit",
      "crash.hasRecent",
      "crash.lastCrash",
    ],
    compute: (topics) => {
      const live = {
        flight: lastValue(topics["vessel.flight"]),
        landing: lastValue(topics["vessel.landing"]),
        surface: lastValue(topics["vessel.surface"]),
        elements: lastValue(topics["vessel.orbit"]),
        body: parentBodyFromTopics(topics),
      };
      const vesselId = lastValue(topics["vessel.identity"])?.vesselId;
      const complete =
        live.flight?.latitude != null &&
        live.flight?.longitude != null &&
        live.landing?.predictedLatitude != null &&
        live.landing?.predictedLongitude != null &&
        live.body?.radius != null;
      const crashFlag = lastValue(topics["crash.hasRecent"]);
      const crashed = lastValue(topics["crash.lastCrash"]);
      // Whether that crash is still the ending of the flight in view, by the one rule the hero and the gate use.
      const ending = crashEndingOf({
        recent: crashFlag?.recent === true,
        report: crashed,
        vesselId,
        flightAt:
          topics["vessel.flight"].state === "observed"
            ? observedAt(topics["vessel.flight"])
            : undefined,
      });
      const crashOnRecord = ending !== undefined;
      // A vessel the crash on record names is over, whether it is the one reporting now or the one the scene was drawn for: whatever it goes on reporting is the wreck, so the scene stops being redrawn from it.
      const overThisVessel =
        ending !== undefined &&
        (ending.vesselId === vesselId || ending.vesselId === kept?.vesselId);
      if (complete && !overThisVessel) {
        keptCrash = undefined;
        kept = {
          flight: live.flight,
          landing: live.landing,
          surface: live.surface,
          elements: live.elements,
          body: live.body,
          vesselId,
          at: observedAt(topics["vessel.flight"]),
        };
      }
      if (kept !== undefined && ending?.vesselId === kept.vesselId) {
        keptCrash = ending;
      }
      // The crash on record is the ending of the flight the scene belongs to: after a crash the game moves the player on to the wreck, a vessel of another id, so the crash is not matched to the id the scene was drawn for.
      const frozen =
        kept !== undefined && crashOnRecord && (!complete || overThisVessel);
      const source = frozen ? kept : complete ? live : null;
      if (source === null || source === undefined) return null;
      const { flight, landing, surface, elements, body } = source;
      if (
        flight?.latitude == null ||
        flight?.longitude == null ||
        landing?.predictedLatitude == null ||
        landing?.predictedLongitude == null ||
        body?.radius == null
      ) {
        return null;
      }
      const from = {
        latitude: flight.latitude.magnitude,
        longitude: flight.longitude.magnitude,
      };
      const drift = greatCircle(
        from.latitude,
        from.longitude,
        landing.predictedLatitude.magnitude,
        landing.predictedLongitude.magnitude,
        body.radius,
      );
      // Read once: the zone's timing and the plot's own gate both need the height.
      const height = surface?.heightFromTerrain ?? flight.altitudeTerrain;
      const aglMeters = height?.magnitude ?? null;
      const track = finiteMagnitudes(landing.groundTrackDistances);
      const siteHeights = finiteMagnitudes(landing.siteHeights);
      const siteHeightsSize = gridSideOf(siteHeights, landing.siteHeightsSize);
      const siteElevation = siteElevationOf(
        landing.predictedTerrainElevation,
        flight.altitudeAsl,
        height,
      );
      const plot = build({
        impact: crashImpactOf({
          crash: frozen
            ? (keptCrash ?? null)
            : (lastValue(topics["crash.lastCrash"]) ?? null),
          vesselId: frozen ? keptCrash?.vesselId : vesselId,
          flightIsCurrent:
            !frozen && complete && topics["vessel.flight"].state === "observed",
          from,
          bodyRadius: body.radius,
        }),
        driftMeters: drift.distanceMeters,
        // With the craft over the site there is no direction to it: the heading is due east, as the cross-section's track is, so it does not swing to north when the drift reaches nothing.
        driftBearingDeg:
          drift.distanceMeters > 1 ? drift.bearingDeg : DUE_EAST_DEG,
        zoneRadiusMeters: dispersionRadiusMeters({
          sampled: landing.sampleSource != null,
          heightMeters: aglMeters,
          horizontalSpeed: horizontalSpeedOf(
            flight.surfaceSpeed?.magnitude ?? null,
            flight.verticalSpeed?.magnitude ?? null,
          ),
          timeToImpact: timeToImpact({
            atmosphericTimeToImpact:
              landing.atmosphericTimeToImpact?.magnitude ?? null,
            aglMeters,
            descentRate: flight.verticalSpeed?.scaled(-1).magnitude ?? null,
            mu: elements?.mu?.magnitude ?? null,
            radiusFromCentre:
              flight.altitudeAsl?.plus(value("m", body.radius)).magnitude ??
              null,
          }),
        }),
        siteHeights,
        siteHeightsSize,
        // The grid's world scale for the camera's ray march, in plain metres.
        siteHeightsExtentMeters: magnitudeOf(landing.siteHeightsExtentMeters),
        horizonAngles: finiteMagnitudes(landing.horizonAngles),
        trackBehindMeters: track?.at(0) ?? null,
        trackAheadMeters: track?.at(-1) ?? null,
        // The craft's height in the camera's metre frame, where the ground it looks at is placed.
        altitudeAsl: magnitudeOf(flight.altitudeAsl),
        siteElevation: magnitudeOf(siteElevation),
        slope: landing.predictedSlopeAngle ?? null,
        biome: landing.predictedBiome ?? null,
        hasAtmosphere: body.hasAtmosphere ?? false,
        hasOcean: body.hasOcean,
        aglMeters,
        roughnessFootprint: landing.roughnessFootprintMeters ?? null,
      });
      return plot
        ? [
            {
              ...plot,
              held: frozen
                ? datedFrom(
                    [{ state: "held", instant: kept?.at, grade: "held" }],
                    undefined,
                  )
                : drawnFrom([
                    topics["vessel.flight"],
                    topics["vessel.surface"],
                    topics["vessel.landing"],
                    topics["vessel.orbit"],
                  ]),
            },
          ]
        : null;
    },
  });
}
