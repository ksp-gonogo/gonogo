import { CORE_UPLINK_CLIENT, getBody } from "@ksp-gonogo/core";
import type {
  PlotEntry,
  PlotLayer,
  TopicPayload,
} from "@ksp-gonogo/sitrep-sdk";
import { Situation, value } from "@ksp-gonogo/sitrep-sdk";
import { writeQuantity } from "@ksp-gonogo/ui-kit";
import { solveSuicideBurn } from "./solveLanding";

/**
 * The altitude rail, as a CONTRIBUTED PLOT: height above terrain up the Y axis,
 * with the suicide-burn ignition band shaded as the hot zone the vessel is
 * descending into.
 *
 * It is the one of the four that was not a plot at all. It was a `Tape`, a
 * full-height gauge pinned down the widget's edge, and the conversion costs it
 * that: it is a narrow plot in the row with its siblings now, not a sticky rail
 * that stays put while the readouts beside it scroll. That is a real loss and
 * worth naming rather than discovering in a render. What it buys is that the
 * ignition altitude and the vessel's height are drawn on ONE stated scale, in
 * metres, in the same frame as the two altimetry plots beside it, so a glance
 * across them compares like with like.
 *
 * X is a bare 0..1 with no unit, because a one-dimensional reading has no
 * second axis and pretending otherwise would put a tick ladder under it that
 * measured nothing. Everything is drawn at mid-span.
 */

/** Where the marks sit across the plot's one nominal unit of width. */
const MID = 0.5;
/** Headroom above the higher of the vessel and the ignition altitude. */
const CEILING_HEADROOM = 1.15;
/** Below this many seconds to ignition the cue is urgent rather than a note. */
const IGNITION_IMMINENT_S = 5;

export interface AltitudeRailInputs {
  /** Height of the vessel's lowest point above terrain, metres. */
  aglMeters: number | null;
  /** AGL at which the suicide burn must begin, metres. */
  ignitionAltitude: number | null;
  /** Seconds to the latest ignition. */
  suicideBurnCountdown: number | null;
  /** True once the vessel is down: the burn cues are void, not merely absent. */
  landed: boolean;
}

/**
 * The rail as a whole plot, or null when there is no altitude to draw.
 *
 * A rail with no AGL is not an empty scale, it is no rail: the axis, the band
 * and the marker are all stated relative to a height that does not exist. The
 * old `Tape` rendered a "safe empty scale" in that case, which is a ladder of
 * tick labels around no reading, and it is exactly the shape of thing this
 * framework treats as absence rendered as zero.
 */
