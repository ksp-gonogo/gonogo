import { CORE_UPLINK_CLIENT } from "@ksp-gonogo/core";
import type { PlotEntry, PlotLayer } from "@ksp-gonogo/sitrep-sdk";
import { value } from "@ksp-gonogo/sitrep-sdk";
import { writeQuantity } from "@ksp-gonogo/ui-kit";
import { parentBodyFromTopics } from "../shared/streamBody";
import { greatCircle } from "./geo";
import { siteWorthPlotting } from "./siteGate";

/**
 * The terrain cross-section as a contributed plot, in real metres both ways: a side-on slice of the ground along the predicted track, from beneath the vessel past the predicted touchdown, with the vessel above it and its velocity drawn as where it will be in ten seconds.
 *
 * The ground is the strip the mod samples along that track (`groundTrackDistances` and `groundTrackElevations`), so the window can hold the craft and the site together at any height. With the vessel kilometres up a small relief reads flat, because relative to the vessel it is; the top-down reticle carries the site's own character.
 */
/** How far ahead the velocity vector is drawn, seconds: where the vessel will be, unpowered, if nothing changes. */
const VELOCITY_LOOKAHEAD_S = 10;

/** How far below the terrain's lowest point the floor sits, as a fraction of the window, so the ground reads as filled. */
const GROUND_INSET = 0.06;
/** The narrowest window, metres: close to the ground the terrain stays readable rather than zooming without end. */
const MIN_SPAN_M = 200;
/** The widest window that still holds the craft, metres; past it the craft is held on the frame's edge instead. */
const MAX_FRAME_SPAN_M = 20_000;

/** The smallest 1, 2 or 5 times a power of ten that is at least `metres`. */
function zoomRung(metres: number): number {
  const decade = 10 ** Math.floor(Math.log10(metres));
  const mantissa = metres / decade;
  const rung = [1, 2, 5, 10].find((m) => m >= mantissa - 1e-9) ?? 10;
  return rung * decade;
}

/** Sky above the vessel, so it is not drawn on the frame's own edge. */
const VESSEL_HEADROOM = 1.12;

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
}

/** The ground track as points, or null when it cannot be drawn honestly (absent, mismatched, short, non-finite, or out of order). */
function groundPoints(
  distances: readonly number[] | null,
  elevations: readonly number[] | null,
): { x: number; y: number }[] | null {
  if (!distances || !elevations) return null;
  if (distances.length < 2 || distances.length !== elevations.length) {
    return null;
  }
  const points: { x: number; y: number }[] = [];
  for (let i = 0; i < distances.length; i++) {
    const d = distances[i];
    const e = elevations[i];
    if (!Number.isFinite(d) || !Number.isFinite(e)) return null;
    if (i > 0 && d <= distances[i - 1]) return null;
    points.push({ x: d, y: e });
  }
  return points;
}

/** Elevation at `x` along the strip, interpolated between its samples and held at its ends. */
function elevationAt(points: readonly { x: number; y: number }[], x: number) {
  if (x <= points[0].x) return points[0].y;
  const last = points[points.length - 1];
  if (x >= last.x) return last.y;
  for (let i = 1; i < points.length; i++) {
    if (points[i].x >= x) {
      const a = points[i - 1];
      const b = points[i];
      return a.y + ((b.y - a.y) * (x - a.x)) / (b.x - a.x);
    }
  }
  return last.y;
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
  const strip = groundPoints(inputs.groundDistances, inputs.groundElevations);
  if (!strip) return null;

  // The strip starts beneath the vessel and the site lies `drift` along it; with the drift unknown the vessel is directly over the site.
  const drift =
    driftMeters != null && Number.isFinite(driftMeters) ? driftMeters : 0;
  const points = strip.map((p) => ({ x: p.x - drift, y: p.y }));
  const siteElevation = elevationAt(strip, drift);
  const vesselX = -drift;
  const vesselY = strip[0].y + aglMeters;

  /*
   * The frame holds the vessel and the predicted site together, anchored on the GROUND at the foot, so the craft is seen to fall and travel downrange toward the site.
   * One span is used both ways because the frame is spatial: a slope drawn here is the slope.
   */
  const first = points[0];
  const last = points[points.length - 1];
  const stripWidth = last.x - first.x;
  const groundLo = Math.min(...points.map((p) => p.y));
  const floor = groundLo - Math.max(MIN_SPAN_M, stripWidth) * GROUND_INSET;
  const reachUp = (vesselY - floor) * VESSEL_HEADROOM;
  const reachLeft = Math.min(first.x, vesselX * VESSEL_HEADROOM);
  const reachRight = last.x;
  const needed = Math.max(MIN_SPAN_M, reachUp, reachRight - reachLeft);
  /*
   * The scale moves in rungs rather than continuously: a window that always fitted the craft exactly would zoom as fast as the craft falls, and the craft would never move in it.
   * Past the cap the ground would be a sliver, so the frame stays the ground's and the craft is held on its edge below.
   */
  const fits = needed <= MAX_FRAME_SPAN_M;
  const span = zoomRung(
    fits
      ? needed
      : Math.min(MAX_FRAME_SPAN_M, Math.max(MIN_SPAN_M, stripWidth)),
  );
  const centre = fits ? (reachLeft + reachRight) / 2 : (first.x + last.x) / 2;
  const xLo = centre - span / 2;
  const xHi = centre + span / 2;

  const layers: PlotLayer[] = [
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
    {
      kind: "series",
      id: "skyline",
      points,
      tone: "neutral",
      description: "terrain profile along the ground track",
    },
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
      shape: "dot",
      tone: "go",
      description: `vessel ${writeQuantity(value("m", aglMeters), {
        decimals: 0,
      })} above terrain`,
    },
  ];

  /*
   * A vessel outside the window is still on the plot: held on the nearest edge, with its real height and distance beside it, so a fall that takes kilometres shows as figures running down rather than as a picture that never changes.
   */
  const top = floor + span;
  if (vesselY > top || vesselX < xLo || vesselX > xHi) {
    layers.push({
      kind: "marker",
      id: "vessel-edge",
      at: {
        x:
          centre + (Math.max(xLo, Math.min(xHi, vesselX)) - centre) * EDGE_HOLD,
        y: top - span * (1 - EDGE_HOLD),
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

  return {
    subject: "landing-cross-section",
    title: "Cross-section",
    frame: {
      kind: "spatial",
      xDomain: [xLo, xHi],
      xUnit: "m",
      yDomain: [floor, floor + span],
      yUnit: "m",
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
    const flight = topics["vessel.flight"];
    const surface = topics["vessel.surface"];
    const landing = topics["vessel.landing"];
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
      ...descentVelocity(
        flight?.verticalSpeed?.magnitude ?? null,
        flight?.surfaceSpeed?.magnitude ?? null,
      ),
    });
    return plot ? [plot] : null;
  },
});
