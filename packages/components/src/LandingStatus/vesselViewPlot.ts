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
  type Camera,
  footprintAcross,
  frameFootprint,
  groundLattice,
  type HeightField,
  LATTICE_DOT,
  LATTICE_DOT_SHARE,
  RING_MARK,
  renderTerrain,
  SITE_MARK_SCALE,
  SITE_MARK_TONE,
  skylineAt,
  TERRAIN_BAND_METRES,
  TERRAIN_BANDS,
  TERRAIN_CELLS,
  TRACK_MARK,
  touchdownScene,
  type Vec3,
  zoneRing,
} from "./vesselView";

/**
 * The view from the vessel as a contributed plot: what the craft sees looking at its predicted touchdown site, in perspective from its own position. The field of view narrows as the craft comes down, and terrain hides what lies behind it: the mod's grid of the ground between the craft and the site hides the ring and the site where a ridge stands in the way, and the horizon profile draws the relief beyond the grid as a skyline over far ground.
 *
 * The ring, the site and the ground track lie on the terrain, and the parts of them behind terrain are drawn faint instead of left out.
 */

/** Points along the ring and along the track. */
const ZONE_STEPS = 72;
const TRACK_STEPS = 64;
/** How far past the screen's edge a line is still projected, so its crossing of the edge is not cut short. */
const SCREEN_REACH = 2.5;

type Point = readonly [number, number];

