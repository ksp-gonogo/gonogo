import { CORE_UPLINK_CLIENT } from "@ksp-gonogo/core";
import type {
  PlotEntry,
  PlotLayer,
  PlotPoint,
  TopicPayload,
  Value,
} from "@ksp-gonogo/sitrep-sdk";
import { value } from "@ksp-gonogo/sitrep-sdk";
import { writeQuantity } from "@ksp-gonogo/ui-kit";
import { drawnFrom, lastValue } from "../shared/drawnFrom";
import { parentBodyFromTopics } from "../shared/streamBody";
import { burnEffect } from "./burnEffect";
import { greatCircle } from "./geo";
import { elevationAt, groundPoints } from "./groundStrip";
import { surfaceGravityOf, surfaceMeters } from "./seaSurface";
import { siteWorthPlotting } from "./siteGate";

/**
 * The terrain cross-section as a contributed plot, in real metres both ways: a side-on slice of the ground along the predicted track, from beneath the vessel past the predicted touchdown, with the vessel above it and its velocity drawn as where it will be in ten seconds.
 *
 * The ground is the strip the mod samples along that track (`groundTrackDistances` and `groundTrackElevations`), so the window can hold the craft and the site together at any height. With the vessel kilometres up a small relief reads flat, because relative to the vessel it is; the top-down reticle carries the site's own character.
 */
/** How far ahead the velocity vector is drawn, seconds: where the vessel will be, unpowered, if nothing changes. */
const VELOCITY_LOOKAHEAD_S = 10;

/** How far up the frame the craft may stand at most, as a fraction of its height: the top fifth is left to the corner readouts, so the craft is never under them. */
const CRAFT_CEILING = 0.8;

/** How far up the frame the ground's average sits while the craft is far above it, as a fraction of the frame's height: the ground is at the foot of the picture. */
const GROUND_LIFT_FAR = 0.06;
/** How far up the frame the ground's average sits once the craft is down on it. */
const GROUND_LIFT_NEAR = 0.35;
/** The narrowest window, metres: close to the ground the terrain stays readable rather than zooming without end. */
const MIN_SPAN_M = 200;
/** The widest window that still holds the craft, metres; past it the craft is held on the frame's edge instead. */
const MAX_FRAME_SPAN_M = 60_000;
/** The height at which the ground is still at the foot of the frame, metres. */
const LIFT_FAR_HEIGHT_M = 8_500;
/** The height at which the ground has finished rising, metres. */
const LIFT_NEAR_HEIGHT_M = MIN_SPAN_M / 2;
/** The most the frame stretches its height over its width, as a multiple: used only when the craft and the site are too far apart for the craft's height to read at equal scale, and always labelled. */
const MAX_EXAGGERATION = 6;
/** The stretch below which the frame is called equal-scale and says nothing. */
const EXAGGERATION_QUIET = 1.05;
/** Samples taken across the window to find the ground's average within it. */
const MEAN_SAMPLES = 32;
/** The vessel mark's radius in pixels, which it is raised by when it rests on the ground. */
const VESSEL_REST_PX = 5;
/** How far above the ground, as a fraction of the frame's height, the mark stops being raised: about the mark's own size. */
const REST_FRACTION = 0.03;
/** Samples taken along the velocity line to find where it meets the ground. */
const VELOCITY_SAMPLES = 64;
/** The longest the velocity line is drawn, as a share of the frame; a faster craft's line approaches it and never passes it. */
const VELOCITY_MAX_SHARE = 0.5;
/** The flame's least length, as a share of the frame: a gentle burn is still a stub. */
const FLAME_MIN_SHARE = 0.015;
/** The flame's greatest length, as a share of the frame: twice the vessel icon's diameter, the icon being about 4.5% of the frame. */
const FLAME_MAX_SHARE = 0.09;
/** The speed a burn adds in ten seconds, m/s, at which the flame is about two thirds grown. */
const FLAME_KNEE_MPS = 30;
/** The flame's greatest half width, as a multiple of its length. */
const FLAME_WIDTH_SHARE = 0.3;
/** The vessel icon's radius as a share of the frame: the flame starts at the icon's edge, so none of it is under the mark. */
const ICON_RADIUS_SHARE = 0.0225;
/** The bearing the strip is cut along when the craft is over the site and there is no direction to it; the mod does the same. */
const DUE_EAST_DEG = 90;

