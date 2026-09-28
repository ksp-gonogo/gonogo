import { CORE_UPLINK_CLIENT } from "@ksp-gonogo/core";
import type { PlotEntry, PlotLayer } from "@ksp-gonogo/sitrep-sdk";
import { value } from "@ksp-gonogo/sitrep-sdk";
import { writeQuantity } from "@ksp-gonogo/ui-kit";
import { parentBodyFromTopics } from "../shared/streamBody";
import { greatCircle } from "./geo";
import { siteWorthPlotting } from "./siteGate";

/**
 * The touchdown reticle as a contributed plot: the top-down half of the altimetry pair, in metres east and north of the predicted site, with the vessel at its real displacement and the landing zone at its actual radius.
 * The terrain is a `relief` layer: this file states elevations and the renderer bands them, so hypsometric colour is the altitude and band edges are the iso-lines.
 */

/** Headroom past the outermost thing on the plot, as a fraction of the span. */
const SPAN_PADDING = 0.15;
/** A reticle tighter than this reads as a zoom artefact rather than a site. */
const MIN_HALF_SPAN_M = 50;
/** Points around the landing-zone ring: a ring in data space is an ellipse once the axes differ, so it is a polygon in the plot's own coordinates. */
const ZONE_STEPS = 48;

export interface TouchdownReticleInputs {
  /** Downrange distance from the vessel to the predicted site, metres. */
  driftMeters: number | null;
  /** Bearing from the vessel to the site, degrees clockwise from north. */
  driftBearingDeg: number | null;
  /** Radius of the possible-touchdown circle around the site, metres. */
  zoneRadiusMeters: number | null;
  /** Terrain elevations, row-major NxN, metres. */
  patch: readonly number[] | null;
  /** The N of the NxN patch. */
  patchSize: number | null;
  /** Ground width the whole patch spans, metres. */
  patchExtentMeters: number | null;
  /** Terrain slope at the site, degrees. */
  slopeDeg: number | null;
  /** Biome at the site. */
  biome: string | null;
  /** Whether the parent body has an atmosphere: gates the entry phase out. */
  hasAtmosphere: boolean;
  /** Height above terrain, metres, for that gate. */
  aglMeters: number | null;
}

