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
 * The terrain cross-section, as a CONTRIBUTED PLOT, and now in metres.
 *
 * A side-on slice of the terrain along the ground track through the predicted
 * touchdown point: distance downrange on X, elevation on Y, with the vessel
 * above it and its velocity drawn as where it will be in ten seconds.
 *
 * **It did not used to be in metres, and that is the substantive change.** The
 * hand-rolled version normalised the terrain patch to 0..1 and multiplied by an
 * amplitude chosen for the box, put the vessel at `agl / (agl + 1200)` down the
 * plot and its horizontal position at a fraction of a drift full-scale. Every
 * one of those is a compression picked so the picture stays legible from three
 * kilometres down to touchdown, and the cost is that the slope it drew was not
 * the slope, the height was not the height, and no reading on it could be
 * compared with a reading on anything else.
 *
 * A `PlotFrame` has to state a domain in a unit, so the conversion forces the
 * question, and the honest answer is the one taken here. It is not free: with
 * the vessel three kilometres up, a fifty-metre relief is a flat line at the
 * bottom, because compared with three kilometres it IS flat. The top-down
 * reticle carries the relief at its own scale, and a plot that reads flat when
 * the ground is flat relative to the vessel is telling the truth about the
 * thing the operator is about to fly into.
 *
 * The vessel sits at its real downrange displacement from the site (negative,
 * upwind) rather than at a made-up fraction, so it converges on the site
 * because it is converging, not because a constant said it should.
 */

/** How far ahead the velocity vector is drawn, seconds. A vector in a metric
 *  frame needs a time to have a length, and stating one turns an arbitrary
 *  arrow into a claim: this is where the vessel will be, unpowered, in ten
 *  seconds if nothing changes. */
const VELOCITY_LOOKAHEAD_S = 10;

/** How far below the terrain's lowest point the frame's floor sits, as a
 *  fraction of its span: enough that the ground reads as filled rather than as
 *  a line balanced on the edge. */
const GROUND_INSET = 0.06;
/** How much taller than it is wide the window may get while reaching for the
 *  vessel. Past this the craft is off the top: a terrain view with a 5% band of
 *  terrain in it has stopped being one. */
const MAX_TALLNESS = 1.6;
/** Sky above the vessel, so it is not drawn on the frame's own edge. */
const VESSEL_HEADROOM = 1.12;

/** Samples taken along the slice. The patch is bilinear-interpolated, so this
 *  is a drawing resolution rather than a data one. */
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

/**
 * The terrain profile along the ground track, in real metres both ways.
 *
 * Null when the patch cannot be sliced honestly: no patch, a patch shorter than
 * it claims, a non-finite elevation in it, or no ground extent to state the X
 * axis in. A patch with no extent is the interesting one, because it is the
 * case that USED to work: without `terrainPatchExtentMeters` the old version
 * simply drew the profile across the box, which is a slice at an unknown scale.
 */
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

function fmtSpeed(v: number): string {
  return writeQuantity(value("m/s", v), { decimals: 0 });
}

/**
 * The cross-section as a whole plot, or null when there is no honest one.
 *
 * Every branch that returns null is a reading the plot would otherwise have to
 * invent: no sliceable patch, no altitude to put the vessel at. There is no
 * fallback here that substitutes a zero.
 */
