import { CORE_UPLINK_CLIENT } from "@ksp-gonogo/core";
import type { PlotEntry, PlotLayer, Value } from "@ksp-gonogo/sitrep-sdk";
import { value } from "@ksp-gonogo/sitrep-sdk";
import { writeQuantity } from "@ksp-gonogo/ui-kit";
import { drawnFrom, lastValue } from "../shared/drawnFrom";
import { parentBodyFromTopics } from "../shared/streamBody";
import { crashImpactOf } from "./crashImpact";
import { greatCircle } from "./geo";
import { roundedHeight } from "./readouts";
import { surfaceGravityOf, surfaceMeters } from "./seaSurface";
import { siteWorthPlotting } from "./siteGate";

/**
 * The touchdown reticle as a contributed plot: the top-down half of the altimetry pair, in metres east and north of the predicted site, with the vessel at its real displacement and the landing zone at its actual radius.
 */

/** Headroom past the outermost thing on the plot, as a fraction of the span. */
const SPAN_PADDING = 0.4;
/** The reticle's half width at touchdown: tighter than this reads as a zoom artefact rather than a site. */
const MIN_HALF_SPAN_M = 50;
/** How much of the room from the site to the nearest edge of the window the dispersion ring may take. */
const RING_ROOM = 0.92;
/** How much the window's half width grows per metre of the craft's height: about half the width of the ground a 120 degree cone sees. */
const HALF_SPAN_PER_HEIGHT = 0.9;
/**
 * The ground under the marks, from the grid of heights the mod samples around the predicted site, north at the top: a real two-dimensional picture of the ground. Null unless the grid is whole.
 */
function siteRelief(
  heights: readonly number[] | null,
  size: number | null,
  extentMeters: number | null,
): PlotLayer | null {
  if (!heights || !size || size < 2 || heights.length < size * size)
    return null;
  if (
    extentMeters == null ||
    !Number.isFinite(extentMeters) ||
    extentMeters <= 0
  ) {
    return null;
  }
  for (let i = 0; i < size * size; i++) {
    if (!Number.isFinite(heights[i])) return null;
  }
  const half = extentMeters / 2;
  return {
    kind: "relief",
    id: "terrain",
    values: heights,
    size,
    bounds: { x0: -half, y0: -half, x1: half, y1: half },
    description: "sampled ground around the predicted site",
  };
}

/** Hatching over every part of the window the sampled grid does not cover: the plot says it has no reading there. */
function unsampledAround(
  ground: PlotLayer,
  window: { x0: number; x1: number; y0: number; y1: number },
): PlotLayer[] {
  if (ground.kind !== "relief") return [];
  const { x0, y0, x1, y1 } = ground.bounds;
  const side = (
    id: string,
    sideName: "left" | "right" | "above" | "below",
    boundary: { x: number; y: number }[],
  ): PlotLayer => ({
    kind: "region",
    id,
    side: sideName,
    boundary,
    tone: "neutral",
    hatched: true,
    description: "ground beyond the sampled grid is unknown",
  });
  return [
    ...(window.x0 < x0
      ? [
          side("unsampled-left", "left", [
            { x: x0, y: window.y0 },
            { x: x0, y: window.y1 },
          ]),
        ]
      : []),
    ...(window.x1 > x1
      ? [
          side("unsampled-right", "right", [
            { x: x1, y: window.y0 },
            { x: x1, y: window.y1 },
          ]),
        ]
      : []),
    ...(window.y0 < y0
      ? [
          side("unsampled-below", "below", [
            { x: window.x0, y: y0 },
            { x: window.x1, y: y0 },
          ]),
        ]
      : []),
    ...(window.y1 > y1
      ? [
          side("unsampled-above", "above", [
            { x: window.x0, y: y1 },
            { x: window.x1, y: y1 },
          ]),
        ]
      : []),
  ];
}

/** Points around the landing-zone ring: a ring in data space is an ellipse once the axes differ, so it is a polygon in the plot's own coordinates. */
const ZONE_STEPS = 48;

