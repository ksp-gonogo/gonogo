import { CORE_UPLINK_CLIENT } from "@ksp-gonogo/core";
import type {
  PlotEntry,
  PlotLayer,
  TopicPayload,
} from "@ksp-gonogo/sitrep-sdk";
import { value } from "@ksp-gonogo/sitrep-sdk";
import { writeQuantity } from "@ksp-gonogo/ui-kit";
import { parentBodyFromTopics } from "../shared/streamBody";
import { greatCircle } from "./geo";
import { siteWorthPlotting } from "./siteGate";

/**
 * The terrain cross-section as a contributed plot, in real metres both ways: a side-on slice along the ground track through the predicted touchdown, with the vessel above it and its velocity drawn as where it will be in ten seconds.
 *
 * With the vessel kilometres up a small relief reads flat, because relative to the vessel it is; the top-down reticle carries relief at its own scale. The vessel sits at its real downrange displacement from the site.
 */
/** How far ahead the velocity vector is drawn, seconds: where the vessel will be, unpowered, if nothing changes. */
const VELOCITY_LOOKAHEAD_S = 10;

/** How far below the terrain's lowest point the floor sits, as a fraction of its span, so the ground reads as filled. */
const GROUND_INSET = 0.06;
/** How much taller than wide the window may get while reaching for the vessel; past it the craft is off the top. */
const MAX_TALLNESS = 1.6;
/** Sky above the vessel, so it is not drawn on the frame's own edge. */
const VESSEL_HEADROOM = 1.12;

/** Samples along the slice; the patch is bilinear-interpolated, so this is drawing resolution. */
const SLICE_STEPS = 48;

export interface CrossSectionInputs {
  /** Terrain elevations, row-major NxN, metres. */
  patch: readonly number[] | null;
  /** The N of the NxN patch. */
  patchSize: number | null;
  /** Ground width the whole patch spans, metres. */
  patchExtentMeters: number | null;
  /** Ground-track bearing to slice along, degrees clockwise from north. */
  bearingDeg: number | null;
  /** Downrange distance from the vessel to the predicted site, metres. */
  driftMeters: number | null;
  /** Height of the vessel above the terrain beneath it, metres. */
  aglMeters: number | null;
  /** Descent rate, m/s, down-positive. */
  verticalSpeed: number | null;
  /** Ground speed, m/s. */
  horizontalSpeed: number | null;
  /** Whether the parent body has an atmosphere: gates the entry phase out. */
  hasAtmosphere: boolean;
}

/** Bilinear sample of a row-major grid at continuous (col, row). */
function bilinear(
  grid: readonly number[],
  size: number,
  col: number,
  row: number,
): number {
  const x0 = Math.max(0, Math.min(size - 1, Math.floor(col)));
  const y0 = Math.max(0, Math.min(size - 1, Math.floor(row)));
  const x1 = Math.min(size - 1, x0 + 1);
  const y1 = Math.min(size - 1, y0 + 1);
  const fx = Math.max(0, Math.min(1, col - x0));
  const fy = Math.max(0, Math.min(1, row - y0));
  const a = grid[y0 * size + x0];
  const b = grid[y0 * size + x1];
  const c = grid[y1 * size + x0];
  const d = grid[y1 * size + x1];
  return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
}

export interface TerrainSlice {
  /** `{ x: metres downrange of the site, y: elevation in metres }`. */
  points: readonly { x: number; y: number }[];
  /** Elevation directly under the site, metres. */
  siteElevation: number;
  /** Half the patch's ground extent, metres: the slice runs -halfSpan..+halfSpan. */
  halfSpan: number;
}

/** The terrain profile along the ground track in real metres, or null when the patch cannot be sliced honestly (missing, short, non-finite, or with no ground extent). */
export function sliceTerrain(
  inputs: Readonly<CrossSectionInputs>,
): TerrainSlice | null {
  const { patch, patchSize, patchExtentMeters, bearingDeg } = inputs;
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

  const theta = ((bearingDeg ?? 0) * Math.PI) / 180;
  const dcol = Math.sin(theta);
  const drow = -Math.cos(theta);
  const centre = (patchSize - 1) / 2;
  const halfCells = (patchSize - 1) / 2;
  const halfSpan = patchExtentMeters / 2;
  const metresPerCell = patchExtentMeters / (patchSize - 1);

  const points: { x: number; y: number }[] = [];
  for (let i = 0; i <= SLICE_STEPS; i++) {
    const cells = -halfCells + 2 * halfCells * (i / SLICE_STEPS);
    points.push({
      x: cells * metresPerCell,
      y: bilinear(
        patch,
        patchSize,
        centre + cells * dcol,
        centre + cells * drow,
      ),
    });
  }
  return {
    points,
    siteElevation: bilinear(patch, patchSize, centre, centre),
    halfSpan,
  };
}