/** How far up the frame the ground's average sits for a craft this high: at the foot while the craft is high, rising smoothly with the log of the height as it comes down, so the ground meets the craft rather than jumping at the end. */
function groundLift(heightMeters: number): number {
  const t = Math.max(
    0,
    Math.min(
      1,
      Math.log(LIFT_FAR_HEIGHT_M / Math.max(heightMeters, LIFT_NEAR_HEIGHT_M)) /
        Math.log(LIFT_FAR_HEIGHT_M / LIFT_NEAR_HEIGHT_M),
    ),
  );
  return GROUND_LIFT_FAR + (GROUND_LIFT_NEAR - GROUND_LIFT_FAR) * t;
}

/** The window at which the dot lattice is at its widest spacing's opposite: 0.5 of its usual gap, in metres. */
const GRID_FAR_SPAN_M = 20_000;
/** The window at which the lattice is spread to twice its usual gap, in metres. */
const GRID_NEAR_SPAN_M = 250;

/** The dot lattice's pitch as a multiple of its usual gap: 0.5 at a wide window, spreading to 2 at the narrowest. */
function gridScaleFor(span: number): number {
  const t = Math.max(
    0,
    Math.min(
      1,
      Math.log(GRID_FAR_SPAN_M / span) /
        Math.log(GRID_FAR_SPAN_M / GRID_NEAR_SPAN_M),
    ),
  );
  return 0.5 + 1.5 * t;
}

/** Room either side of what the frame holds, as a multiple, so the ground's ends and the craft are not drawn on the frame's own edge. */
const EDGE_PADDING = 1.5;

/** How far in from the frame's edge a vessel outside the window is held, as a fraction of the half-span. */
const EDGE_HOLD = 0.92;

export interface CrossSectionInputs {
  /** Distance of each ground sample along the track from beneath the vessel, metres, ascending. */
  groundDistances: readonly number[] | null;
  /** Terrain elevation at each ground sample, metres. */
  groundElevations: readonly number[] | null;
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
  /** Whether the parent body has an ocean, when the stream says: the ground is then no lower than the sea's surface, which is what the craft lands on. */
  hasOcean?: boolean;
  /** What the burn lit now does to the craft's speed, m/s squared, up and along the track; null or omitted when the engines are off or any input to it is unknown. */
  burnAccel?: { up: number; along: number } | null;
  /** How the vessel's position is known, for the shared vessel mark; current when omitted. */
  vesselMarkState?: "current" | "held" | "modelled" | "lost";
  /** Where the predicted site stands on the body, the track's bearing and the body's surface gravity: the sea is drawn as a moving surface from them, fixed to the body. Without them it is a flat fill. */
  sea?: {
    siteOnBody: { east: number; north: number };
    bearingDeg: number;
    gravity: number;
  } | null;
}

/** How far above the still surface a side view's water reaches, as a share of the frame's height, so the crests are not cut off. */
const WATER_HEADROOM = 0.03;

function fmtSpeed(v: number): string {
  return writeQuantity(value("m/s", v), { decimals: 0 });
}

/** The ground's average elevation between two window positions, from evenly spread samples of the strip; `fallback` when the window holds none of it. */
function meanElevation(
  strip: Parameters<typeof elevationAt>[0],
  drift: number,
  lo: number,
  hi: number,
  fallback: number,
): number {
  if (hi <= lo) return fallback;
  let sum = 0;
  for (let i = 0; i < MEAN_SAMPLES; i++) {
    sum += elevationAt(
      strip,
      lo + ((hi - lo) * (i + 0.5)) / MEAN_SAMPLES + drift,
    );
  }
  return sum / MEAN_SAMPLES;
}

