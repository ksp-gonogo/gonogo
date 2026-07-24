/**
 * DescentScope — the "how am I coming in" profile beside the touchdown reticle
 * (which is the "where will I land" map). A GROUND-PERSPECTIVE side elevation:
 * imagine watching the craft descend from the ground — a horizon line, the craft
 * above it, and its velocity drawn side-on (vertical = descent rate, horizontal =
 * ground speed). The ANGLE and length of that vector read the approach at a
 * glance ("steep and fast" vs "gentle"). Paired with the TWR gauge.
 *
 * Purely presentational: values are derived upstream from `solveSuicideBurn`.
 * All inputs nullable — a safe empty frame renders before data arrives. No fake
 * 3D, no arrowheads (the origin is the craft, obvious); a clean side elevation.
 */

import { Gauge } from "@ksp-gonogo/ui";
import { Value } from "@ksp-gonogo/ui-kit";

export interface DescentScopeProps {
  /** Descent rate, m/s (down-positive). */
  verticalSpeed: number | null;
  /** Horizontal (ground) speed, m/s. */
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
      <DescentProfile vertical={verticalSpeed} horizontal={horizontalSpeed} />
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
 * Side-elevation velocity: the craft above a horizon line, its velocity vector
 * drawn in that ground-perspective frame (down = descent rate, right = ground
 * speed). The vector's slope IS the approach angle; its length is the speed.
 * The accessible name carries both numbers so the picture is never the sole
 * carrier.
 */
function DescentProfile({
  vertical,
  horizontal,
}: {
  vertical: number | null;
  horizontal: number | null;
}) {
  const W = 148;
  const H = 108;
  const ox = 40;
  const oy = 16;
  const groundY = H - 14;
  const maxLen = 74;
  const vDown = vertical != null && vertical > 0 ? vertical : 0;
  const vHor = horizontal != null && horizontal > 0 ? horizontal : 0;
  const scale = Math.max(vDown, vHor, 1);
  const dx = (vHor / scale) * maxLen;
  const dy = (vDown / scale) * maxLen;
  const tipX = ox + dx;
  const tipY = oy + dy;

  const label = `Descent ${fmtSpeed(vertical)}, ground speed ${fmtSpeed(
    horizontal,
  )}`;

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
      {/* Ground / horizon line. */}
      <line
        x1={4}
        y1={groundY}
        x2={W - 4}
        y2={groundY}
        stroke="var(--color-border-subtle)"
        strokeWidth={1.5}
      />
      {/* Faint reference: straight-down and level from the craft, so the
          velocity vector's angle reads against vertical + horizontal. */}
      <line
        x1={ox}
        y1={oy}
        x2={ox}
        y2={groundY}
        stroke="var(--color-border-subtle)"
        strokeWidth={1}
        strokeDasharray="2 3"
      />
      <line
        x1={ox}
        y1={oy}
        x2={ox + maxLen}
        y2={oy}
        stroke="var(--color-border-subtle)"
        strokeWidth={1}
        strokeDasharray="2 3"
      />
      {/* Velocity vector (green, no head) — slope = approach angle. */}
      <line
        x1={ox}
        y1={oy}
        x2={tipX}
        y2={tipY}
        stroke="var(--color-accent-fg)"
        strokeWidth={2.5}
      />
      {/* The craft, at the vector's origin. */}
      <circle cx={ox} cy={oy} r={3.5} fill="var(--color-text-primary)" />
      {/* Magnitudes. */}
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
        x={W - 4}
        y={12}
        fontSize={9}
        textAnchor="end"
        fill="var(--color-accent-fg)"
        fontFamily="monospace"
      >
        → {fmtSpeed(horizontal)}
      </text>
    </svg>
  );
}