function fmtSpeed(v: number): string {
  return writeQuantity(value("m/s", v), { decimals: 0 });
}

/** The cross-section as a whole plot, or null when there is no honest one; no branch substitutes a zero. */
export function buildCrossSectionPlot(
  inputs: Readonly<CrossSectionInputs>,
): PlotEntry | null {
  const { aglMeters, driftMeters, verticalSpeed, horizontalSpeed } = inputs;
  if (aglMeters == null || !Number.isFinite(aglMeters)) return null;
  if (!siteWorthPlotting(inputs.hasAtmosphere, aglMeters)) return null;
  const slice = sliceTerrain(inputs);
  if (!slice) return null;

  // The vessel sits upwind of the site by its real displacement; with the drift unknown it is directly over the site.
  const vesselX =
    driftMeters != null && Number.isFinite(driftMeters) ? -driftMeters : 0;
  const groundUnderVessel = nearestGround(slice, vesselX);
  const vesselY = groundUnderVessel + aglMeters;

  const layers: PlotLayer[] = [
    {
      kind: "region",
      id: "ground",
      boundary: slice.points,
      side: "below",
      tone: "neutral",
      // Filled, so which side of the profile the vessel is on reads at a glance.
      opacity: 0.3,
      description: "terrain below the ground track",
    },
    {
      kind: "series",
      id: "skyline",
      points: slice.points,
      tone: "neutral",
      description: "terrain profile along the ground track",
    },
    {
      kind: "marker",
      id: "site",
      at: { x: 0, y: slice.siteElevation },
      shape: "cross",
      tone: "info",
      description: `predicted touchdown site at ${writeQuantity(
        value("m", slice.siteElevation),
        { decimals: 0 },
      )} elevation`,
    },
    {
      kind: "marker",
      id: "vessel",
      at: { x: vesselX, y: vesselY },
      shape: "dot",
      tone: "go",
      description: `vessel ${writeQuantity(value("m", aglMeters), {
        decimals: 0,
      })} above terrain`,
    },
  ];

  // A ten-second projection, drawn only when there is motion, so a stationary vessel gets no zero-length mark.
  const vDown = verticalSpeed != null && verticalSpeed > 0 ? verticalSpeed : 0;
  const vHor =
    horizontalSpeed != null && horizontalSpeed > 0 ? horizontalSpeed : 0;
  if (vDown > 0 || vHor > 0) {
    layers.push({
      kind: "series",
      id: "velocity",
      points: [
        { x: vesselX, y: vesselY },
        {
          x: vesselX + vHor * VELOCITY_LOOKAHEAD_S,
          y: vesselY - vDown * VELOCITY_LOOKAHEAD_S,
        },
      ],
      tone: "go",
      weight: 1.6,
      description: `descending ${fmtSpeed(vDown)}, ground speed ${fmtSpeed(
        vHor,
      )}, projected ${writeQuantity(value("s", VELOCITY_LOOKAHEAD_S))} ahead`,
    });
  }

  // The two speeds sit inside the frame corners: there is no axis to read them off.
  if (vDown > 0 || vHor > 0) {
    layers.push({
      kind: "caption",
      id: "descent-rate",
      anchor: "top-left",
      text: `↓ ${fmtSpeed(vDown)}`,
      tone: "go",
    });
    layers.push({
      kind: "caption",
      id: "ground-speed",
      anchor: "top-right",
      text: `→ ${fmtSpeed(vHor)}`,
      tone: "go",
    });
  }

  /*
   * The frame is anchored on the GROUND, spanning the patch across and the same distance up: a vessel far above the relief is simply out of the picture.
   * Equal spans both ways because the frame is spatial, so a slope drawn here is the slope.
   */
  const across = slice.halfSpan * 2;
  const groundLo = Math.min(...slice.points.map((p) => p.y));
  const floor = groundLo - across * GROUND_INSET;
  /*
   * Tall enough to hold the vessel when it fits within the cap, and otherwise not stretched at all, so the picture stays a terrain profile.
   * Equal scale survives either branch, since the arranger derives the box shape from the two spans.
   */
  const reach = (vesselY - floor) * VESSEL_HEADROOM;
  // One span used both ways, so the square box never stretches the slope.
  const span =
    reach <= across * MAX_TALLNESS ? Math.max(across, reach) : across;
  const halfWide = span / 2;

  return {
    subject: "landing-cross-section",
    title: "Cross-section",
    frame: {
      kind: "spatial",
      // Centred on the site; a patch narrower than the span stops short of the edges, the honest picture of less sampled ground.
      xDomain: [-halfWide, halfWide],
      xUnit: "m",
      yDomain: [floor, floor + span],
      yUnit: "m",
    },
    layers,
  };
}

