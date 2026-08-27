import type { CSSProperties } from "react";
import { GraphView } from "../Graph";
import { type DescentEnvelopeInputs, descentFrame } from "./descentLayers";

/**
 * DescentEnvelope, the atmospheric descent as a velocity-altitude (V-h)
 * instrument. Speed on X, altitude-above-ground on Y (ground at the bottom, so
 * the plot's bottom edge IS the ground and there is no touchdown marker). The
 * bold curve is the TERMINAL-VELOCITY line, the equilibrium "glide" the vessel
 * settles onto, which is the canonical reentry-guidance V-h corridor view.
 *
 * This component draws NOTHING. It is a `GraphView` with the plot's axes pinned
 * and no series, and every mark on it, its own included, arrives through
 * `landing-status.plot-layers` (see `descentLayers.ts` for the widget's own
 * contribution, and the `plot-layers` vocabulary in the SDK for what a layer
 * may be). It replaced 710 hand-authored lines between `<svg>` and `</svg>`
 * that shared none of the app's axis, tick, type or spacing conventions with
 * the five other plots, and, worse, gave the host a projection no contributor
 * could reach.
 *
 * What stays this component's is the FRAME: it states once that the plot spans
 * the ground to a little above the vessel, and zero to a little past the
 * fastest speed in play. That is a policy rather than a privilege. Every layer
 * is drawn against it and clipped to it, whoever wrote the layer.
 *
 * Absence still renders as absence, and the discipline now lives one level
 * down: an unusable frame renders no plot at all rather than a plot against
 * guessed anchors, and a missing reading contributes no layer rather than a
 * layer at zero.
 */

export type {
  DescentEnvelopeInputs,
  EnvelopeUrgency,
} from "./descentLayers";
export { buildDescentLayers, classifyUrgency } from "./descentLayers";

/**
 * Four numbers, and every one of them is an AXIS input. The body's sky, the
 * drag ratio, the gravity and the Mach number are gone from this surface
 * because they are things the plot DRAWS rather than things it is scaled by,
 * and everything drawn comes through the layer seam now.
 */
export type DescentEnvelopeProps = Pick<
  DescentEnvelopeInputs,
  | "currentSpeed"
  | "currentAltitude"
  | "terminalVelocity"
  | "projectedTouchdownSpeed"
>;

/**
 * Whether the plot can be drawn: both terminal anchors positive and a positive
 * current altitude to span. Exported so the board only mounts the chart when
 * the mod's terminal-velocity model is actually present.
 */
export function canDrawEnvelope(p: Readonly<DescentEnvelopeProps>): boolean {
  return descentFrame(p) !== null;
}

/** A square box, so the plot is as wide as the column it sits in and as tall
 *  as it is wide. The fixed 160 px this replaced neither grew into a wide tile
 *  nor shrank out of a narrow one. */
const PLOT_BOX: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  aspectRatio: "1 / 1",
  minHeight: 0,
};

export function DescentEnvelope(props: Readonly<DescentEnvelopeProps>) {
  const frame = descentFrame(props);
  if (!frame) return null;

  return (
    <div style={PLOT_BOX}>
      <GraphView
        chrome="bare"
        ariaLabel="Descent envelope"
        config={{
          series: [],
          windowSec: 0,
          xDomain: frame.xDomain,
          xUnit: "m/s",
          yDomainPrimary: frame.yDomain,
          yUnit: "m",
        }}
      />
    </div>
  );
}
