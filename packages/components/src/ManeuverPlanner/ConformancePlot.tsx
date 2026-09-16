import type { OrbitTrajectory } from "@ksp-gonogo/sitrep-client";
import { value } from "@ksp-gonogo/sitrep-sdk";
import { NULL_DISPLAY, Stack, Unit } from "@ksp-gonogo/ui-kit";
import type { CSSProperties } from "react";
import { OrbitDiagram, type ProjectedOrbit } from "../shared/OrbitDiagram";
import { TrajectoryWithheldNote } from "../shared/trajectoryWithheld";
import {
  type ConformanceRegime,
  devianceIsAttributable,
} from "./conformanceRegime";

// ---------------------------------------------------------------------------
// Two conics on one drawing: the PLANNED post-burn orbit and where the vessel
// actually is. The geometry never changes; what changes is what the GAP means.
//
// The second line is always "where the vessel is". Before ignition the gap is
// the INTENDED CHANGE and is at its largest when nothing is wrong; during the
// burn neither reading is true; only after cutoff is the gap a DEVIANCE. A plot
// that called the first of those deviation would show its worst-looking state at
// the moment everything is correct.
//
// It draws against Patches[0], the IMMEDIATE post-burn conic, and never a
// downstream patch. That is a hard limit rather than something unfinished: the
// impulsive-vs-finite residual compounds through an SOI transition, and a Deck
// capture of one real burn showed the same delta-v at the same UT on two
// barely-different starting orbits producing a final Kerbin periapsis of 10.9 km
// against 365.1 km. Against a downstream patch the gap cannot be attributed to
// anything; against Patches[0] the residual is a computable percentage.
// ---------------------------------------------------------------------------

const CAPTION: CSSProperties = {
  fontSize: "var(--font-size-2xs)",
  color: "var(--color-text-muted)",
  letterSpacing: "0.04em",
};

const REGIME_CHIP: CSSProperties = {
  fontSize: "var(--font-size-2xs)",
  fontWeight: 600,
  letterSpacing: "0.08em",
  textTransform: "uppercase",
};

/**
 * What the gap is, in the operator's words, per regime. Hues come off the
 * CATEGORICAL ramp: the plot describes a state and does not rank it, and a
 * status colour would imply the intended change is a problem.
 */
const REGIME: Record<
  ConformanceRegime,
  { chip: string; gap: string; colour: string }
> = {
  unknown: {
    chip: "Not observed",
    gap: "nothing to compare yet",
    colour: "var(--color-text-muted)",
  },
  "intended-change": {
    chip: "Planned",
    gap: "the gap is the intended change",
    colour: "var(--color-data-1)",
  },
  "in-progress": {
    chip: "Burning",
    gap: "the gap is closing as it burns",
    colour: "var(--color-data-3)",
  },
  missed: {
    chip: "Missed",
    // Deliberately the SAME sentence as intended-change, because it is the same
    // gap: nothing was delivered, so nothing has changed about what the burn
    // would still do. Only the chip differs, and it is the chip that reports the
    // window has closed. Saying so again in the caption cost the end of the
    // sentence to truncation at the default width.
    gap: "the gap is still the intended change",
    colour: "var(--color-status-warning-fg-muted)",
  },
  deviance: {
    chip: "Flown",
    gap: "the gap is the deviance",
    colour: "var(--color-data-5)",
  },
};

export interface ConformancePlotProps {
  /** The vessel's CURRENT orbit: always "where it is", whatever the regime. */
  current: {
    sma: number;
    ecc: number;
    apoapsis: number;
    periapsis: number;
    trueAnomaly: number;
    argPe: number;
  } | null;
  /**
   * The propagation seam's answer for the CURRENT orbit: whether a conic is the
   * right renderer for it at all, or a sampled arc is, or nothing may be drawn.
   * `null` means the question could not be put (no elements, no clock).
   *
   * The planned conic beside it is never gated this way. It arrives as the
   * planner's own `Patches[0]`, so it is a statement rather than this client's
   * extrapolation, and the seam was never asked about it.
   */
  currentTrajectory: OrbitTrajectory | null;
  /** The planned post-burn conic, from the burn's own `Patches[0]`. */
  planned: ProjectedOrbit | null;
  regime: ConformanceRegime;
  /**
   * Share of the burn's delta-v the impulsive plan does not account for, or
   * null when nothing models a duration. Null is NOT zero.
   */
  residual: number | null;
  /**
   * Whether the CURRENT orbit is a live observation. The planned conic is
   * AUTHORED and never dims: a plan does not go stale, it just is.
   */
  currentIsObserved: boolean;
  bodyRadius?: number | null;
}

/**
 * Where the two conics are furthest apart, and how far apart they are there.
 *
 * <p>Apoapsis, for the reason the geometry gives: a burn changes the orbit
 * most at the apsis OPPOSITE the point it was made at, and a maneuver node's
 * own instant is where the two conics still touch. So the widest part of the
 * gap is the far apsis, and its width is the difference of the two apoapsis
 * radii.</p>
 *
 * <p>Null when either conic is unbounded, or when the two coincide: a frame
 * around a gap of zero has no extent to choose and nothing to show.</p>
 */
function widestSeparation(
  current: { sma: number; ecc: number; argPe: number },
  planned: ProjectedOrbit,
): { x: number; y: number; gap: number } | null {
  if (current.ecc >= 1 || current.sma <= 0) return null;
  if (planned.ecc >= 1 || planned.sma <= 0) return null;

  const currentApR = current.sma * (1 + current.ecc);
  const plannedApR = planned.sma * (1 + planned.ecc);
  const gap = Math.abs(plannedApR - currentApR);
  if (!(gap > 0)) return null;

  // Apoapsis sits opposite the focus, and the diagram rotates by -argPe.
  const theta = (-current.argPe * Math.PI) / 180;
  return {
    x: -currentApR * Math.cos(theta),
    y: -currentApR * Math.sin(theta),
    gap,
  };
}

