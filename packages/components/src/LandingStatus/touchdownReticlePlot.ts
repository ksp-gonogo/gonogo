import { CORE_UPLINK_CLIENT, getBody } from "@ksp-gonogo/core";
import type {
  PlotEntry,
  PlotLayer,
  TopicPayload,
} from "@ksp-gonogo/sitrep-sdk";
import { value } from "@ksp-gonogo/sitrep-sdk";
import { writeQuantity } from "@ksp-gonogo/ui-kit";
import { greatCircle } from "./geo";

/**
 * The touchdown reticle, as a CONTRIBUTED PLOT: the top-down half of the
 * altimetry pair, in metres east and metres north of the predicted site.
 *
 * Everything on it is the same reading the hand-rolled SVG carried, and the
 * conversion cost less here than it did for the cross-section because this plot
 * was already spatial: its scale was a metres-to-rim constant rather than a
 * normalisation, so stating it as an axis is a promotion rather than a change
 * of subject. The site sits at the origin, the vessel at its real displacement,
 * and the landing zone is a circle of its actual radius rather than a fraction
 * of a box.
 *
 * The terrain relief is a `relief` layer, the grid kind added to the vocabulary
 * for exactly this: hypsometric colour IS the altitude and the band edges are
 * the iso-lines that make slope legible. It could not be a `field`, which
 * varies along one axis only and so has no shape. Contributing the grid raw and
 * letting the renderer band it is the same tone-not-colour rule the rest of the
 * vocabulary follows: this file states elevations, never a ramp.
 */

/** Headroom past the outermost thing on the plot, as a fraction of the span. */
const SPAN_PADDING = 0.15;
/** A reticle tighter than this reads as a zoom artefact rather than a site. */
const MIN_HALF_SPAN_M = 50;
/** Points around the landing-zone ring. The vocabulary has no circle, and a
 *  ring in DATA space cannot be one: it is an ellipse the moment the axes
 *  differ, which a polygon of the plot's own coordinates gets right for free. */
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

/**
 * The reticle as a whole plot, or null when there is no site to centre on.
 *
 * A reticle with no predicted site is not a reticle with an empty middle, it is
 * no reticle: the whole plot is stated relative to a point that does not exist.
 */
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

  // The site is the origin, so the vessel sits at MINUS the site's displacement
  // from it. Bearing is clockwise from north, so east is sin and north is cos.
  const bearing = (driftBearingDeg * Math.PI) / 180;
  const vesselEast = -driftMeters * Math.sin(bearing);
  const vesselNorth = -driftMeters * Math.cos(bearing);

  const layers: PlotLayer[] = [];
  const reaches: number[] = [Math.abs(driftMeters)];

  const relief = reliefGrid(patch, patchSize, patchExtentMeters);
  if (relief) {
    layers.push(relief.layer);
    reaches.push(relief.halfSpan);
  }

  if (zoneRadiusMeters != null && zoneRadiusMeters > 0) {
    // A RING, not a filled disc. The zone sits over the terrain relief, and a
    // shaded disc, however faint, muddies the very hypsometric bands an
    // operator is reading the ground's shape out of. An outline states the same
    // boundary and hides nothing behind it.
    //
    // Drawn as a polygon rather than a circle because the vocabulary has no
    // circle and should not: a ring in DATA space is an ellipse the moment the
    // axes differ, and a polygon of the plot's own coordinates gets that right
    // without anyone thinking about it.
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
    reaches.push(zoneRadiusMeters);
  }

  // The drift itself, as a line the operator reads a direction off. Drawn only
  // when there is a displacement to draw: at touchdown the vessel and the site
  // coincide, and a zero-length line would be a mark where there is no fact.
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

  const halfSpan =
    Math.max(MIN_HALF_SPAN_M, Math.max(...reaches)) * (1 + SPAN_PADDING);
  return {
    subject: "touchdown-site",
    title: "Touchdown site",
    frame: {
      xDomain: [-halfSpan, halfSpan],
      xUnit: "m",
      yDomain: [-halfSpan, halfSpan],
      yUnit: "m",
    },
    layers,
  };
}

