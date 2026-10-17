import type { PlotEntry, PlotLayer } from "@ksp-gonogo/sitrep-sdk";
import { value } from "@ksp-gonogo/sitrep-sdk";
import { writeQuantity } from "@ksp-gonogo/ui-kit";
import { roundedHeight } from "./readouts";
import { siteWorthPlotting } from "./siteGate";
import {
  registerTouchdownPlot,
  siteDescription,
  type TouchdownInputs,
} from "./touchdownInputs";
import {
  bearingLabel,
  cellCentre,
  footprintAcross,
  frameFootprint,
  groundLattice,
  LATTICE_DOT,
  latticePitch,
  RING_MARK,
  SITE_MARK_SCALE,
  SITE_MARK_TONE,
  TERRAIN_BAND_METRES,
  TERRAIN_BANDS,
  TERRAIN_CELLS,
  TRACK_MARK,
  touchdownScene,
  VEIL_HIDDEN,
  VEIL_NO_DATA,
  VEIL_NONE,
  VEIL_OUTSIDE,
  zoneRing,
} from "./vesselView";

export { dispersionRadiusMeters } from "./touchdownInputs";

/**
 * The touchdown map as a contributed plot: the view from the vessel seen from above, heading up and locked to it. The frame's footprint on the ground fills a set share of the map at each height, so the map closes in as the field of view narrows and never frames ground the view does not show. The terrain is coloured over the same height range as the view's, ground the craft cannot see is desaturated or tinted, and the ring, the site and the track are drawn the way the view draws them.
 *
 * Bearings are marked round its edge in degrees, since heading up leaves north free to point anywhere, and the heading it points is written in the corner.
 */

/** The share of the map's width the frame's footprint fills at height, in the middle: most of it high up, more as the craft nears the ground, so the footprint and the marks read at the size the map is drawn and the last stretch is not a small square in a wide surround. */
const MAP_SHARE_HIGH = 0.52;
const MAP_SHARE_GROUND = 0.7;
const MAP_SHARE_KNEE_M = 150;
export function mapFootprintShare(heightMeters: number): number {
  const h = Math.max(0, heightMeters);
  return (
    MAP_SHARE_GROUND -
    ((MAP_SHARE_GROUND - MAP_SHARE_HIGH) * h) / (h + MAP_SHARE_KNEE_M)
  );
}
/** The least width of the map, metres, so a craft at the ground still has a map. */
const MIN_MAP_METRES = 16;
/** How far past the crash site the map reaches, as a multiple of its distance from the middle. */
const IMPACT_MARGIN = 1.25;
/** Points around the ring. */
const ZONE_STEPS = 72;
/** The bearings the map marks round its edge, in the margin the footprint leaves. */
const BEARING_MARKS = [0, 90, 180, 270] as const;

type Point = readonly [number, number];