/**
 * How much room to give the gap in the inset. Six half-gaps puts the two
 * curves roughly a third of the frame apart, which reads as a separation
 * rather than as two curves that happen not to touch.
 */
const INSET_GAP_MULTIPLE = 6;

export function ConformancePlot({
  current,
  currentTrajectory,
  planned,
  regime,
  residual,
  currentIsObserved,
  bodyRadius,
}: ConformancePlotProps) {
  const r = REGIME[regime];
  /*
   * Only where there is a flown-versus-planned gap to look closely AT. The
   * corridor's own regime gate applies here for the same reason, and a gap of
   * zero gets no frame rather than an infinitely magnified one.
   */
  const inset =
    regime === "deviance" && current && planned
      ? widestSeparation(current, planned)
      : null;
  const attributable = devianceIsAttributable(residual);
  const withheld =
    currentTrajectory !== null && currentTrajectory.shape === "withheld"
      ? currentTrajectory
      : null;
  return (
    <Stack gap="xs" data-conformance-plot="">
      {/* The chip alone, with what the gap means carried as its title rather
          than as a second line. PLANNED / BURNING / FLOWN / MISSED already say
          which reading applies, and the sentence spelling it out was the widest
          thing in the section at the sizes this is used at. */}
      <span style={{ ...REGIME_CHIP, color: r.colour }} title={r.gap}>
        {r.chip}
      </span>
      {withheld ? (
        // The plot's whole content is a comparison against where the vessel is.
        // Drawing the planned conic on its own would put a single line on screen
        // with nothing to read it against, which is what "on plan" looks like,
        // so the drawing goes and the reason takes its place.
        <TrajectoryWithheldNote withheld={withheld} compact />
      ) : current ? (
        <div
          // Dimmed, not hidden, when the current orbit is a description rather
          // than an observation: the shape is still the best picture available.
          // The planned conic underneath is unaffected.
          style={{ opacity: currentIsObserved ? 1 : 0.55 }}
        >
          <OrbitDiagram
            // The seam's answer, drawn as given. `null` on the conic arm, where
            // the diagram's own conic renderer is what the provider said is
            // right.
            trajectoryPath={
              currentTrajectory?.shape === "arc"
                ? currentTrajectory.points
                : null
            }
            trajectoryFarEnd={
              currentTrajectory?.shape === "arc"
                ? currentTrajectory.farEnd
                : null
            }
            sma={current.sma}
            ecc={current.ecc}
            apoapsis={current.apoapsis}
            periapsis={current.periapsis}
            trueAnomaly={current.trueAnomaly}
            argPe={current.argPe}
            projected={planned}
            /*
             * ONLY under `deviance`, which is the one regime where the two
             * conics are a flown-versus-planned comparison. The others all
             * mean the opposite, in this file's own words: `intended-change`
             * and `missed` say "the gap is the intended change" and
             * `in-progress` says it "is closing as it burns". Filling those
             * would colour the burn itself and call it conformance, which is
             * the post-burn reading the ticket exists to give.
             */
            corridor={regime === "deviance"}
            bodyRadius={bodyRadius ?? undefined}
            variant="mini"
          />
        </div>
      ) : null}
      {inset && current ? (
        <div style={{ opacity: currentIsObserved ? 1 : 0.55 }}>
          {/*
            The same two curves, framed on the widest part of the gap instead
            of on the orbit that contains it. Nothing is redrawn and nothing is
            stretched: every distance inside this frame is in true proportion
            to every other, which is what separates a closer look from an
            exaggeration. The frame's SIZE is derived from the gap, so it reads
            whether the burn missed by kilometres or by metres.
          */}
          <OrbitDiagram
            sma={current.sma}
            ecc={current.ecc}
            apoapsis={current.apoapsis}
            periapsis={current.periapsis}
            trueAnomaly={current.trueAnomaly}
            argPe={current.argPe}
            projected={planned}
            corridor
            /*
             * The apsis markers are suppressed here: at this framing the
             * apoapsis dot sits exactly where the separation is, and a marker
             * scaled to the frame covers the thing the frame exists to show.
             */
            showMarkers={false}
            focus={{
              x: inset.x,
              y: inset.y,
              halfExtent: inset.gap * INSET_GAP_MULTIPLE,
            }}
            variant="mini"
          />
          <span style={CAPTION}>
            at apoapsis, flown vs planned:{" "}
            <Unit value={value("m", inset.gap)} decimals={0} /> apart
          </span>
        </div>
      ) : (
        <span style={CAPTION}>{NULL_DISPLAY} no current orbit</span>
      )}
      {/* The model's own limit, stated where the output is read rather than in a
          doc, and COMPUTED for this burn: the same sentence would be wrong at
          both ends of the range (0.03% of the delta-v for a burn spanning 2.4
          degrees of orbit, 36% for one spanning 90). */}
      <span style={CAPTION}>
        {residual == null ? (
          "impulsive plan, burn duration not modelled"
        ) : (
          <>
            impulsive plan differs by{" "}
            <Unit value={value("%", residual * 100)} decimals={2} /> of the burn
            {attributable ? "" : ": too much to read the gap as flying"}
          </>
        )}
      </span>
    </Stack>
  );
}