/**
 * Metres AGL below which an atmospheric descent is a LANDING rather than an
 * entry, and this plot has a site worth pointing at.
 *
 * The widget used to gate on this OR on the predicted point having settled
 * between ticks, and the second half cannot survive the move into a
 * contribution: `compute` is pure, a settling rate is a difference between
 * frames, and there is nowhere for one to live. Only the altitude half is left.
 *
 * That is a loss of exactly one case, and it loses in the safe direction: a
 * settled prediction between this gate and the edge of the atmosphere used to
 * show and now waits. Nothing that was hidden is now shown, which is the half
 * that would have mattered, because a pinpoint reticle around a point still
 * moving kilometres a second is a picture of a decision nobody can take.
 */
const ATMO_PLOT_ALT_GATE_M = 10_000;

/**
 * Whether an atmospheric descent is close enough for the site plots to mean
 * something. A vacuum descent has no entry phase to wait out, so it is always
 * ready; an atmospheric one waits for the gate above.
 */
function siteWorthPlotting(
  hasAtmosphere: boolean,
  aglMeters: number | null,
): boolean {
  if (!hasAtmosphere) return true;
  return aglMeters != null && aglMeters < ATMO_PLOT_ALT_GATE_M;
}

/** The site marker's clause: slope and biome, each only when it is known. An
 *  absent slope is not a flat site and an absent biome is not an unnamed one. */
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

/**
 * The terrain patch as a relief layer over its real ground footprint, or null.
 *
 * Note the extent requirement. Without `terrainPatchExtentMeters` the grid is a
 * picture at an unknown scale, and painting it across the reticle would put the
 * terrain under the site at whatever zoom the plot happened to pick: the marks
 * would be metric and the ground under them would not.
 */
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

function parentBody(topics: Readonly<Record<string, unknown>>) {
  const identity = topics["vessel.identity"] as
    | TopicPayload<"vessel.identity">
    | undefined;
  const bodies = topics["system.bodies"] as
    | TopicPayload<"system.bodies">
    | undefined;
  const index = identity?.parentBodyIndex;
  if (index == null || !bodies) return undefined;
  const name = bodies.bodies.find((b) => b.index === index)?.name;
  return name ? getBody(name) : undefined;
}

/**
 * The dispersion circle, derived rather than read: nothing on the wire carries
 * one. A fraction of the remaining horizontal travel, so it closes as the
 * descent does, floored at the sampled roughness footprint and at a hard
 * minimum so it never reads tighter than the ground actually sampled. A
 * pinpoint prediction an operator could steer by is a claim the data does not
 * support, which is why the floor is not optional.
 *
 * Null when no site was sampled at all. A zone around a site nobody looked at
 * would be a confidence interval on nothing.
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

/**
 * Seconds to the ground if nothing changes.
 *
 * In an atmosphere the mod ships one, because drag makes it a thing only the
 * game can integrate. In vacuum it is the positive root of the ballistic drop,
 * derived here from the surface gravity: an outside author contributing this
 * plot has the same two Topics and would write the same three lines, which is
 * the test of whether this seam is really reachable.
 *
 * Null when any term is missing, so the zone falls back to its floor rather
 * than to a radius computed from a guessed gravity.
 */
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
    const flight = topics["vessel.flight"] as
      | TopicPayload<"vessel.flight">
      | undefined;
    const landing = topics["vessel.landing"] as
      | TopicPayload<"vessel.landing">
      | undefined;
    const surface = topics["vessel.surface"] as
      | TopicPayload<"vessel.surface">
      | undefined;
    const orbit = topics["vessel.orbit"] as
      | TopicPayload<"vessel.orbit">
      | undefined;
    const body = parentBody(topics);
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
