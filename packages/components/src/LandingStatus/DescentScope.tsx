/**
 * DescentScope — the real-time flight-instrument cluster for the landing
 * widget: the "how am I coming down" picture, sitting beside the touchdown
 * reticle. The altimeter itself is a separate full-height rail (see
 * `AltitudeRail`); this is the velocity + thrust pair.
 *
 * - Velocity vector (bespoke SVG): vertical descent vs horizontal drift as a 2D
 *   vector, so "coming down straight" vs "sliding sideways" reads at a glance.
 *   Magnitude-only for now (surface-velocity direction is not on the wire yet);
 *   the compass bearing arrives with the reticle's predicted-point drift.
 * - TWR gauge (ui-kit Gauge): can-I-even-stop, red below 1, green past 1.5.
 *
 * Purely presentational: every value is derived upstream from `solveSuicideBurn`
 * and passed in. All inputs are nullable — the scope renders a safe empty frame
 * before data arrives.
 */

import { Gauge } from "@ksp-gonogo/ui";
import { Value } from "@ksp-gonogo/ui-kit";
import { DirectionArrow } from "./DirectionArrow";

export interface DescentScopeProps {
  /** Descent rate, m/s (down-positive). */
  verticalSpeed: number | null;
  /** Horizontal component of surface velocity, m/s. */
  horizontalSpeed: number | null;
  /** Thrust-to-weight ratio (maxAccel / local gravity). */
  twr: number | null;
  /** True when AGL is the centre-of-mass radar altitude, not the lowest point. */
  usingComDatum: boolean;
}

function fmtSpeed(v: number | null): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return `${Math.round(v)} m/s`;
}

export function DescentScope({
  verticalSpeed,
  horizontalSpeed,
  twr,
  usingComDatum,
}: Readonly<DescentScopeProps>) {
  return (
    <div
      style={{
        display: "flex",
        gap: "1rem",
        alignItems: "center",
        flexWrap: "wrap",
      }}
    >
      <VelocityVector vertical={verticalSpeed} horizontal={horizontalSpeed} />
      <div>
        <Gauge
          value={twr ?? 0}
          min={0}
          max={3}
          width={110}
          height={70}
          zones={[
            { from: 0, to: 1, color: "var(--color-status-nogo-fg)" },
            { from: 1, to: 1.5, color: "var(--color-status-warning-fg)" },
            { from: 1.5, to: 3, color: "var(--color-status-go-fg)" },
          ]}
          valueLabel={twr == null ? "—" : twr.toFixed(2)}
          unitLabel="TWR"
          ariaLabel={`TWR ${twr == null ? "unknown" : twr.toFixed(2)}`}
        />
        {usingComDatum && (
          <Value tone="muted" size="xs">
            centre-of-mass altitude (lowest-point datum unavailable)
          </Value>
        )}
      </div>
    </div>
  );
}

/**
 * A compact 2D vector: descent down the y-axis, drift along the x-axis, plus the
 * resultant. Scaled so the larger component fills the box. The accessible name
 * carries both numbers so the picture is never the sole carrier.
 */
function VelocityVector({
  vertical,
  horizontal,
}: {
  vertical: number | null;
  horizontal: number | null;
}) {
  const W = 92;
  const H = 92;
  const ox = 16;
  const oy = 12;
  const maxLen = 64;
  const vDown = vertical != null && vertical > 0 ? vertical : 0;
  const vHor = horizontal != null && horizontal > 0 ? horizontal : 0;
  const scale = Math.max(vDown, vHor, 1);
  const dy = (vDown / scale) * maxLen;
  const dx = (vHor / scale) * maxLen;

  const label = `Descent ${fmtSpeed(vertical)}, drift ${fmtSpeed(horizontal)}`;

  return (
    <svg
      width={W}
      height={H}
      viewBox={`0 0 ${W} ${H}`}
      role="img"
      aria-label={label}
      style={{ display: "block", maxWidth: "100%", height: "auto" }}
    >
      <title>{label}</title>
      {/* Faint reference axes + the descent/drift legs — context for the
          direction arrow, not the star of the show. */}
      <line
        x1={ox}
        y1={oy}
        x2={ox}
        y2={H - 8}
        stroke="var(--color-border-subtle)"
        strokeWidth={1}
      />
      <line
        x1={ox}
        y1={oy}
        x2={W - 8}
        y2={oy}
        stroke="var(--color-border-subtle)"
        strokeWidth={1}
      />
      <line
        x1={ox}
        y1={oy}
        x2={ox}
        y2={oy + dy}
        stroke="var(--color-border-subtle)"
        strokeWidth={1}
        strokeDasharray="2 2"
      />
      <line
        x1={ox}
        y1={oy}
        x2={ox + dx}
        y2={oy}
        stroke="var(--color-border-subtle)"
        strokeWidth={1}
        strokeDasharray="2 2"
      />
      {/* Velocity direction: the shared DirectionArrow glyph (same as the
          reticle's slope arrow), pointing along the resultant. */}
      <DirectionArrow
        x1={ox}
        y1={oy}
        x2={ox + dx}
        y2={oy + dy}
        color="var(--color-accent-fg)"
        strokeWidth={2}
        headLength={7}
      />
      <text
        x={ox + 3}
        y={oy + dy - 2}
        fontSize={8}
        fill="var(--color-accent-fg)"
      >
        {fmtSpeed(vertical)}
      </text>
      <text
        x={ox + dx - 2}
        y={oy - 3}
        fontSize={8}
        textAnchor="end"
        fill="var(--color-status-warning-fg)"
      >
        {fmtSpeed(horizontal)}
      </text>
    </svg>
  );
}