/** The view from the vessel as a whole plot, or null when there is no predicted site or no height to see it from. */
export function buildVesselViewPlot(
  inputs: Readonly<TouchdownInputs>,
): PlotEntry | null {
  const { driftMeters, driftBearingDeg, zoneRadiusMeters, slope, biome } =
    inputs;
  if (driftMeters == null || driftBearingDeg == null) return null;
  if (!siteWorthPlotting(inputs.hasAtmosphere, inputs.aglMeters)) return null;
  const scene = touchdownScene(inputs);
  if (!scene) return null;
  const { camera, eye, field, siteGround, fov, skyline, groundAt, seen } =
    scene;

  // A reference fixed to the ground, laid over it: as the craft moves it slides across the view, which the colours alone do not show.
  const limit = field ? field.half : Math.max(1000, 4 * Math.abs(driftMeters));
  const footprint = frameFootprint(scene, limit);
  const xs = footprint.map(([x]) => x);
  const ys = footprint.map(([, y]) => y);
  const reference = groundLattice(
    footprintAcross(footprint, driftBearingDeg),
    Math.min(...xs),
    Math.max(...xs),
    Math.min(...ys),
    Math.max(...ys),
  );
  const layers: PlotLayer[] = [];
  const terrain = field
    ? renderTerrain(camera, field, skyline, TERRAIN_CELLS, reference.pitch)
    : null;
  if (terrain) {
    layers.push({
      kind: "relief",
      id: "terrain",
      values: terrain.values,
      veil: terrain.veil,
      bandMetres: TERRAIN_BAND_METRES,
      size: terrain.size,
      bounds: { x0: -1, y0: -1, x1: 1, y1: 1 },
      bands: TERRAIN_BANDS,
      description: `the ground seen from the vessel looking at the predicted site, ${writeQuantity(
        value("°", fov),
        { decimals: 0 },
      )} field of view`,
    });
  }
  if (skyline) layers.push(...skylineLayers(camera, skyline));

  const drawn = (
    id: string,
    ground: readonly Point[],
    mark: {
      tone: "warn" | "info" | "neutral";
      dashed: boolean;
      weight: number;
    },
    description: string,
  ) =>
    lineLayers(
      id,
      camera,
      ground.map(([x, y]) => groundAt(x, y)),
      seen,
      mark,
      description,
    );

  const referenceNote = `marks on the ground every ${writeQuantity(value("m", reference.pitch), { decimals: 0 })}`;
  const crossings = reference.points
    .map(([x, y]) => groundAt(x, y))
    .filter((p) => seen(p))
    .flatMap((p) => {
      const at = camera.project(p);
      return at && Math.abs(at.x) < 1 && Math.abs(at.y) < 1
        ? [{ x: at.x, y: at.y }]
        : [];
    });
  if (crossings.length > 0) {
    layers.push({
      kind: "series",
      id: "lattice-dots",
      points: crossings,
      style: "scatter",
      ...LATTICE_DOT,
      // The screen spans 2 units across.
      radius: 2 * LATTICE_DOT_SHARE,
      description: referenceNote,
    });
  }

  if (zoneRadiusMeters != null && zoneRadiusMeters > 0) {
    layers.push(
      ...drawn(
        "landing-zone",
        zoneRing(scene, zoneRadiusMeters, ZONE_STEPS),
        RING_MARK,
        `touchdown dispersion ${writeQuantity(value("m", zoneRadiusMeters), {
          decimals: 0,
        })} across the predicted point`,
      ),
    );
  }

  // Only when there is a displacement: over the site a zero-length line would be a mark with no fact.
  if (Math.abs(driftMeters) > 0) {
    layers.push(
      ...drawn(
        "drift",
        Array.from({ length: TRACK_STEPS }, (_, i): Point => {
          const u = i / (TRACK_STEPS - 1);
          return [eye[0] * (1 - u), eye[1] * (1 - u)];
        }),
        TRACK_MARK,
        `site ${writeQuantity(roundedHeight(value("m", driftMeters)), {
          decimals: 0,
        })} downrange on bearing ${writeQuantity(value("°", driftBearingDeg), {
          decimals: 0,
        })}`,
      ),
    );
  }

  const siteAt = camera.project([0, 0, siteGround]);
  if (siteAt) {
    // A ring about the cross makes the landmark that matches the two plots stand clear of the terrain.
    layers.push({
      kind: "marker",
      id: "site-ring",
      at: { x: siteAt.x, y: siteAt.y },
      shape: "ring",
      scale: SITE_MARK_SCALE,
      tone: SITE_MARK_TONE,
      emphasis: "bright",
      description: "predicted touchdown site, ringed",
    });
    layers.push({
      kind: "marker",
      id: "site",
      at: { x: siteAt.x, y: siteAt.y },
      shape: "cross",
      scale: SITE_MARK_SCALE,
      tone: seen([0, 0, siteGround]) ? SITE_MARK_TONE : "neutral",
      description: siteDescription(
        slope,
        biome,
        inputs.roughnessFootprint ?? null,
      ),
    });
  }

  const impact = inputs.impact;
  if (impact) {
    const b = (impact.bearingDeg * Math.PI) / 180;
    const x = eye[0] + impact.distanceMeters * Math.sin(b);
    const y = eye[1] + impact.distanceMeters * Math.cos(b);
    layers.push(
      ...drawn(
        "unknown-path",
        Array.from({ length: TRACK_STEPS }, (_, i): Point => {
          const u = i / (TRACK_STEPS - 1);
          return [eye[0] + (x - eye[0]) * u, eye[1] + (y - eye[1]) * u];
        }),
        TRACK_MARK,
        "the path from the last reading to the crash site is unknown",
      ),
    );
    const at = camera.project(groundAt(x, y));
    if (at) {
      layers.push({
        kind: "marker",
        id: "impact",
        at: { x: at.x, y: at.y },
        shape: "cross",
        tone: "nogo",
        description: "crash site",
      });
    }
  }

  // Close to the ground every ray meets ground of one colour: the craft is looking at the surface, and says so rather than leaving a blank square.
  const bandOf = (v: number) => Math.floor(v / TERRAIN_BAND_METRES);
  if (
    terrain &&
    new Set(terrain.values.filter((_, i) => terrain.veil[i] === 0).map(bandOf))
      .size < 2
  ) {
    layers.push({
      kind: "caption",
      id: "surface",
      anchor: "bottom-left",
      text: "FLAT GROUND",
      tone: "neutral",
    });
  }
  layers.push({
    kind: "caption",
    id: "heading",
    anchor: "top-right",
    text: `HDG ${bearingLabel(driftBearingDeg)}`,
    tone: "neutral",
  });
  layers.push({
    kind: "caption",
    id: "fov",
    anchor: "top-left",
    text: `FOV ${writeQuantity(value("°", fov), { decimals: 0 })}`,
    tone: "neutral",
  });

  return {
    subject: "vessel-view",
    title: "Touchdown view",
    frame: {
      // The screen of a camera: equal scale both ways and no tick ladder.
      kind: "spatial",
      xDomain: [-1, 1],
      xUnit: "",
      yDomain: [-1, 1],
      yUnit: "",
    },
    layers,
  };
}

