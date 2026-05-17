/**
 * Pure-SVG copy of the attitude dial that drives the snapshot renderer.
 * Mirrors the dial portion of `AttitudeIndicator` — horizon ribbon, pitch
 * ladder, fixed bezel, aircraft mark. The live React widget continues to
 * use AttitudeIndicator at runtime; this component exists so the dial can
 * be rendered to a self-contained SVG string via `renderAttitudeDialToSvg`
 * without dragging in DOM-only siblings (heading strip, readout cells).
 *
 * Visual changes here MUST be mirrored into AttitudeIndicator (and vice
 * versa) — they're parallel implementations of the same dial, and snapshot
 * drift here doesn't catch drift in the React-only path.
 */

export interface AttitudeDialSvgProps {
  heading: number | null;
  pitch: number | null;
  roll: number | null;
  size: number;
  /** Prefixes the internal clipPath id so multiple dials can stack in the
   *  same document without colliding. Defaults to "navball". */
  idPrefix?: string;
}

export function AttitudeDialSvg({
  heading,
  pitch,
  roll,
  size,
  idPrefix = "navball",
}: AttitudeDialSvgProps) {
  const ready = heading !== null && pitch !== null && roll !== null;
  const cx = size / 2;
  const cy = size / 2;
  const r = size / 2 - 2;

  const safePitch = pitch ?? 0;
  const safeRoll = roll ?? 0;

  const pitchScale = r / 45;
  const horizonOffset = safePitch * pitchScale;
  const clipId = `${idPrefix}-clip-${size}`;

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      role="img"
      aria-label="Attitude indicator"
      aria-hidden={!ready}
    >
      <defs>
        <clipPath id={clipId}>
          <circle cx={cx} cy={cy} r={r} />
        </clipPath>
      </defs>

      <g clipPath={`url(#${clipId})`}>
        <g transform={`rotate(${safeRoll} ${cx} ${cy})`}>
          <g transform={`translate(0 ${horizonOffset})`}>
            <rect
              x={cx - r * 2}
              y={cy - r * 2}
              width={r * 4}
              height={r * 2}
              fill="var(--color-status-info-fg)"
              opacity={0.18}
            />
            <rect
              x={cx - r * 2}
              y={cy}
              width={r * 4}
              height={r * 2}
              fill="var(--color-status-warning-bg)"
              opacity={0.18}
            />
            <line
              x1={cx - r * 2}
              y1={cy}
              x2={cx + r * 2}
              y2={cy}
              stroke="var(--color-text-primary)"
              strokeWidth={1.2}
            />
            {pitchTicks(45).map((deg) => {
              const y = cy - deg * pitchScale;
              const w = deg % 30 === 0 ? r * 0.45 : r * 0.25;
              return (
                <g key={`tick-${deg}`}>
                  <line
                    x1={cx - w}
                    y1={y}
                    x2={cx + w}
                    y2={y}
                    stroke="var(--color-text-primary)"
                    strokeWidth={0.8}
                    opacity={0.7}
                  />
                  {deg !== 0 && deg % 30 === 0 && (
                    <text
                      x={cx + w + 3}
                      y={y + 3}
                      fontSize={9}
                      fill="var(--color-text-muted)"
                    >
                      {deg > 0 ? `+${deg}` : deg}
                    </text>
                  )}
                </g>
              );
            })}
          </g>
        </g>
      </g>

      <circle
        cx={cx}
        cy={cy}
        r={r}
        fill="none"
        stroke="var(--color-surface-raised)"
        strokeWidth={1}
      />
      <g>
        <line
          x1={cx - r * 0.5}
          y1={cy}
          x2={cx - r * 0.15}
          y2={cy}
          stroke="var(--color-accent-fg)"
          strokeWidth={2}
        />
        <line
          x1={cx + r * 0.15}
          y1={cy}
          x2={cx + r * 0.5}
          y2={cy}
          stroke="var(--color-accent-fg)"
          strokeWidth={2}
        />
        <circle cx={cx} cy={cy} r={2} fill="var(--color-accent-fg)" />
      </g>
    </svg>
  );
}

function pitchTicks(extent: number): number[] {
  const out: number[] = [];
  for (let d = -extent; d <= extent; d += 10) {
    if (d === 0) continue;
    out.push(d);
  }
  return out;
}