/** The cross-section as a whole plot, or null when there is no honest one; no branch substitutes a zero. */
export function buildCrossSectionPlot(
  inputs: Readonly<CrossSectionInputs>,
): PlotEntry | null {
  const { aglMeters, driftMeters, verticalSpeed, horizontalSpeed } = inputs;
  if (aglMeters == null || !Number.isFinite(aglMeters)) return null;
  if (!siteWorthPlotting(inputs.hasAtmosphere, aglMeters)) return null;
  const sampled = groundPoints(inputs.groundDistances, inputs.groundElevations);
  if (!sampled) return null;
  // The mod reads the sea floor, below the surface; the craft's height is measured to the water. Over an ocean the ground is held at the surface, and the spans that were under it are filled as water.
  const strip =
    inputs.hasOcean === true
      ? sampled.map((p) => ({ x: p.x, y: Math.max(p.y, 0) }))
      : sampled;

  // The strip's distance 0 is beneath the vessel and the site lies `drift` along it; with the drift unknown the vessel is directly over the site.
  const drift =
    driftMeters != null && Number.isFinite(driftMeters) ? driftMeters : 0;
  const points = strip.map((p) => ({ x: p.x - drift, y: p.y }));
  const siteElevation = elevationAt(strip, drift);
  const vesselX = -drift;
  const vesselY = elevationAt(strip, 0) + aglMeters;

  /*
   * The window is the craft and the site with room around them, and the ground beneath them wherever the strip covers it: the part of the cone that matters is the part the craft is about to fly over.
   * It is centred on the craft and the site, so the cone's own reach (which a shallow descent cuts at the horizon, tens of kilometres off) never pushes the craft to an edge.
   * Both axes share one scale while the craft's height reads at it. When the craft and the site are so far apart that the height would be a sliver, the height is stretched, at most MAX_EXAGGERATION times, and a caption says so.
   * Vertically the ground's average starts at the foot and rises with the craft's height, so the ground seems to race up into the ship.
   */
  const first = points[0];
  const last = points[points.length - 1];
  const reachLeft = Math.min(vesselX, 0);
  const reachRight = Math.max(vesselX, 0);
  const centre = (reachLeft + reachRight) / 2;
  const lift = groundLift(aglMeters);
  const headroom = 1 / (CRAFT_CEILING - lift);
  const widthReach = Math.max(
    MIN_SPAN_M,
    (reachRight - reachLeft) * EDGE_PADDING,
  );
  const widthGuess = Math.min(
    MAX_FRAME_SPAN_M,
    Math.max(widthReach, aglMeters * headroom),
  );
  const groundMean = meanElevation(
    strip,
    drift,
    Math.max(first.x, centre - widthGuess / 2),
    Math.min(last.x, centre + widthGuess / 2),
    elevationAt(strip, drift - vesselX),
  );
  const heightNeeded = Math.max(
    MIN_SPAN_M,
    Math.max(0, vesselY - groundMean) * headroom,
  );
  // Past the cap the craft is held on the frame's edge below, so the frame stays the ground's.
  const span = Math.min(MAX_FRAME_SPAN_M, Math.max(widthReach, heightNeeded));
  const stretched = Math.min(
    span,
    Math.max(heightNeeded, span / MAX_EXAGGERATION),
  );
  // A stretch too slight to name is not one: the frame stays equal-scale, with the little extra room above the craft.
  const heightSpan = span / stretched < EXAGGERATION_QUIET ? span : stretched;
  const exaggeration = span / heightSpan;
  const floor = groundMean - lift * heightSpan;
  const restTaper = Math.max(0, 1 - aglMeters / heightSpan / REST_FRACTION);
  const xLo = centre - span / 2;
  const xHi = centre + span / 2;

  // Wherever the plot's width reaches past the ground that was sampled, the plot says it has no reading there.
  const unsampled: PlotLayer[] = [
    ...(xLo < first.x
      ? [
          {
            kind: "region" as const,
            id: "unsampled-left",
            side: "left" as const,
            boundary: [
              { x: first.x, y: floor },
              { x: first.x, y: floor + heightSpan },
            ],
            tone: "neutral" as const,
            hatched: true,
            description: "ground before the sampled strip is unknown",
          },
        ]
      : []),
    ...(xHi > last.x
      ? [
          {
            kind: "region" as const,
            id: "unsampled-right",
            side: "right" as const,
            boundary: [
              { x: last.x, y: floor },
              { x: last.x, y: floor + heightSpan },
            ],
            tone: "neutral" as const,
            hatched: true,
            description: "ground beyond the sampled strip is unknown",
          },
        ]
      : []),
  ];

  // Each stretch of the strip that was under the sea: from the last sample on the shore side to the next, so the water meets the shore.
  const under = sampled.map((p) => inputs.hasOcean === true && p.y < 0);
  const water: PlotLayer[] = [];
  let from = -1;
  for (let i = 0; i <= sampled.length; i++) {
    const wet = i < sampled.length && under[i];
    if (wet && from < 0) from = i;
    if (!wet && from >= 0) {
      const lo = Math.max(0, from - 1);
      const hi = Math.min(sampled.length - 1, i);
      const x0 = sampled[lo].x - drift;
      const x1 = sampled[hi].x - drift;
      const id = `sea-${water.length + 1}`;
      const description =
        water.length === 0
          ? "sea, whose surface is what the craft lands on"
          : undefined;
      water.push(
        inputs.sea
          ? {
              kind: "water",
              id,
              view: "section",
              bounds: { x0, x1, y0: floor, y1: heightSpan * WATER_HEADROOM },
              // The ground strip's own sample points, so the waterline steps as the ground line does.
              samples: points.slice(lo, hi + 1).map((p) => p.x),
              origin: inputs.sea.siteOnBody,
              bearingDeg: inputs.sea.bearingDeg,
              gravity: inputs.sea.gravity,
              tone: "info",
              description,
            }
          : {
              kind: "region",
              id,
              side: "below",
              boundary: [
                { x: x0, y: 0 },
                { x: x1, y: 0 },
              ],
              tone: "info",
              opacity: 0.4,
              description,
            },
      );
      from = -1;
    }
  }
  // The terrain line runs over land only, out to the shore sample beside it: across the sea the water draws its own surface.
  const skylines: PlotPoint[][] = [];
  let run: PlotPoint[] | null = null;
  for (let i = 0; i < points.length; i++) {
    const onLand =
      !under[i] || under[i - 1] === false || under[i + 1] === false;
    if (!onLand) {
      run = null;
      continue;
    }
    if (!run) {
      run = [];
      skylines.push(run);
    }
    run.push(points[i]);
  }

  const layers: PlotLayer[] = [
    ...water,
    {
      kind: "region",
      id: "ground",
      boundary: points,
      side: "below",
      tone: "neutral",
      // Filled, so which side of the profile the vessel is on reads at a glance.
      opacity: 0.3,
      description: "terrain below the ground track",
    },
    ...unsampled,
    ...skylines
      .filter((run) => run.length > 1)
      .map(
        (run, i): PlotLayer => ({
          kind: "series",
          id: i === 0 ? "skyline" : `skyline-${i + 1}`,
          points: run,
          tone: "neutral",
          ...(i === 0
            ? { description: "terrain profile along the ground track" }
            : {}),
        }),
      ),
    {
      kind: "marker",
      id: "site",
      at: { x: 0, y: siteElevation },
      shape: "cross",
      tone: "info",
      description: `predicted touchdown site at ${writeQuantity(
        value("m", siteElevation),
        { decimals: 0 },
      )} elevation`,
    },
    {
      kind: "marker",
      id: "vessel",
      at: { x: vesselX, y: vesselY },
      shape: "vessel",
      markState: inputs.vesselMarkState ?? "current",
      // Within a few pixels of the ground the mark is raised by its own radius, so a craft at the surface rests on it rather than half in it.
      ...(restTaper > 0 ? { offsetPx: -VESSEL_REST_PX * restTaper } : {}),
      tone: "go",
      description: `vessel ${writeQuantity(value("m", aglMeters), {
        decimals: 0,
      })} above terrain`,
    },
  ];

  /*
   * A vessel outside the window is still on the plot: held on the nearest edge, with its real height and distance beside it, so a fall that takes kilometres shows as figures running down rather than as a picture that never changes.
   */
  const top = floor + heightSpan;
  if (vesselY > top || vesselX < xLo || vesselX > xHi) {
    layers.push({
      kind: "marker",
      id: "vessel-edge",
      at: {
        x:
          centre + (Math.max(xLo, Math.min(xHi, vesselX)) - centre) * EDGE_HOLD,
        y: top - heightSpan * (1 - EDGE_HOLD),
      },
      shape: "chevron-up",
      tone: "go",
      description: `vessel above the window, ${writeQuantity(
        value("m", aglMeters),
        { decimals: 0 },
      )} above terrain`,
    });
    layers.push({
      kind: "caption",
      id: "vessel-range",
      anchor: "bottom-left",
      text: `↑ ${writeQuantity(value("m", aglMeters), { decimals: 1 })}`,
      caption: `${writeQuantity(value("m", Math.abs(vesselX)), {
        decimals: 1,
      })} ${vesselX < 0 ? "uprange" : "downrange"}`,
      tone: "go",
    });
  }

  /** Where a line from the craft, `dx` along and `dy` up, ends: at its own end, or where it meets the ground, and null when it has no length left to draw. */
  const rayFromVessel = (dx: number, dy: number) => {
    const at = (t: number) => ({ x: vesselX + dx * t, y: vesselY + dy * t });
    const clearOf = (t: number) => {
      const p = at(t);
      return p.y - elevationAt(strip, p.x + drift);
    };
    let reach = 1;
    if (clearOf(1) < 0) {
      let lo = 0;
      let hi = 1;
      for (let i = 0; i < VELOCITY_SAMPLES; i++) {
        const mid = (lo + hi) / 2;
        if (clearOf(mid) < 0) hi = mid;
        else lo = mid;
      }
      reach = lo;
    }
    return reach > 1e-6 ? at(reach) : null;
  };

  /*
   * The burn lit now, as a flame: it points the way the engine must fire, opposite to the burn's effect on the craft, and is short, a flame and not an arrow.
   * Its length is a share of the frame (the vessel icon is a fixed size, so a share of the frame stands for it), saturating with the burn so a hard one is no longer than twice the icon and a gentle one is still a stub.
   * Its direction is mapped to the screen the way the velocity line is, so a purely retrograde burn's flame runs along that line.
   */
  const burn = inputs.burnAccel;
  if (burn != null && (burn.up !== 0 || burn.along !== 0)) {
    const effect = Math.hypot(burn.up, burn.along);
    const gained = effect * VELOCITY_LOOKAHEAD_S;
    const reach =
      FLAME_MIN_SHARE +
      (FLAME_MAX_SHARE - FLAME_MIN_SHARE) *
        (1 - Math.exp(-gained / FLAME_KNEE_MPS));
    // The way the engine fires, opposite to the burn's effect, mapped to the screen as the velocity line is, so a retrograde burn's flame runs exactly along that line.
    const fireX = -burn.along / span;
    const fireY = -burn.up / heightSpan;
    const fire = Math.hypot(fireX, fireY);
    const sx = fireX / fire;
    const sy = fireY / fire;
    // A point on the flame, `along` the way it fires and `across` it, in shares of the frame, as data.
    const at = (alongShare: number, acrossShare: number) => ({
      x:
        vesselX +
        (sx * (alongShare + ICON_RADIUS_SHARE) - sy * acrossShare) * span,
      y:
        vesselY +
        (sy * (alongShare + ICON_RADIUS_SHARE) + sx * acrossShare) * heightSpan,
    });
    const half = FLAME_WIDTH_SHARE * reach;
    layers.push({
      kind: "region",
      id: "burn",
      side: "between",
      // One edge each way from the craft to the tip, swelling and then closing to a point.
      boundary: [
        at(0, half * 0.6),
        at(reach * 0.3, half),
        at(reach * 0.7, half * 0.55),
        at(reach, 0),
      ],
      boundaryHigh: [
        at(0, -half * 0.6),
        at(reach * 0.3, -half),
        at(reach * 0.7, -half * 0.55),
        at(reach, 0),
      ],
      tone: "warn",
      opacity: 0.95,
      description: `the burn lit now adds ${fmtSpeed(gained)} to the speed over ${writeQuantity(
        value("s", VELOCITY_LOOKAHEAD_S),
      )}; the engine fires the opposite way`,
    });
  }

  // A ten-second projection, drawn only when there is motion and ended where it meets the ground, so a stationary vessel gets no zero-length mark and a craft heading into the ground gets no line through it.
  const vDown = verticalSpeed != null && verticalSpeed > 0 ? verticalSpeed : 0;
  const vHor =
    horizontalSpeed != null && horizontalSpeed > 0 ? horizontalSpeed : 0;
  if (vDown > 0 || vHor > 0) {
    // Ten seconds of travel, on a curve that saturates: it is the real length while that is short, and a fast craft's line grows more and more slowly toward a share of the frame, so it stays readable. The direction is the real one.
    const dx = vHor * VELOCITY_LOOKAHEAD_S;
    const dy = -vDown * VELOCITY_LOOKAHEAD_S;
    const seen = Math.hypot(dx / span, dy / heightSpan);
    const k =
      seen > 0
        ? (VELOCITY_MAX_SHARE * Math.tanh(seen / VELOCITY_MAX_SHARE)) / seen
        : 1;
    const end = rayFromVessel(dx * k, dy * k);
    if (end) {
      layers.push({
        kind: "series",
        id: "velocity",
        points: [{ x: vesselX, y: vesselY }, end],
        tone: "go",
        weight: 1.6,
        description: `descending ${fmtSpeed(vDown)}, ground speed ${fmtSpeed(
          vHor,
        )}, projected ${writeQuantity(value("s", VELOCITY_LOOKAHEAD_S))} ahead`,
      });
    }
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

  if (exaggeration > EXAGGERATION_QUIET) {
    layers.push({
      kind: "caption",
      id: "vertical-exaggeration",
      anchor: "bottom-right",
      text: `height ×${exaggeration.toFixed(1)}`,
      tone: "neutral",
    });
  }

  return {
    subject: "landing-cross-section",
    title: "Cross-section",
    frame: {
      kind: "spatial",
      xDomain: [xLo, xHi],
      xUnit: "m",
      yDomain: [floor, floor + heightSpan],
      yUnit: "m",
      gridScale: gridScaleFor(span),
    },
    layers,
  };
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

/** How the vessel's position is known, from the currency of the flight reading: a contribution is handed a payload and never its currency. */
const FLIGHT_MARK_STATE = CORE_UPLINK_CLIENT.registerProcessor({
  id: "cross-section-vessel-mark",
  deps: [{ reading: "vessel.flight" }] as const,
  compute: ([flight]): "current" | "held" =>
    flight.state === "held" ? "held" : "current",
});

/** What a processor is handed: how current a reading is, and its payload when it has one. */
interface ReadingOf<Payload> {
  readonly state: string;
  readonly value?: Payload;
}

/**
 * The engines' push and the nose's direction, only while both are readings of now: a held reading is the last thing seen, and drawing it as the burn that is lit would be a guess.
 * Null otherwise, so no burn line is drawn.
 */
export function currentBurnState(
  propulsion: ReadingOf<
    Pick<TopicPayload<"vessel.propulsion">, "currentThrust" | "totalMass">
  >,
  attitude: ReadingOf<
    Pick<TopicPayload<"vessel.attitude">, "pitch" | "heading">
  >,
): {
  thrust: Value<"kN">;
  vesselMass: Value<"t">;
  pitch: Value<"°">;
  heading: Value<"°">;
} | null {
  if (
    propulsion.state !== "observed" ||
    attitude.state !== "observed" ||
    propulsion.value == null ||
    attitude.value == null
  ) {
    return null;
  }
  return {
    thrust: propulsion.value.currentThrust,
    vesselMass: propulsion.value.totalMass,
    pitch: attitude.value.pitch,
    heading: attitude.value.heading,
  };
}

const BURN_STATE = CORE_UPLINK_CLIENT.registerProcessor({
  id: "cross-section-burn",
  deps: [
    { reading: "vessel.propulsion" },
    { reading: "vessel.attitude" },
  ] as const,
  compute: ([propulsion, attitude]) => currentBurnState(propulsion, attitude),
});

CORE_UPLINK_CLIENT.registerContribution({
  id: "cross-section",
  contributes: "plots",
  deps: [
    "vessel.identity",
    "system.bodies",
    "vessel.flight",
    "vessel.surface",
    "vessel.landing",
    FLIGHT_MARK_STATE,
    BURN_STATE,
  ],
  compute: (topics) => {
    const flight = lastValue(topics["vessel.flight"]);
    const surface = lastValue(topics["vessel.surface"]);
    const landing = lastValue(topics["vessel.landing"]);
    const body = parentBodyFromTopics(topics);
    const markReading = topics[FLIGHT_MARK_STATE.id];
    const burnReading = topics[BURN_STATE.id];

    // Derived here from the same two Topics an outside author would use, since a contribution has no route into the widget's copy.
    const site =
      landing?.predictedLatitude != null &&
      landing?.predictedLongitude != null &&
      body?.radius != null
        ? {
            lat: landing.predictedLatitude.magnitude,
            lon: landing.predictedLongitude.magnitude,
            radius: body.radius,
          }
        : null;
    const drift =
      flight?.latitude != null && flight?.longitude != null && site != null
        ? greatCircle(
            flight.latitude.magnitude,
            flight.longitude.magnitude,
            site.lat,
            site.lon,
            site.radius,
          )
        : null;
    // The track's bearing is the one the mod cuts the strip along: toward the site, due east when the craft is over it.
    const trackBearingDeg =
      drift != null && drift.distanceMeters > 1
        ? drift.bearingDeg
        : DUE_EAST_DEG;
    const gravity = body != null ? surfaceGravityOf(body) : null;

    const plot = buildCrossSectionPlot({
      groundDistances:
        landing?.groundTrackDistances?.map((d) => d.magnitude) ?? null,
      groundElevations:
        landing?.groundTrackElevations?.map((e) => e.magnitude) ?? null,
      driftMeters: drift?.distanceMeters ?? null,
      aglMeters:
        surface?.heightFromTerrain?.magnitude ??
        flight?.altitudeTerrain?.magnitude ??
        null,
      hasAtmosphere: body?.hasAtmosphere ?? false,
      hasOcean: body?.hasOcean,
      burnAccel:
        burnReading?.state === "observed" && burnReading.value != null
          ? burnEffect({ ...burnReading.value, trackBearingDeg })
          : null,
      sea:
        site != null && gravity != null
          ? {
              siteOnBody: surfaceMeters(site.lat, site.lon, site.radius),
              bearingDeg: trackBearingDeg,
              gravity,
            }
          : null,
      vesselMarkState:
        markReading?.state === "observed" || markReading?.state === "held"
          ? markReading.value
          : undefined,
      ...descentVelocity(
        flight?.verticalSpeed?.magnitude ?? null,
        flight?.surfaceSpeed?.magnitude ?? null,
      ),
    });
    return plot
      ? [
          {
            ...plot,
            held: drawnFrom([
              topics["vessel.flight"],
              topics["vessel.surface"],
              topics["vessel.landing"],
            ]),
          },
        ]
      : null;
  },
});