/** The touchdown map as a whole plot, or null when there is no predicted site. */
export function buildTouchdownReticlePlot(
  inputs: Readonly<TouchdownInputs>,
): PlotEntry | null {
  const { driftMeters, driftBearingDeg, zoneRadiusMeters, slope, biome } =
    inputs;
  if (driftMeters == null || driftBearingDeg == null) return null;
  if (!siteWorthPlotting(inputs.hasAtmosphere, inputs.aglMeters)) return null;
  const scene = touchdownScene(inputs);
  if (!scene) return null;
  const { eye, field, camera, seen } = scene;

  // Heading up: the way the craft looks is the way the map points. `(u, v)` is right and forward of the site.
  const heading = (driftBearingDeg * Math.PI) / 180;
  const sin = Math.sin(heading);
  const cos = Math.cos(heading);
  const uOf = (x: number, y: number) => x * cos - y * sin;
  const vOf = (x: number, y: number) => x * sin + y * cos;

  // The map is the frame's footprint, centred, a third of its width across.
  const limit = field ? field.half : Math.max(1000, 4 * Math.abs(driftMeters));
  const footprint = frameFootprint(scene, limit);
  const fu = footprint.map(([x, y]) => uOf(x, y));
  const fv = footprint.map(([x, y]) => vOf(x, y));
  const cu = (Math.min(...fu) + Math.max(...fu)) / 2;
  const cv = (Math.min(...fv) + Math.max(...fv)) / 2;
  const across = Math.max(
    Math.max(...fu) - Math.min(...fu),
    Math.max(...fv) - Math.min(...fv),
  );
  // A crash site is shown with the prediction it is judged against, so the map opens wide enough to hold it.
  const impactReach = inputs.impact
    ? (() => {
        const b = (inputs.impact.bearingDeg * Math.PI) / 180;
        const x = eye[0] + inputs.impact.distanceMeters * Math.sin(b);
        const y = eye[1] + inputs.impact.distanceMeters * Math.cos(b);
        return 2 * IMPACT_MARGIN * Math.hypot(uOf(x, y) - cu, vOf(x, y) - cv);
      })()
    : 0;
  // Never wider than the grid: past its edge there is no ground to show, and the map would be mostly blank.
  const width = Math.min(
    Math.max(
      MIN_MAP_METRES,
      across / mapFootprintShare(scene.height),
      impactReach,
    ),
    field ? 2 * field.half : Number.POSITIVE_INFINITY,
  );
  const half = width / 2;
  /** A point of the ground, east and north of the site, on the map. */
  const onMap = (x: number, y: number): { x: number; y: number } => ({
    x: uOf(x, y) - cu,
    y: vOf(x, y) - cv,
  });
  const mapPoints = (points: readonly Point[]) =>
    points.map(([x, y]) => onMap(x, y));

  const layers: PlotLayer[] = [];
  if (field) {
    // The ground at each cell of the map, which is a rotated sample of the grid; a cell the grid does not carry is dark.
    const n = TERRAIN_CELLS;
    const pitch = latticePitch(footprintAcross(footprint, driftBearingDeg));
    const lo = field.min;
    const values: number[] = [];
    const veil: number[] = [];
    for (let row = 0; row < n; row++) {
      // Row 0 is the foot of the map: the relief layer's first row is its lowest.
      const mv = -half + ((row + 0.5) / n) * width;
      for (let col = 0; col < n; col++) {
        const mu = -half + ((col + 0.5) / n) * width;
        const u = mu + cu;
        const v = mv + cv;
        const x = u * cos + v * sin;
        const y = -u * sin + v * cos;
        const z = field.at(x, y);
        const zc = field.at(cellCentre(x, pitch), cellCentre(y, pitch)) ?? z;
        if (z == null || zc == null) {
          values.push(lo);
          veil.push(VEIL_NO_DATA);
          continue;
        }
        values.push(zc);
        const at = camera.project([x, y, z]);
        const inFrame =
          at != null && Math.abs(at.x) <= 1 && Math.abs(at.y) <= 1;
        veil.push(
          !inFrame ? VEIL_OUTSIDE : seen([x, y, z]) ? VEIL_NONE : VEIL_HIDDEN,
        );
      }
    }
    layers.push({
      kind: "relief",
      id: "terrain",
      values,
      veil,
      bandMetres: TERRAIN_BAND_METRES,
      size: n,
      bounds: { x0: -half, y0: -half, x1: half, y1: half },
      bands: TERRAIN_BANDS,
      description:
        "the ground around the predicted site, seen from above with the vessel's heading up: tinted where the vessel cannot see it",
    });
  } else {
    layers.push({
      kind: "region",
      id: "unsampled",
      side: "left",
      boundary: [
        { x: half, y: -half },
        { x: half, y: half },
      ],
      tone: "neutral",
      hatched: true,
      description: "no ground was sampled around the predicted site",
    });
  }
  layers.push({
    kind: "series",
    id: "frame",
    points: mapPoints([...footprint, footprint[0]]),
    tone: "caution",
    emphasis: "bright",
    weight: 3,
    description: `the ground inside the vessel's ${writeQuantity(value("°", scene.fov), { decimals: 0 })} field of view`,
  });

  // A reference fixed to the ground: as the craft moves it slides across the map, which the colours alone do not show.
  const reach = half * Math.SQRT2;
  const centreX = cu * cos + cv * sin;
  const centreY = -cu * sin + cv * cos;
  const reference = groundLattice(
    footprintAcross(footprint, driftBearingDeg),
    centreX - reach,
    centreX + reach,
    centreY - reach,
    centreY + reach,
  );
  const referenceNote = `marks on the ground every ${writeQuantity(value("m", reference.pitch), { decimals: 0 })}`;
  if (reference.points.length > 0) {
    const points = mapPoints(reference.points);
    layers.push({
      kind: "series",
      id: "lattice-dots",
      points,
      style: "scatter",
      ...LATTICE_DOT,
      description: referenceNote,
    });
  }

  if (zoneRadiusMeters != null && zoneRadiusMeters > 0) {
    // Drawn at its real size whatever the map, on the ground: a ring larger than the map runs off its edge as an arc.
    layers.push({
      kind: "series",
      id: "landing-zone",
      points: mapPoints(zoneRing(scene, zoneRadiusMeters, ZONE_STEPS)),
      ...RING_MARK,
      description: `touchdown dispersion ${writeQuantity(value("m", zoneRadiusMeters), { decimals: 0 })} across the predicted point`,
    });
  }
  // Only when there is a displacement: over the site a zero-length line would be a mark with no fact.
  if (Math.abs(driftMeters) > 0) {
    layers.push({
      kind: "series",
      id: "drift",
      points: mapPoints([
        [eye[0], eye[1]],
        [0, 0],
      ]),
      ...TRACK_MARK,
      description: `site ${writeQuantity(roundedHeight(value("m", driftMeters)), { decimals: 0 })} downrange on bearing ${writeQuantity(value("°", driftBearingDeg), { decimals: 0 })}`,
    });
  }
  const site = onMap(0, 0);
  // A ring about the cross makes the landmark that matches the two plots stand clear of the terrain.
  layers.push({
    kind: "marker",
    id: "site-ring",
    at: site,
    shape: "ring",
    scale: SITE_MARK_SCALE,
    tone: "neutral",
    emphasis: "bright",
    description: "predicted touchdown site, ringed",
  });
  layers.push({
    kind: "marker",
    id: "site",
    at: site,
    shape: "cross",
    scale: SITE_MARK_SCALE,
    tone: SITE_MARK_TONE,
    description: siteDescription(
      slope,
      biome,
      inputs.roughnessFootprint ?? null,
    ),
  });
  const craft = onMap(eye[0], eye[1]);
  const impact = inputs.impact;
  if (impact) {
    const b = (impact.bearingDeg * Math.PI) / 180;
    const x = eye[0] + impact.distanceMeters * Math.sin(b);
    const y = eye[1] + impact.distanceMeters * Math.cos(b);
    layers.push(
      {
        kind: "series",
        id: "unknown-path",
        points: mapPoints([
          [eye[0], eye[1]],
          [x, y],
        ]),
        ...TRACK_MARK,
        description:
          "the path from the last reading to the crash site is unknown",
      },
      {
        kind: "marker",
        id: "vessel",
        at: craft,
        shape: "ring",
        tone: "neutral",
        description: "sub-vessel point of the last reading",
      },
      {
        kind: "marker",
        id: "impact",
        at: onMap(x, y),
        shape: "cross",
        tone: "nogo",
        description: "crash site",
      },
    );
  } else {
    layers.push({
      kind: "marker",
      id: "vessel",
      at: craft,
      shape: "ring",
      tone: "go",
      description: "current sub-vessel point",
    });
  }
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
    const east = driftMeters > 0 ? -eye[0] / driftMeters : 1;
    const north = driftMeters > 0 ? -eye[1] / driftMeters : 0;
    layers.splice(
      Math.max(
        0,
        layers.findIndex((l) => l.id === "site"),
      ),
      0,
      {
        kind: "series",
        id: "ground-track",
        points: mapPoints(
          [behind, ahead].map(
            (d): Point => [eye[0] + d * east, eye[1] + d * north],
          ),
        ),
        tone: "neutral",
        dashed: true,
        description: "the line the cross-section is cut along",
      },
    );
  }
  // A ring larger than the map is only arcs at its corners: say how big it is.
  if (zoneRadiusMeters != null && zoneRadiusMeters > half) {
    layers.push({
      kind: "caption",
      id: "zone-size",
      anchor: "bottom-right",
      caption: "ZONE",
      text: `r ${writeQuantity(value("m", zoneRadiusMeters), { decimals: 0 })}`,
      tone: "warn",
    });
  }
  // The bearings round the map, written as the navball writes a heading: the map points the way the craft looks, so each is where that bearing lies.
  for (const bearing of BEARING_MARKS) {
    const rel = ((bearing - driftBearingDeg) * Math.PI) / 180;
    // Out to the map's edge along the bearing; the plot holds the word inside it.
    const toEdge =
      0.5 / Math.max(Math.abs(Math.sin(rel)), Math.abs(Math.cos(rel)));
    layers.push({
      kind: "marker",
      id: `bearing-${bearing}`,
      at: {
        x: Math.sin(rel) * toEdge * width,
        y: Math.cos(rel) * toEdge * width,
      },
      shape: "none",
      tone: "caution",
      label: bearingLabel(bearing),
      description: `bearing ${bearingLabel(bearing)}`,
    });
  }
  layers.push({
    kind: "caption",
    id: "heading",
    anchor: "top-left",
    // Captioned over the figure, so the corner stays narrow enough to clear the bearing written at the top edge.
    caption: "HDG",
    text: bearingLabel(driftBearingDeg),
    tone: "neutral",
  });
  return {
    subject: "touchdown-site",
    title: "Touchdown site",
    frame: {
      // A map: equal scale both ways and no tick ladder.
      kind: "spatial",
      xDomain: [-half, half],
      xUnit: "m",
      yDomain: [-half, half],
      yUnit: "m",
    },
    layers,
  };
}

registerTouchdownPlot("touchdown-reticle", buildTouchdownReticlePlot);
