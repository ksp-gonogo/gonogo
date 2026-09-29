import type { OrbitTrajectory } from "@ksp-gonogo/sitrep-client";
import { value } from "@ksp-gonogo/sitrep-sdk";
import { FramedDisplay, NULL_DISPLAY, Stack, Unit } from "@ksp-gonogo/ui-kit";
import type { CSSProperties } from "react";
import { OrbitDiagram, type ProjectedOrbit } from "../shared/OrbitDiagram";
import { TrajectoryWithheldNote } from "../shared/trajectoryWithheld";
import {
  type ConformanceRegime,
  devianceIsAttributable,
} from "./conformanceRegime";
import { widestSeparation } from "./widestSeparation";

/*
 * Two conics on one drawing: the planned post-burn orbit and where the vessel
 * is. Before ignition the gap is the intended change, during the burn it is
 * neither, and only after cutoff is it a deviance. Drawn against Patches[0]
 * only: the impulsive-vs-finite residual compounds through an SOI transition,
 * so a gap against a downstream patch cannot be attributed to anything.
 */

const CAPTION: CSSProperties = {
  fontSize: "var(--font-size-caption)",
  color: "var(--color-text-muted)",
  letterSpacing: "0.04em",
};

const REGIME_CHIP: CSSProperties = {
  fontSize: "var(--font-size-caption)",
  fontWeight: 600,
  letterSpacing: "0.08em",
  textTransform: "uppercase",
};

/** What the gap means per regime; categorical hues, since a status colour would call the intended change a problem. */
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
    // Nothing was delivered, so this is the same gap as intended-change; the chip says the window closed.
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
   * The propagation seam's answer for the current orbit (conic, sampled arc or
   * withheld), `null` when it could not be asked. The planned conic is the
   * planner's own statement and is never gated.
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
   * AUTHORED and never dims: a plan does not be held, it just is.
   */
  currentIsObserved: boolean;
  bodyRadius?: number | null;
}

const INSET_GAP_MULTIPLE = 6;

/**
 * The widest gap, as a share of the orbit, that still needs a closer look. A
 * mini-variant conic strokes at 0.012 of the extent, so the main frame cannot
 * show a gap narrower than about three strokes; above that, the detail frame
 * (six half-gaps across) would outgrow the orbit.
 */
const INSET_SHOWN_BELOW_EXTENT_FRACTION = 0.036;

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
  const separation =
    regime === "deviance" && current && planned
      ? widestSeparation(current, planned)
      : null;
  // Only where the main frame cannot already show the gap.
  const inset =
    separation &&
    current !== null &&
    current.apoapsis > 0 &&
    separation.gap / current.apoapsis < INSET_SHOWN_BELOW_EXTENT_FRACTION
      ? separation
      : null;
  const attributable = devianceIsAttributable(residual);
  const withheld =
    currentTrajectory !== null && currentTrajectory.shape === "withheld"
      ? currentTrajectory
      : null;
  return (
    <Stack data-conformance-plot="">
      <span style={{ ...REGIME_CHIP, color: r.colour }} title={r.gap}>
        {r.chip}
      </span>
      {withheld ? (
        // A lone planned conic, with nothing to read it against, would look like "on plan".
        <TrajectoryWithheldNote withheld={withheld} compact />
      ) : current ? (
        <div
          // Dimmed, not hidden, when the current orbit is described rather than observed.
          style={{ opacity: currentIsObserved ? 1 : 0.55 }}
        >
          <FramedDisplay>
            <OrbitDiagram
              // The seam's arc when it gave one; null lets the diagram draw its own conic.
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
              // Only a deviance is a flown-versus-planned comparison; filling any other regime would colour the burn itself.
              corridor={regime === "deviance"}
              bodyRadius={bodyRadius ?? undefined}
              variant="mini"
            />
          </FramedDisplay>
        </div>
      ) : (
        <span style={CAPTION}>{NULL_DISPLAY} no current orbit</span>
      )}
      {inset && current ? (
        <div style={{ opacity: currentIsObserved ? 1 : 0.55 }}>
          {/* Named, so it reads as a closer look at the plot above rather than another plot. */}
          <span style={CAPTION}>detail: widest gap, true scale</span>
          {/* A strip: the width carries the separation, and OrbitDiagram fits its viewBox to the box's aspect. */}
          <FramedDisplay
            style={{ width: "100%", aspectRatio: "5 / 2", display: "flex" }}
          >
            {/* The same two curves framed on the widest gap, in true proportion; the frame size derives from the gap. */}
            <OrbitDiagram
              sma={current.sma}
              ecc={current.ecc}
              apoapsis={current.apoapsis}
              periapsis={current.periapsis}
              trueAnomaly={current.trueAnomaly}
              argPe={current.argPe}
              projected={planned}
              corridor
              // At this framing the apoapsis marker would cover the separation.
              showMarkers={false}
              focus={{
                x: inset.x,
                y: inset.y,
                halfExtent: inset.gap * INSET_GAP_MULTIPLE,
                // Lays the arc along the strip, using the focus point's own bearing as the apsis direction.
                rotationDeg:
                  90 - (Math.atan2(inset.y, inset.x) * 180) / Math.PI,
              }}
              variant="mini"
            />
          </FramedDisplay>
          <span style={CAPTION}>
            widest gap, flown vs planned:{" "}
            <Unit value={value("m", inset.gap)} decimals={0} /> apart
          </span>
        </div>
      ) : null}
      {/* Computed per burn: 0.03% of the delta-v across 2.4 degrees of orbit, 36% across 90. */}
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