export function buildAltitudeRailPlot(
  inputs: Readonly<AltitudeRailInputs>,
): PlotEntry | null {
  const { aglMeters, landed } = inputs;
  if (aglMeters == null || !Number.isFinite(aglMeters) || aglMeters <= 0) {
    return null;
  }
  // A grounded vessel's ignition altitude and countdown describe a burn that is
  // not going to happen. Suppressed rather than drawn faint: a hot band under a
  // landed craft is a cue to act.
  const ignition =
    !landed &&
    inputs.ignitionAltitude != null &&
    inputs.ignitionAltitude > 0 &&
    Number.isFinite(inputs.ignitionAltitude)
      ? inputs.ignitionAltitude
      : null;
  const countdown = landed ? null : inputs.suicideBurnCountdown;

  const ceiling = Math.max(aglMeters, ignition ?? 0) * CEILING_HEADROOM;
  const layers: PlotLayer[] = [];

  if (ignition != null) {
    const imminent =
      countdown != null && countdown <= IGNITION_IMMINENT_S && countdown > 0;
    layers.push({
      kind: "region",
      id: "burn-band",
      boundary: [
        { x: 0, y: 0 },
        { x: 1, y: 0 },
      ],
      boundaryHigh: [
        { x: 0, y: ignition },
        { x: 1, y: ignition },
      ],
      side: "between",
      tone: "nogo",
      emphasis: imminent ? "bright" : "normal",
      label: "burn",
      description: `suicide burn must begin by ${writeQuantity(
        value("m", ignition),
        { decimals: 0 },
      )} above terrain`,
    });
    layers.push({
      kind: "rule",
      id: "ignition",
      along: "y",
      value: ignition,
      tone: "nogo",
      dashed: true,
    });
  }

  layers.push({
    kind: "marker",
    id: "vessel",
    at: { x: MID, y: aglMeters },
    shape: "chevron-down",
    tone: "go",
    // No `decimals: 0` here, unlike the band's own clause. This IS the rail's
    // reading, and at kilometre scale a whole-number metre count rounds 4800
    // and 5000 to the same three characters: the one thing a screen-reader
    // user would be using this label to tell apart.
    description: `${writeQuantity(value("m", aglMeters))} above terrain`,
  });

  // The cue, in the corner, and it says one of three DIFFERENT things: a burn
  // that has not started, a burn whose moment has passed, and no burn to make.
  // The old rail collapsed the last two into "no burn", which reads as safety
  // where it means the opposite.
  if (countdown != null && Number.isFinite(countdown)) {
    layers.push({
      kind: "caption",
      id: "ignition-cue",
      anchor: "bottom-left",
      caption: "ignite in",
      text:
        countdown <= 0
          ? "PAST"
          : writeQuantity(value("s", Math.ceil(countdown))),
      tone: countdown <= IGNITION_IMMINENT_S ? "nogo" : "warn",
      description:
        countdown <= 0
          ? "past the latest ignition point"
          : `ignition in ${writeQuantity(value("s", Math.ceil(countdown)))}`,
    });
  }

  return {
    id: "altitude-rail",
    title: "Altitude",
    // Tall and narrow: this is a one-dimensional instrument and the shape says
    // so before any of the marks do.
    aspect: 0.34,
    frame: {
      // A nominal span, and the axis under it is suppressed for that reason:
      // there is nothing measured across an altitude scale.
      xDomain: [0, 1],
      hideXAxis: true,
      yDomain: [0, ceiling],
      yUnit: "m",
    },
    layers,
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
  id: "altitude-rail",
  contributes: "plots",
  deps: [
    "vessel.identity",
    "system.bodies",
    "vessel.flight",
    "vessel.surface",
    "vessel.orbit",
    "vessel.propulsion",
    "dv.summary",
  ],
  compute: (topics) => {
    const flight = topics["vessel.flight"] as
      | TopicPayload<"vessel.flight">
      | undefined;
    const surface = topics["vessel.surface"] as
      | TopicPayload<"vessel.surface">
      | undefined;
    const orbit = topics["vessel.orbit"] as
      | TopicPayload<"vessel.orbit">
      | undefined;
    const propulsion = topics["vessel.propulsion"] as
      | TopicPayload<"vessel.propulsion">
      | undefined;
    const identity = topics["vessel.identity"] as
      | TopicPayload<"vessel.identity">
      | undefined;
    const body = parentBody(topics);

    const aglMeters =
      surface?.heightFromTerrain?.magnitude ??
      flight?.altitudeTerrain?.magnitude ??
      null;

    // The burn solve, run here rather than handed down. It is the widget's own
    // solver, but the widget is not in the chain: this contribution reads the
    // same Topics and calls the same pure function, which is what an author
    // outside the repo would have to do with their own.
    const solution = solveSuicideBurn({
      heightFromTerrain: aglMeters ?? undefined,
      altitudeAsl: flight?.altitudeAsl?.magnitude,
      verticalSpeed: flight?.verticalSpeed?.magnitude,
      surfaceSpeed: flight?.surfaceSpeed?.magnitude,
      mu: orbit?.mu?.magnitude,
      bodyRadius: body?.radius,
      availableThrust: propulsion?.availableThrust?.magnitude,
      totalMass: propulsion?.totalMass?.magnitude,
    });

    const plot = buildAltitudeRailPlot({
      aglMeters,
      ignitionAltitude: solution.ignitionAltitude,
      suicideBurnCountdown: solution.suicideBurnCountdown,
      // `landedAt` is the direct signal (the site KSP records a vessel as being
      // down at); the situation ordinal backs it up where a source populates
      // that instead. Pre-launch counts: a craft on the pad is not descending.
      landed:
        surface?.landedAt != null ||
        identity?.situation === Situation.Landed ||
        identity?.situation === Situation.Splashed ||
        identity?.situation === Situation.PreLaunch,
    });
    return plot ? [plot] : null;
  },
});