export interface TouchdownReticleInputs {
  /** Downrange distance from the vessel to the predicted site, metres. */
  driftMeters: number | null;
  /** Bearing from the vessel to the site, degrees clockwise from north. */
  driftBearingDeg: number | null;
  /** Radius of the possible-touchdown circle around the site, metres. */
  zoneRadiusMeters: number | null;
  /** Terrain elevations around the predicted site, row-major NxN from the northern row, metres. */
  siteHeights?: readonly number[] | null;
  /** The N of the NxN grid. */
  siteHeightsSize?: number | null;
  /** Ground width the whole grid spans, metres. */
  siteHeightsExtentMeters?: number | null;
  /** Where the vessel is known to have crashed, measured from its last reading: the stretch between them is drawn as unknown, and the window holds both. */
  impact?: { distanceMeters: number; bearingDeg: number } | null;
  /** Terrain slope at the site, degrees. */
  slopeDeg: number | null;
  /** Biome at the site. */
  biome: string | null;
  /** Whether the parent body has an atmosphere: gates the entry phase out. */
  hasAtmosphere: boolean;
  /** Whether the parent body has an ocean, when the stream says: a site grid wholly under the sea is then water, and the floor beneath it is not drawn as terrain. */
  hasOcean?: boolean;
  /** Height above terrain, metres, for that gate and for the window's least width. */
  aglMeters: number | null;
  /** Where the cross-section's ground track starts and ends along the line from the craft through the site, metres from beneath the craft (negative behind it). */
  trackBehindMeters?: number | null;
  trackAheadMeters?: number | null;
  /** How wide a patch of ground the site's roughness was measured across. */
  roughnessFootprint?: Value<"m"> | null;
  /** Where the predicted site stands on the body, metres east and north of its origin, and the body's surface gravity: the sea is drawn as a moving surface from them, fixed to the body. Without them it is a flat fill. */
  sea?: {
    siteOnBody: { east: number; north: number };
    gravity: number;
    /** The body's own liquid colour, when its registry entry has one. */
    liquidColor?: string;
  } | null;
}

