import { value } from "@ksp-gonogo/sitrep-sdk";
import { Cluster, Grid, NULL_DISPLAY, Unit } from "@ksp-gonogo/ui-kit";
import { type CSSProperties, useId } from "react";

export interface AttitudeIndicatorProps {
  heading: number | null;
  pitch: number | null;
  roll: number | null;
  /** Pixels: the dial draws into a square, taking the smaller of w/h. */
  size: number;
}

/**
 * Compact attitude indicator: a horizon ribbon that rolls and pitches inside a
 * circular viewport, over a heading strip that scrolls to keep the current
 * heading centred. No prograde/normal markers: the wire carries no direction
 * vectors to project them from.
 */
export function AttitudeIndicator({
  heading,
  pitch,
  roll,
  size,
}: AttitudeIndicatorProps) {
  const ready = heading !== null && pitch !== null && roll !== null;
  // Per instance: two dials of one size on a dashboard would otherwise share an id, and `url(#...)` resolves to whichever mounted first.
  const clipId = `navball-clip-${useId().replace(/:/g, "")}`;
  const cx = size / 2;
  const cy = size / 2;
  const r = size / 2 - 2;

  const safePitch = pitch ?? 0;
  const safeRoll = roll ?? 0;
  const safeHeading = heading ?? 0;

  // r/90 maps +/-90 pitch onto the radius, so the horizon reaches the edge only at the extremes and the 2r sky/ground rects never outrun the dial.
  const pitchScale = r / 90;
  const horizonOffset = safePitch * pitchScale;

  const headingPxPerDeg = size / 90;
  const headingTickEvery = 10;

  return (
    <div aria-hidden={!ready} style={WRAP}>
      <Cluster justify="center">
        <svg
          width={size}
          height={size}
          viewBox={`0 0 ${size} ${size}`}
          role="img"
          aria-label="Attitude indicator"
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
                {pitchTicks(60).map((deg) => {
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
      </Cluster>

      <div style={HEADING_STRIP}>
        <div
          // translateX(50%) is half the strip's width, which puts the current-heading tick under the centred pointer.
          style={{
            ...HEADING_TICKER,
            transform: `translateX(calc(50% - ${safeHeading * headingPxPerDeg}px))`,
          }}
        >
          {headingMarkers(headingTickEvery).map((deg) => (
            <div
              key={deg}
              style={{ ...HEADING_TICK, left: `${deg * headingPxPerDeg}px` }}
            >
              <div style={HEADING_TICK_MARK} />
              {deg % 30 === 0 && (
                <div style={HEADING_TICK_LABEL} data-heading-label>
                  {bearingOf(deg)}
                </div>
              )}
            </div>
          ))}
        </div>
        <div style={HEADING_POINTER} />
      </div>

      {/* Reading above label, matching the numeric readout the widget degrades to. */}
      <Grid cols="repeat(3, 1fr)" gap="related-comfortable">
        <div style={CELL}>
          <span style={VAL}>
            {ready ? (
              <Unit value={value("°", safeHeading)} decimals={0} />
            ) : (
              NULL_DISPLAY
            )}
          </span>
          <span style={LAB}>HDG</span>
        </div>
        <div style={CELL}>
          <span style={VAL}>
            {ready ? (
              <Unit value={value("°", safePitch)} decimals={0} />
            ) : (
              NULL_DISPLAY
            )}
          </span>
          <span style={LAB}>PIT</span>
        </div>
        <div style={CELL}>
          <span style={VAL}>
            {ready ? (
              <Unit value={value("°", safeRoll)} decimals={0} />
            ) : (
              NULL_DISPLAY
            )}
          </span>
          <span style={LAB}>ROL</span>
        </div>
      </Grid>
    </div>
  );
}

function pitchTicks(extent: number): number[] {
  const out: number[] = [];
  for (let d = -Math.floor(extent / 10) * 10; d <= extent; d += 10) {
    if (d === 0) continue;
    out.push(d);
  }
  return out;
}

function headingMarkers(every: number): number[] {
  const out: number[] = [];
  // Half a lap either side of 0-360, so whatever the heading there are ticks on both sides of the pointer.
  for (let d = -180; d < 540; d += every) out.push(d);
  return out;
}

function bearingOf(deg: number): number {
  return ((deg % 360) + 360) % 360;
}

const WRAP: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  alignItems: "stretch",
  gap: "var(--gap-related)",
  // The dial is sized to the shorter axis; the heading tape fills the column so it holds more than 30 degrees either side.
  flex: "1 1 auto",
  minWidth: 0,
};

const HEADING_STRIP: CSSProperties = {
  position: "relative",
  height: "22px",
  border: "1px solid var(--color-surface-raised)",
  background: "var(--color-surface-app)",
  overflow: "hidden",
};

const HEADING_TICKER: CSSProperties = {
  position: "absolute",
  inset: 0,
  // Off the motion scale: an 80ms chase of live heading must not move when the UI motion tokens are retuned.
  transition: "transform 80ms linear",
};

const HEADING_TICK: CSSProperties = {
  position: "absolute",
  top: 0,
  bottom: 0,
  // Centres the tick on its `left` anchor rather than putting its left edge there.
  transform: "translateX(-50%)",
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
};

const HEADING_TICK_MARK: CSSProperties = {
  width: "1px",
  height: "6px",
  background: "var(--color-text-muted)",
};

const HEADING_TICK_LABEL: CSSProperties = {
  // Off the type scale: the smallest token is 11px on a coarse pointer, which the 22px strip clips.
  fontSize: "9px",
  color: "var(--color-text-muted)",
  marginTop: "var(--gap-line)",
};

const HEADING_POINTER: CSSProperties = {
  position: "absolute",
  top: 0,
  bottom: 0,
  left: "50%",
  width: "1px",
  background: "var(--color-accent-fg)",
  pointerEvents: "none",
};

const CELL: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  border: "1px solid var(--color-surface-raised)",
  padding: "var(--inset-line)",
};

// Off the type scale: these heights are fixed terms in the chrome reserve Navball subtracts before sizing the dial.
const LAB: CSSProperties = {
  fontSize: "9px",
  color: "var(--color-text-faint)",
  letterSpacing: "0.12em",
};

const VAL: CSSProperties = {
  fontSize: "14px",
  fontWeight: 600,
  color: "var(--color-text-primary)",
  fontVariantNumeric: "tabular-nums",
};