/** The reticle as a whole plot, or null when there is no predicted site: the whole plot is stated relative to it. */
export function buildTouchdownReticlePlot(
  inputs: Readonly<TouchdownReticleInputs>,
): PlotEntry | null {
  const {
    driftMeters,
    driftBearingDeg,
    zoneRadiusMeters,
    patch,
    patchSize,
    patchExtentMeters,
    slopeDeg,
    biome,
  } = inputs;
  if (
    driftMeters == null ||
    !Number.isFinite(driftMeters) ||
    driftBearingDeg == null ||
    !Number.isFinite(driftBearingDeg)
  ) {
    return null;
  }
  if (!siteWorthPlotting(inputs.hasAtmosphere, inputs.aglMeters)) return null;

  // The site is the origin, so the vessel sits at minus its displacement; bearing is clockwise from north, so east is sin and north is cos.
  const bearing = (driftBearingDeg * Math.PI) / 180;
  const vesselEast = -driftMeters * Math.sin(bearing);
  const vesselNorth = -driftMeters * Math.cos(bearing);

  const layers: PlotLayer[] = [];
  // The window frames the sampled ground and the vessel, NOT the dispersion ring: on a fast approach the ring is kilometres across and simply runs off the edges.
  const reaches: number[] = [Math.abs(driftMeters)];

  const relief = reliefGrid(patch, patchSize, patchExtentMeters);
  if (relief) {
    layers.push(relief.layer);
    reaches.push(relief.halfSpan);
  }

  if (zoneRadiusMeters != null && zoneRadiusMeters > 0) {
    // An outline, not a filled disc, so it hides none of the hypsometric bands the ground's shape is read from.
    layers.push({
      kind: "series",
      id: "landing-zone",
      points: Array.from({ length: ZONE_STEPS + 1 }, (_, i) => {
        const a = (i / ZONE_STEPS) * 2 * Math.PI;
        return {
          x: zoneRadiusMeters * Math.sin(a),
          y: zoneRadiusMeters * Math.cos(a),
        };
      }),
      tone: "warn",
      dashed: true,
      description: `touchdown dispersion ${writeQuantity(
        value("m", zoneRadiusMeters),
        { decimals: 0 },
      )} across the predicted point`,
    });
  }

  // Only when there is a displacement: at touchdown a zero-length line would be a mark with no fact.
  if (Math.abs(driftMeters) > 0) {
    layers.push({
      kind: "series",
      id: "drift",
      points: [
        { x: vesselEast, y: vesselNorth },
        { x: 0, y: 0 },
      ],
      tone: "info",
      weight: 1.4,
      description: `site ${writeQuantity(value("m", driftMeters), {
        decimals: 0,
      })} downrange on bearing ${writeQuantity(value("°", driftBearingDeg), {
        decimals: 0,
      })}`,
    });
  }

  layers.push({
    kind: "marker",
    id: "site",
    at: { x: 0, y: 0 },
    shape: "cross",
    tone: "info",
    description: siteDescription(slopeDeg, biome),
  });
  layers.push({
    kind: "marker",
    id: "vessel",
    at: { x: vesselEast, y: vesselNorth },
    shape: "ring",
    tone: "go",
    description: "current sub-vessel point",
  });

  // With a patch the relief bleeds to the frame's edges like a map; padding only when the span comes from the drift.
  const halfSpan = relief
    ? Math.max(MIN_HALF_SPAN_M, relief.halfSpan)
    : Math.max(MIN_HALF_SPAN_M, Math.max(...reaches)) * (1 + SPAN_PADDING);
  return {
    subject: "touchdown-site",
    title: "Touchdown site",
    frame: {
      // A map: equal scale both ways and no tick ladder; the known patch width and the labelled ring carry the scale.
      kind: "spatial",
      xDomain: [-halfSpan, halfSpan],
      xUnit: "m",
      yDomain: [-halfSpan, halfSpan],
      yUnit: "m",
    },
    layers,
  };
}

/** Slope and biome, each only when known: an absent slope is not a flat site. */
function siteDescription(
  slopeDeg: number | null,
  biome: string | null,
): string {
  const parts = ["predicted touchdown site"];
  if (slopeDeg != null && Number.isFinite(slopeDeg)) {
    parts.push(`${writeQuantity(value("°", slopeDeg), { decimals: 1 })} slope`);
  }
  if (biome) parts.push(biome);
  return parts.join(", ");
}

/** The terrain patch as a relief layer over its real ground footprint, or null without `terrainPatchExtentMeters`, since a grid at unknown scale would sit under metric marks. */
function reliefGrid(
  patch: readonly number[] | null,
  patchSize: number | null,
  patchExtentMeters: number | null,
): { layer: PlotLayer; halfSpan: number } | null {
  if (!patch || !patchSize || patchSize < 2) return null;
  if (patch.length < patchSize * patchSize) return null;
  if (
    patchExtentMeters == null ||
    !Number.isFinite(patchExtentMeters) ||
    patchExtentMeters <= 0
  ) {
    return null;
  }
  for (let i = 0; i < patchSize * patchSize; i++) {
    if (!Number.isFinite(patch[i])) return null;
  }
  const halfSpan = patchExtentMeters / 2;
  return {
    halfSpan,
    layer: {
      kind: "relief",
      id: "terrain",
      values: patch,
      size: patchSize,
      bounds: { x0: -halfSpan, y0: -halfSpan, x1: halfSpan, y1: halfSpan },
      description: "sampled terrain around the predicted site",
    },
  };
}