/** The reticle as a whole plot, or null when there is no predicted site: the whole plot is stated relative to it. */
export function buildTouchdownReticlePlot(
  inputs: Readonly<TouchdownReticleInputs>,
): PlotEntry | null {
  const { driftMeters, driftBearingDeg, zoneRadiusMeters, slopeDeg, biome } =
    inputs;
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

  const impactBearing =
    inputs.impact == null ? null : (inputs.impact.bearingDeg * Math.PI) / 180;
  const impactEast =
    inputs.impact == null || impactBearing == null
      ? null
      : vesselEast + inputs.impact.distanceMeters * Math.sin(impactBearing);
  const impactNorth =
    inputs.impact == null || impactBearing == null
      ? null
      : vesselNorth + inputs.impact.distanceMeters * Math.cos(impactBearing);

  const layers: PlotLayer[] = [];
  // The reach is the site and the vessel; the dispersion ring is held in the window separately below.
  const reaches: number[] = [Math.abs(driftMeters)];
  const easts = [vesselEast, 0, ...(impactEast == null ? [] : [impactEast])];
  const norths = [
    vesselNorth,
    0,
    ...(impactNorth == null ? [] : [impactNorth]),
  ];
  if (impactEast != null) {
    reaches.push(
      Math.max(
        Math.max(...easts) - Math.min(...easts),
        Math.max(...norths) - Math.min(...norths),
      ),
    );
  }

  // The window follows the craft and the site together: it is centred between them and sized to hold both with room, never narrower than about the cone's width at the craft's height, so the craft is seen to travel toward the site. It keeps closing in until touchdown, with no height below which the picture stops changing.
  const height = Math.max(0, inputs.aglMeters ?? 0);
  const centreEast = (Math.max(...easts) + Math.min(...easts)) / 2;
  const centreNorth = (Math.max(...norths) + Math.min(...norths)) / 2;
  const halfSpan = Math.max(
    MIN_HALF_SPAN_M * (1 + SPAN_PADDING) + height * HALF_SPAN_PER_HEIGHT,
    (Math.max(...reaches) / 2) * (1 + SPAN_PADDING),
    // Room for the whole ring on the far side of the site: a ring clipped or shrunk to fit would be drawn at a size it does not have.
    zoneRadiusMeters != null && zoneRadiusMeters > 0
      ? Math.max(Math.abs(centreEast), Math.abs(centreNorth)) +
          zoneRadiusMeters / RING_ROOM
      : 0,
  );
  const window = {
    x0: centreEast - halfSpan,
    x1: centreEast + halfSpan,
    y0: centreNorth - halfSpan,
    y1: centreNorth + halfSpan,
  };
  if (zoneRadiusMeters != null && zoneRadiusMeters > 0) {
    // An outline, not a filled disc, so it hides nothing beneath it. Always at its real radius: the window is sized to hold it.
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
      description: `site ${writeQuantity(
        roundedHeight(value("m", driftMeters)),
        {
          decimals: 0,
        },
      )} downrange on bearing ${writeQuantity(value("°", driftBearingDeg), {
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
    description: siteDescription(
      slopeDeg,
      biome,
      inputs.roughnessFootprint ?? null,
    ),
  });
  if (impactEast != null && impactNorth != null) {
    layers.push(
      {
        kind: "series",
        id: "unknown-path",
        points: [
          { x: vesselEast, y: vesselNorth },
          { x: impactEast, y: impactNorth },
        ],
        tone: "neutral",
        dashed: true,
        description:
          "the path from the last reading to the crash site is unknown",
      },
      {
        kind: "marker",
        id: "vessel",
        at: { x: vesselEast, y: vesselNorth },
        shape: "ring",
        tone: "neutral",
        description: "sub-vessel point of the last reading",
      },
      {
        kind: "marker",
        id: "impact",
        at: { x: impactEast, y: impactNorth },
        shape: "cross",
        tone: "nogo",
        description: "crash site",
      },
    );
  } else {
    layers.push({
      kind: "marker",
      id: "vessel",
      at: { x: vesselEast, y: vesselNorth },
      shape: "ring",
      tone: "go",
      description: "current sub-vessel point",
    });
  }

  // The sea's surface is what a craft lands on: over an ocean the grid is held at it, so the floor's shape is not drawn as terrain, and a grid wholly under the sea is filled as water.
  const sampled = inputs.siteHeights ?? null;
  const overSea = inputs.hasOcean === true;
  const wholeSea =
    overSea &&
    sampled != null &&
    sampled.length > 0 &&
    sampled.every((h) => h < 0);
  const ground = siteRelief(
    overSea && sampled ? sampled.map((h) => Math.max(h, 0)) : sampled,
    inputs.siteHeightsSize ?? null,
    inputs.siteHeightsExtentMeters ?? null,
  );
  const half = (inputs.siteHeightsExtentMeters ?? 0) / 2;
  const size = inputs.siteHeightsSize ?? 0;
  const partSea =
    overSea &&
    !wholeSea &&
    sampled != null &&
    size > 0 &&
    half > 0 &&
    sampled.some((h) => h < 0);
  const moving = inputs.sea;
  const sea: PlotLayer[] =
    moving && (wholeSea || partSea)
      ? [
          {
            kind: "water",
            id: "sea",
            view: "plan",
            // The grid's own bounds, so the sea is shaded on the cells the land beside it is.
            bounds: { x0: -half, y0: -half, x1: half, y1: half },
            origin: moving.siteOnBody,
            gravity: moving.gravity,
            ...(moving.liquidColor ? { tint: moving.liquidColor } : {}),
            ...(wholeSea || !sampled
              ? {}
              : { sea: { size, heights: sampled } }),
            tone: "info",
            description: wholeSea
              ? "sea: the ground around the predicted site is under water"
              : "sea over part of the ground around the predicted site",
          },
        ]
      : wholeSea
        ? [
            {
              kind: "region",
              id: "sea",
              side: "below",
              boundary: [
                { x: window.x0, y: window.y1 },
                { x: window.x1, y: window.y1 },
              ],
              tone: "info",
              opacity: 0.45,
              description:
                "sea: the ground around the predicted site is under water",
            },
          ]
        : [];
  // First, so everything else is drawn over the ground, and the hatching over whatever of the window the grid does not reach.
  layers.unshift(
    ...(ground
      ? [ground, ...sea, ...unsampledAround(ground, window)]
      : [
          {
            kind: "region" as const,
            id: "unsampled",
            side: "left" as const,
            boundary: [
              { x: window.x1, y: window.y0 },
              { x: window.x1, y: window.y1 },
            ],
            tone: "neutral" as const,
            hatched: true,
            description: "no ground was sampled around the predicted site",
          },
        ]),
  );
  // The line the cross-section is cut along, from where the strip begins behind the craft to where it ends, through the craft and the site.
  const behind = inputs.trackBehindMeters;
  const ahead = inputs.trackAheadMeters;
  if (
    behind != null &&
    ahead != null &&
    Number.isFinite(behind) &&
    Number.isFinite(ahead) &&
    ahead > behind
  ) {
    const east =
      driftMeters > 0 ? -vesselEast / driftMeters : Math.sin(bearing);
    const north =
      driftMeters > 0 ? -vesselNorth / driftMeters : Math.cos(bearing);
    layers.splice(
      Math.max(
        0,
        layers.findIndex((l) => l.id === "site"),
      ),
      0,
      {
        kind: "series",
        id: "ground-track",
        points: [behind, ahead].map((d) => ({
          x: vesselEast + d * east,
          y: vesselNorth + d * north,
        })),
        tone: "neutral",
        dashed: true,
        description: "the line the cross-section is cut along",
      },
    );
  }
  return {
    subject: "touchdown-site",
    title: "Touchdown site",
    frame: {
      // A map: equal scale both ways and no tick ladder; the labelled ring carries the scale.
      kind: "spatial",
      xDomain: [window.x0, window.x1],
      xUnit: "m",
      yDomain: [window.y0, window.y1],
      yUnit: "m",
    },
    layers,
  };
}

/** Slope and biome, each only when known: an absent slope is not a flat site. */
function siteDescription(
  slopeDeg: number | null,
  biome: string | null,
  roughnessFootprint: Value<"m"> | null,
): string {
  const parts = ["predicted touchdown site"];
  if (slopeDeg != null && Number.isFinite(slopeDeg)) {
    parts.push(`${writeQuantity(value("°", slopeDeg), { decimals: 1 })} slope`);
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
function horizontalSpeedOf(
  surfaceSpeed: number | null,
  verticalSpeed: number | null,
): number | null {
  if (surfaceSpeed == null || verticalSpeed == null) return null;
  return Math.sqrt(Math.max(0, surfaceSpeed ** 2 - verticalSpeed ** 2));
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
    "crash.lastCrash",
  ],
  compute: (topics) => {
    const flight = lastValue(topics["vessel.flight"]);
    const landing = lastValue(topics["vessel.landing"]);
    const surface = lastValue(topics["vessel.surface"]);
    const orbit = lastValue(topics["vessel.orbit"]);
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
    const gravity = surfaceGravityOf(body);
    const siteLat = landing.predictedLatitude.magnitude;
    const siteLon = landing.predictedLongitude.magnitude;
    const from = {
      latitude: flight.latitude.magnitude,
      longitude: flight.longitude.magnitude,
    };
    const drift = greatCircle(
      from.latitude,
      from.longitude,
      siteLat,
      siteLon,
      body.radius,
    );
    // Read once: the zone's timing and the plot's own gate both need the height.
    const aglMeters =
      (surface?.heightFromTerrain ?? flight.altitudeTerrain)?.magnitude ?? null;
    const track = landing.groundTrackDistances?.map((d) => d.magnitude);
    const impact = crashImpactOf({
      crash: lastValue(topics["crash.lastCrash"]) ?? null,
      vesselId: lastValue(topics["vessel.identity"])?.vesselId,
      flightIsCurrent: topics["vessel.flight"].state === "observed",
      from,
      bodyRadius: body.radius,
    });
    const plot = buildTouchdownReticlePlot({
      impact,
      driftMeters: drift.distanceMeters,
      driftBearingDeg: drift.bearingDeg,
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
          mu: orbit?.mu?.magnitude ?? null,
          radiusFromCentre:
            flight.altitudeAsl?.plus(value("m", body.radius)).magnitude ?? null,
        }),
      }),
      siteHeights: landing.siteHeights?.map((h) => h.magnitude) ?? null,
      siteHeightsSize: landing.siteHeightsSize?.magnitude ?? null,
      siteHeightsExtentMeters:
        landing.siteHeightsExtentMeters?.magnitude ?? null,
      trackBehindMeters: track?.at(0) ?? null,
      trackAheadMeters: track?.at(-1) ?? null,
      slopeDeg: landing.predictedSlopeAngle?.magnitude ?? null,
      biome: landing.predictedBiome ?? null,
      hasAtmosphere: body.hasAtmosphere ?? false,
      hasOcean: body.hasOcean,
      aglMeters,
      sea:
        gravity != null
          ? {
              siteOnBody: surfaceMeters(siteLat, siteLon, body.radius),
              gravity,
              liquidColor: body.liquidColor,
            }
          : null,
      roughnessFootprint: landing.roughnessFootprintMeters ?? null,
    });
    return plot
      ? [
          {
            ...plot,
            held: drawnFrom([
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