/**
 * A line on the ground as the marks it draws: the parts the vessel sees, drawn as asked, and the parts behind terrain, drawn faint and thin, so a hidden ring is known to be there.
 */
function lineLayers(
  id: string,
  camera: Camera,
  ground: readonly Vec3[],
  seen: (p: Vec3) => boolean,
  mark: { tone: "warn" | "info" | "neutral"; dashed: boolean; weight: number },
  description: string,
): PlotLayer[] {
  const out: PlotLayer[] = [];
  for (const visible of [true, false]) {
    let run: { x: number; y: number }[] = [];
    let n = 0;
    const flush = () => {
      if (run.length > 1) {
        out.push({
          kind: "series",
          id: visible
            ? n === 0
              ? id
              : `${id}-${n + 1}`
            : `${id}-hidden${n === 0 ? "" : `-${n + 1}`}`,
          points: run,
          tone: visible ? mark.tone : "neutral",
          dashed: visible ? mark.dashed : true,
          weight: visible ? mark.weight : 0.6,
          ...(n === 0 && description
            ? {
                description: visible
                  ? description
                  : `${description}, hidden behind terrain`,
              }
            : {}),
        });
        n++;
      }
      run = [];
    };
    for (const p of ground) {
      const at = camera.project(p);
      if (
        at &&
        Math.abs(at.x) < SCREEN_REACH &&
        Math.abs(at.y) < SCREEN_REACH &&
        seen(p) === visible
      ) {
        run.push({ x: at.x, y: at.y });
      } else {
        flush();
      }
    }
    flush();
  }
  return out;
}

/** The parts of a line on the ground that the vessel sees, drawn as asked; what is hidden is left out. */
function visibleOnly(
  id: string,
  camera: Camera,
  ground: readonly Vec3[],
  seen: (p: Vec3) => boolean,
  mark: { tone: "neutral"; dashed: boolean; weight: number },
  description: string | undefined,
): PlotLayer[] {
  return lineLayers(id, camera, ground, seen, mark, description ?? "").filter(
    (l) => !l.id.includes("hidden"),
  );
}

/** The skyline as a line across the view, where the profile's bearings fall inside it. */
function skylineLayers(camera: Camera, angles: readonly number[]): PlotLayer[] {
  const out: PlotLayer[] = [];
  let run: { x: number; y: number }[] = [];
  const flush = () => {
    if (run.length > 1) {
      out.push({
        kind: "series",
        id: out.length === 0 ? "skyline" : `skyline-${out.length + 1}`,
        points: run,
        tone: "neutral",
        weight: 1,
        ...(out.length === 0
          ? {
              description:
                "the skyline the vessel sees: the highest terrain at each bearing",
            }
          : {}),
      });
    }
    run = [];
  };
  // A bearing every degree, interpolated, so the line is not a polygon of the profile's own steps.
  for (let deg = 0; deg < 360; deg += 1) {
    const e = (skylineAt(angles, deg) ?? 0) * (Math.PI / 180);
    const az = (deg * Math.PI) / 180;
    const eye = camera.eye;
    const at = camera.project([
      eye[0] + Math.sin(az) * Math.cos(e) * 1e6,
      eye[1] + Math.cos(az) * Math.cos(e) * 1e6,
      eye[2] + Math.sin(e) * 1e6,
    ]);
    if (at && Math.abs(at.x) < SCREEN_REACH && Math.abs(at.y) < SCREEN_REACH) {
      run.push({ x: at.x, y: at.y });
    } else {
      flush();
    }
  }
  flush();
  return out;
}

registerTouchdownPlot("vessel-view", buildVesselViewPlot);
