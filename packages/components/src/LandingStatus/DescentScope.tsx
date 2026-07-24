/**
 * DescentScope — the real-time flight-instrument cluster beside the touchdown
 * reticle. The altimeter is a separate full-height rail (see `AltitudeRail`);
 * this is the velocity-vs-slope compass + the TWR gauge.
 *
 * The compass is the fixed-perspective (north-up) view of the same pairing the
 * reticle overlays on the terrain: the green velocity line read against the
 * neutral downhill gradient ticks, so "am I drifting downhill / across the tilt"
 * reads without the relief. Descent rate rides as a label (it is into the page
 * in a plan view). The velocity DIRECTION uses the drift bearing (sub-vessel →
 * predicted site) since no surface-velocity bearing is on the wire yet.
 *
 * Purely presentational: every value is derived upstream from `solveSuicideBurn`
 * (+ the reticle's drift geometry) and passed in. All inputs are nullable — the
 * compass renders a safe empty frame before data arrives.
 */

import { Gauge } from "@ksp-gonogo/ui";
import { Value } from "@ksp-gonogo/ui-kit";
import { VelocitySlopeField, velocityFraction } from "./VelocitySlopeField";

export interface DescentScopeProps {
  /** Descent rate, m/s (down-positive). */
  verticalSpeed: number | null;
  /** Horizontal component of surface velocity, m/s. */
  horizontalSpeed: number | null;
  /** Thrust-to-weight ratio (maxAccel / local gravity). */
  twr: number | null;
  /** True when AGL is the centre-of-mass radar altitude, not the lowest point. */
  usingComDatum: boolean;
  /** Travel bearing (deg cw from north) for the velocity line. */
  driftBearingDeg?: number | null;
  /** Downhill bearing (deg cw from north) for the slope ticks. */
  slopeHeadingDeg?: number | null;
  /** Terrain slope at the site, degrees (labelled). */
  slopeDeg?: number | null;
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
  driftBearingDeg,
  slopeHeadingDeg,
  slopeDeg,
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
      <VelocitySlopeCompass
        vertical={verticalSpeed}
        horizontal={horizontalSpeed}
        driftBearingDeg={driftBearingDeg ?? null}
        slopeHeadingDeg={slopeHeadingDeg ?? null}
        slopeDeg={slopeDeg ?? null}
      />
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
 * The fixed-perspective velocity-vs-slope compass: a north-up plan view with the
 * green velocity line and the neutral downhill gradient ticks sharing an origin,
 * plus descent / drift / slope labels. The accessible name carries the numbers
 * so the picture is never the sole carrier.
 */
function VelocitySlopeCompass({
  vertical,
  horizontal,
  driftBearingDeg,
  slopeHeadingDeg,
  slopeDeg,
}: {
  vertical: number | null;
  horizontal: number | null;
  driftBearingDeg: number | null;
  slopeHeadingDeg: number | null;
  slopeDeg: number | null;
}) {
  const S = 118;
  const c = S / 2;
  const radius = 44;
  const slopeText = slopeDeg == null ? "" : `, ${slopeDeg.toFixed(0)}° slope`;
  const label = `Descent ${fmtSpeed(vertical)}, drift ${fmtSpeed(
    horizontal,
  )}${slopeText}`;

  return (
    <svg
      width={S}
      height={S}
      viewBox={`0 0 ${S} ${S}`}
      role="img"
      aria-label={label}
      style={{ display: "block", maxWidth: "100%", height: "auto" }}
    >
      <title>{label}</title>
      {/* Faint reference ring + origin + up tick (north-up plan view). */}
      <circle
        cx={c}
        cy={c}
        r={radius}
        fill="none"
        stroke="var(--color-border-subtle)"
        strokeWidth={1}
      />
      <line
        x1={c}
        y1={c - radius}
        x2={c}
        y2={c - radius + 6}
        stroke="var(--color-border-subtle)"
        strokeWidth={1}
      />
      <circle cx={c} cy={c} r={2} fill="var(--color-text-dim)" />

      <VelocitySlopeField
        cx={c}
        cy={c}
        radius={radius}
        velBearingDeg={driftBearingDeg}
        velFrac={velocityFraction(horizontal)}
        slopeBearingDeg={slopeHeadingDeg}
      />

      {/* Labels: descent rate + horizontal drift (colour-keyed to their glyph
          roles), slope magnitude neutral. */}
      <text
        x={4}
        y={12}
        fontSize={9}
        fill="var(--color-accent-fg)"
        fontFamily="monospace"
      >
        ↓ {fmtSpeed(vertical)}
      </text>
      <text
        x={S - 4}
        y={12}
        fontSize={9}
        textAnchor="end"
        fill="var(--color-accent-fg)"
        fontFamily="monospace"
      >
        → {fmtSpeed(horizontal)}
      </text>
      {slopeDeg != null && (
        <text
          x={c}
          y={S - 4}
          fontSize={9}
          textAnchor="middle"
          fill="var(--color-text-dim)"
          fontFamily="monospace"
        >
          {slopeDeg.toFixed(0)}° slope
        </text>
      )}
    </svg>
  );
}
