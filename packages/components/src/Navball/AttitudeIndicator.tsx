import styled from "styled-components";

export interface AttitudeIndicatorProps {
  heading: number | null;
  pitch: number | null;
  roll: number | null;
  /** Pixels — the dial draws into a square, taking the smaller of w/h. */
  size: number;
}

/**
 * Compact attitude indicator — not a full 8-ball, but pulls together the
 * three primary attitude readouts in a way that reads at a glance:
 *
 *   - The horizon ribbon rolls and pitches inside a circular viewport,
 *     with hash marks every 10° of pitch.
 *   - A heading rose strip sits below, scrolling so the current heading
 *     sits at the centre.
 *
 * Markers (prograde, retrograde, normal etc.) are deferred — they need
 * direction vectors that Telemachus doesn't expose for a compact projection,
 * and the attitude readouts here already cover the GNC use-case for v1.
 */
export function AttitudeIndicator({
  heading,
  pitch,
  roll,
  size,
}: AttitudeIndicatorProps) {
  const ready = heading !== null && pitch !== null && roll !== null;
  const cx = size / 2;
  const cy = size / 2;
  const r = size / 2 - 2;

  const safePitch = pitch ?? 0;
  const safeRoll = roll ?? 0;
  const safeHeading = heading ?? 0;

  // 1° of pitch = pitchScale px on the horizon ribbon. Tuned so ±30°
  // covers most of the viewport without horizon-bar disappearing on
  // climbs.
  const pitchScale = r / 45;
  const horizonOffset = safePitch * pitchScale;

  // Heading band: 1° = 4px gives ~120° of context across a 480px-equivalent
  // strip; we scale relative to size so smaller widgets compress.
  const headingPxPerDeg = size / 90;
  const headingTickEvery = 10;

  return (
    <Wrap aria-hidden={!ready}>
      <Dial>
        <svg
          width={size}
          height={size}
          viewBox={`0 0 ${size} ${size}`}
          role="img"
          aria-label="Attitude indicator"
        >
          <defs>
            <clipPath id={`navball-clip-${size}`}>
              <circle cx={cx} cy={cy} r={r} />
            </clipPath>
          </defs>

          <g clipPath={`url(#navball-clip-${size})`}>
            <g transform={`rotate(${safeRoll} ${cx} ${cy})`}>
              <g transform={`translate(0 ${horizonOffset})`}>
                {/* Sky */}
                <rect
                  x={cx - r * 2}
                  y={cy - r * 2}
                  width={r * 4}
                  height={r * 2}
                  fill="var(--color-status-info-fg)"
                  opacity={0.18}
                />
                {/* Ground */}
                <rect
                  x={cx - r * 2}
                  y={cy}
                  width={r * 4}
                  height={r * 2}
                  fill="var(--color-status-warning-bg)"
                  opacity={0.18}
                />
                {/* Horizon */}
                <line
                  x1={cx - r * 2}
                  y1={cy}
                  x2={cx + r * 2}
                  y2={cy}
                  stroke="var(--color-text-primary)"
                  strokeWidth={1.2}
                />
                {/* Pitch ladder — every 10°, ± 60°. */}
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

          {/* Fixed bezel: aircraft mark + roll scale */}
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
      </Dial>

      <HeadingStrip>
        <HeadingTicker
          // The ticker shares the strip's width (inset:0), so translateX(50%)
          // shifts the whole tick row right by stripWidth/2 — combined with
          // the per-degree shift this puts the current-heading tick directly
          // under the centred pointer instead of at the strip's left edge.
          style={{
            transform: `translateX(calc(50% - ${safeHeading * headingPxPerDeg}px))`,
          }}
        >
          {headingMarkers(headingTickEvery).map((deg) => (
            <HeadingTick
              key={deg}
              style={{
                left: `${deg * headingPxPerDeg}px`,
              }}
            >
              <HeadingTickMark />
              {deg % 30 === 0 && <HeadingTickLabel>{deg}</HeadingTickLabel>}
            </HeadingTick>
          ))}
        </HeadingTicker>
        <HeadingPointer />
      </HeadingStrip>

      <Readout>
        <Cell>
          <Lab>HDG</Lab>
          <Val>{ready ? `${safeHeading.toFixed(0)}°` : "—"}</Val>
        </Cell>
        <Cell>
          <Lab>PIT</Lab>
          <Val>{ready ? `${safePitch.toFixed(0)}°` : "—"}</Val>
        </Cell>
        <Cell>
          <Lab>ROL</Lab>
          <Val>{ready ? `${safeRoll.toFixed(0)}°` : "—"}</Val>
        </Cell>
      </Readout>
    </Wrap>
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

function headingMarkers(every: number): number[] {
  const out: number[] = [];
  // Render two laps so the ticker can wrap visually without seams.
  for (let d = 0; d < 720; d += every) out.push(d);
  return out;
}

const Wrap = styled.div`
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 4px;
`;

const Dial = styled.div`
  display: flex;
  align-items: center;
  justify-content: center;
`;

const HeadingStrip = styled.div`
  position: relative;
  height: 22px;
  border: 1px solid var(--color-surface-raised);
  background: var(--color-surface-app);
  overflow: hidden;
`;

const HeadingTicker = styled.div`
  position: absolute;
  inset: 0;
  /* The ticks position absolutely against the parent, so transform on the
     wrapper just shifts them as a group without affecting the pointer. */
  transition: transform 80ms linear;
`;

const HeadingTick = styled.div`
  position: absolute;
  top: 0;
  bottom: 0;
  /* The tick container shrinks to fit its label, so anchoring with just a
     left:Xpx style puts the LEFT EDGE at that position and the visible
     tick + label end up offset by half the container's intrinsic width.
     translateX(-50%) centres the visible content on the anchor so the
     current-heading tick lines up under the fixed pointer at strip
     centre. */
  transform: translateX(-50%);
  display: flex;
  flex-direction: column;
  align-items: center;
`;

const HeadingTickMark = styled.div`
  width: 1px;
  height: 6px;
  background: var(--color-text-muted);
`;

const HeadingTickLabel = styled.div`
  font-size: 9px;
  color: var(--color-text-muted);
  margin-top: 1px;
`;

const HeadingPointer = styled.div`
  position: absolute;
  top: 0;
  bottom: 0;
  left: 50%;
  width: 1px;
  background: var(--color-accent-fg);
  pointer-events: none;
`;

const Readout = styled.div`
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 6px;
`;

const Cell = styled.div`
  display: flex;
  flex-direction: column;
  align-items: center;
  border: 1px solid var(--color-surface-raised);
  padding: 2px 0;
`;

const Lab = styled.span`
  font-size: 9px;
  color: var(--color-text-faint);
  letter-spacing: 0.12em;
`;

const Val = styled.span`
  font-size: 14px;
  font-weight: 600;
  color: var(--color-text-primary);
  font-variant-numeric: tabular-nums;
`;