/**
 * The dispersion circle, derived since nothing on the wire carries one: a fraction of the remaining horizontal travel, floored at the sampled roughness footprint and a hard minimum so it never claims more precision than the data.
 * Null when no site was sampled.
 */
const ZONE_DISPERSION = 0.12;
const ZONE_FLOOR_M = 30;

function zoneRadius(inputs: {
  sampled: boolean;
  horizontalSpeed: number | null;
  timeToImpact: number | null;
  roughnessFootprintMeters: number | null;
}): number | null {
  if (!inputs.sampled) return null;
  const { horizontalSpeed, timeToImpact } = inputs;
  const travel =
    horizontalSpeed != null &&
    timeToImpact != null &&
    horizontalSpeed > 0 &&
    timeToImpact > 0
      ? ZONE_DISPERSION * horizontalSpeed * timeToImpact
      : 0;
  return Math.max(inputs.roughnessFootprintMeters ?? 0, ZONE_FLOOR_M, travel);
}

/** Seconds to the ground if nothing changes: the mod's figure in an atmosphere, the ballistic drop from surface gravity in vacuum; null when any term is missing. */
function timeToImpact(inputs: {
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

CORE_UPLINK_CLIENT.registerContribution({
  id: "touchdown-reticle",
  contributes: "plots",
  deps: [
    "vessel.identity",
    "system.bodies",
    "vessel.flight",
    "vessel.surface",
    "vessel.landing",
    "vessel.orbit",
  ],
  compute: (topics) => {
    const flight = topics["vessel.flight"];
    const landing = topics["vessel.landing"];
    const surface = topics["vessel.surface"];
    const orbit = topics["vessel.orbit"];
    const body = parentBodyFromTopics(topics);
    if (
      flight?.latitude == null ||
      flight?.longitude == null ||
      landing?.predictedLatitude == null ||
      landing?.predictedLongitude == null ||
      body?.radius == null
    ) {
      return null;
    }
    const drift = greatCircle(
      flight.latitude.magnitude,
      flight.longitude.magnitude,
      landing.predictedLatitude.magnitude,
      landing.predictedLongitude.magnitude,
      body.radius,
    );
    const patchExtentMeters =
      landing.terrainPatchExtentMeters?.magnitude ?? null;

    const plot = buildTouchdownReticlePlot({
      driftMeters: drift.distanceMeters,
      driftBearingDeg: drift.bearingDeg,
      zoneRadiusMeters: zoneRadius({
        sampled: landing.sampleSource != null,
        horizontalSpeed: flight.surfaceSpeed?.magnitude ?? null,
        timeToImpact: timeToImpact({
          atmosphericTimeToImpact:
            landing.atmosphericTimeToImpact?.magnitude ?? null,
          aglMeters:
            surface?.heightFromTerrain?.magnitude ??
            flight.altitudeTerrain?.magnitude ??
            null,
          descentRate:
            flight.verticalSpeed?.magnitude != null
              ? -flight.verticalSpeed.magnitude
              : null,
          mu: orbit?.mu?.magnitude ?? null,
          radiusFromCentre:
            flight.altitudeAsl?.magnitude != null
              ? body.radius + flight.altitudeAsl.magnitude
              : null,
        }),
        roughnessFootprintMeters:
          landing.roughnessFootprintMeters?.magnitude ?? null,
      }),
      patch: landing.terrainPatch?.map((h) => h.magnitude) ?? null,
      patchSize: landing.terrainPatchSize?.magnitude ?? null,
      patchExtentMeters,
      slopeDeg: landing.predictedSlopeAngle?.magnitude ?? null,
      biome: landing.predictedBiome ?? null,
      hasAtmosphere: body.hasAtmosphere ?? false,
      aglMeters:
        surface?.heightFromTerrain?.magnitude ??
        flight.altitudeTerrain?.magnitude ??
        null,
    });
    return plot ? [plot] : null;
  },
});