export function buildCrossSectionPlot(
  inputs: Readonly<CrossSectionInputs>,
): PlotEntry | null {
  const { aglMeters, driftMeters, verticalSpeed, horizontalSpeed } = inputs;
  if (aglMeters == null || !Number.isFinite(aglMeters)) return null;
  if (!siteWorthPlotting(inputs.hasAtmosphere, aglMeters)) return null;
  const slice = sliceTerrain(inputs);
  if (!slice) return null;

  // The vessel sits UPWIND of the site by its real downrange displacement, and
  // its elevation is the ground beneath it plus its own height above it. Where
  // the drift is unknown the vessel is directly over the site rather than at a
  // guessed offset, which is the one reading this plot can honestly default.
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
      // Solid, not faint. The ground is the subject of this picture and it
      // reads as ground by being FILLED: a profile line with nothing under it
      // is a graph of a number, and which side of it you are standing on is
      // exactly what the plot is for.
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

  // The velocity vector, as a ten-second projection rather than a scaled arrow.
  // Drawn only when there is motion to draw: a stationary vessel gets no
  // zero-length mark, which would read as a mark rather than as no motion.
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

  // The two speeds, in the corners INSIDE the frame, which is where a reading
  // goes on a picture of a place: there is no gutter to put a number in and no
  // axis to read one off. They are the plot's headline facts, so they are said
  // rather than left to be inferred from the vector's angle.
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

  // The frame is anchored on the GROUND, and this is the whole difference
  // between a terrain view and an altitude chart.
  //
  // It spans the terrain patch across, the same distance up, and sits with the
  // ground near its bottom edge. A vessel three kilometres above a fifty-metre
  // relief is simply not in the picture, and that is correct: this plot is OF
  // the ground near the site. Letting the window grow to reach the vessel is
  // what turned a terrain profile into an altitude chart with the terrain as a
  // sliver along the bottom, at which point neither reading survived.
  //
  // Equal spans both ways because the frame is spatial: a slope drawn here is
  // the slope, at any tile size.
  const across = slice.halfSpan * 2;
  const groundLo = Math.min(...slice.points.map((p) => p.y));
  const floor = groundLo - across * GROUND_INSET;
  // Tall enough to hold the vessel WHEN IT FITS, and otherwise not tall at all.
  //
  // The window is anchored on the ground and stretches upward to reach the
  // craft, which keeps "you, above that" true on an approach. Past the limit it
  // does not stretch part of the way, it stops: a window opened to its cap for
  // a craft that is still nowhere near it is all sky and a smear of ground,
  // which is the same sliver as before wearing a different number. Beyond the
  // cap the craft is off the top and the picture is a terrain profile, which is
  // what it is a picture OF.
  //
  // Equal SCALE survives either branch: the arranger derives the box's shape
  // from these two spans, so the pixels stay square however tall the window is.
  const reach = (vesselY - floor) * VESSEL_HEADROOM;
  // ONE span, used both ways, because the plot is drawn in a square and equal
  // scale has to survive that: a window taller than it is wide inside a square
  // box stretches the picture, and a stretched slope is not the slope.
  const span =
    reach <= across * MAX_TALLNESS ? Math.max(across, reach) : across;
  const halfWide = span / 2;

  return {
    subject: "landing-cross-section",
    title: "Cross-section",
    frame: {
      kind: "spatial",
      // Centred on the site across, the ground at the bottom up. The patch may
      // be narrower than the span when the window stretched to reach the craft,
      // which shows as terrain that stops short of the edges: the honest
      // picture of ground we sampled less of than we are looking at.
      xDomain: [-halfWide, halfWide],
      xUnit: "m",
      yDomain: [floor, floor + span],
      yUnit: "m",
    },
    layers,
  };
}

/** Terrain elevation at the sampled point nearest `x`, falling back to the
 *  site's own elevation once past the patch's edge: beyond the sampled ground
 *  there is no terrain reading, and holding the last one is the honest
 *  extrapolation of a profile that has run out. */
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

/**
 * Descent rate and ground speed off the wire's two readings.
 *
 * `vessel.flight.verticalSpeed` is UP-positive, so descending is its negation,
 * and the horizontal component is what is left of the surface speed once the
 * vertical is taken out. The `surf > vDown` guard is `solveSuicideBurn`'s, kept
 * for its reason rather than copied: a surface speed that reads below its own
 * vertical component would put a negative under the root, and the horizontal
 * speed that falls out of that is not a reading at all.
 */
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
    const body = parentBody(topics);

    // The ground track direction and how far downrange the site is, derived
    // here rather than handed down: an outside author contributing this plot
    // would have to do the same arithmetic off the same two Topics, and there
    // is no route into the widget's own copy of it.
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
