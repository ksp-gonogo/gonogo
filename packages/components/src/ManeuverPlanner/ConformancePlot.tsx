import type { OrbitTrajectory } from "@ksp-gonogo/sitrep-client";
import { value } from "@ksp-gonogo/sitrep-sdk";
import {
  Cluster,
  NULL_DISPLAY,
  Stack,
  Truncate,
  Unit,
} from "@ksp-gonogo/ui-kit";
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
            bodyRadius={bodyRadius ?? undefined}
            variant="mini"
          />
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