/** Terrain elevation at the sample nearest `x`, holding the site's elevation past the patch's edge. */
function nearestGround(slice: TerrainSlice, x: number): number {
  if (x <= slice.points[0].x) return slice.points[0].y;
  const last = slice.points[slice.points.length - 1];
  if (x >= last.x) return last.y;
  let best = slice.points[0];
  for (const p of slice.points) {
    if (Math.abs(p.x - x) < Math.abs(best.x - x)) best = p;
  }
  return best.y;
}

/** Descent rate (the negated up-positive `verticalSpeed`) and the horizontal speed left of surface speed; `surf > vDown` keeps a negative out from under the root. */
function descentVelocity(
  verticalSpeed: number | null,
  surfaceSpeed: number | null,
): { verticalSpeed: number | null; horizontalSpeed: number | null } {
  if (verticalSpeed == null || !Number.isFinite(verticalSpeed)) {
    return { verticalSpeed: null, horizontalSpeed: null };
  }
  const vDown = -verticalSpeed;
  if (surfaceSpeed == null || !Number.isFinite(surfaceSpeed)) {
    return { verticalSpeed: vDown, horizontalSpeed: null };
  }
  const surf = surfaceSpeed > vDown ? surfaceSpeed : vDown;
  return {
    verticalSpeed: vDown,
    horizontalSpeed: Math.sqrt(Math.max(0, surf * surf - vDown * vDown)),
  };
}

CORE_UPLINK_CLIENT.registerContribution({
  id: "cross-section",
  contributes: "plots",
  deps: [
    "vessel.identity",
    "system.bodies",
    "vessel.flight",
    "vessel.surface",
    "vessel.landing",
  ],
  compute: (topics) => {
    const flight = topics["vessel.flight"] as
      | TopicPayload<"vessel.flight">
      | undefined;
    const surface = topics["vessel.surface"] as
      | TopicPayload<"vessel.surface">
      | undefined;
    const landing = topics["vessel.landing"] as
      | TopicPayload<"vessel.landing">
      | undefined;
    const body = parentBodyFromTopics(topics);

    // Derived here from the same two Topics an outside author would use, since a contribution has no route into the widget's copy.
    const drift =
      flight?.latitude != null &&
      flight?.longitude != null &&
      landing?.predictedLatitude != null &&
      landing?.predictedLongitude != null &&
      body?.radius != null
        ? greatCircle(
            flight.latitude.magnitude,
            flight.longitude.magnitude,
            landing.predictedLatitude.magnitude,
            landing.predictedLongitude.magnitude,
            body.radius,
          )
        : null;

    const plot = buildCrossSectionPlot({
      patch: landing?.terrainPatch?.map((h) => h.magnitude) ?? null,
      patchSize: landing?.terrainPatchSize?.magnitude ?? null,
      patchExtentMeters: landing?.terrainPatchExtentMeters?.magnitude ?? null,
      bearingDeg: drift?.bearingDeg ?? null,
      driftMeters: drift?.distanceMeters ?? null,
      aglMeters:
        surface?.heightFromTerrain?.magnitude ??
        flight?.altitudeTerrain?.magnitude ??
        null,
      hasAtmosphere: body?.hasAtmosphere ?? false,
      ...descentVelocity(
        flight?.verticalSpeed?.magnitude ?? null,
        flight?.surfaceSpeed?.magnitude ?? null,
      ),
    });
    return plot ? [plot] : null;
  },
});
