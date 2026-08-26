import { value } from "@ksp-gonogo/sitrep-sdk";
import { Cluster, Grid, NULL_DISPLAY, Unit } from "@ksp-gonogo/ui-kit";
import type { CSSProperties } from "react";

export interface AttitudeIndicatorProps {
  heading: number | null;
  pitch: number | null;
  roll: number | null;
  /** Pixels: the dial draws into a square, taking the smaller of w/h. */
  size: number;
}

/**
 * Compact attitude indicator: not a full 8-ball, but pulls together the
 * three primary attitude readouts in a way that reads at a glance:
 *
 *   - The horizon ribbon rolls and pitches inside a circular viewport,
 *     with hash marks every 10° of pitch.
 *   - A heading rose strip sits below, scrolling so the current heading
 *     sits at the centre.
 *
 * Markers (prograde, retrograde, normal etc.) are deferred, they need
 * direction vectors the wire doesn't carry for a compact projection,
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

  // 1° of pitch = pitchScale px on the horizon ribbon. r/90 maps the full
  // physical pitch range (+/-90, straight up to straight down) onto the
  // dial's radius, so the horizon line only ever reaches the very edge at
  // the extremes: a common ~45 climb (see the Navball "gravity-turn-east"
  // fixture) still leaves the horizon roughly mid-dial instead of pinning
  // it off the edge. r/45 would put the horizon at the edge (ground/sky
  // band clipped to invisible) at just +/-45, well short of "without
  // horizon-bar disappearing on climbs" below, and leave an unfilled gap
  // across half the dial at +/-90: the sky/ground rects only span 2r each,
  // so a 2r offset outruns them, while r/90's max +/-r offset keeps a
  // rect's span flush with the dial exactly at the extreme.
  const pitchScale = r / 90;
  const horizonOffset = safePitch * pitchScale;

  // Heading band: 1° = 4px gives ~120° of context across a 480px-equivalent
  // strip; we scale relative to size so smaller widgets compress.
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
                {/* Pitch ladder: every 10°, ± 60°. */}
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
      </Cluster>

      <div style={HEADING_STRIP}>
        <div
          // The ticker shares the strip's width (inset:0), so translateX(50%)
          // shifts the whole tick row right by stripWidth/2, combined with
          // the per-degree shift this puts the current-heading tick directly
          // under the centred pointer instead of at the strip's left edge.
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
              {deg % 30 === 0 && <div style={HEADING_TICK_LABEL}>{deg}</div>}
            </div>
          ))}
        </div>
        <div style={HEADING_POINTER} />
      </div>

      <Grid cols="repeat(3, 1fr)" gap="md">
        <div style={CELL}>
          <span style={LAB}>HDG</span>
          <span style={VAL}>
            {ready ? (
              <Unit value={value("°", safeHeading)} decimals={0} />
            ) : (
              NULL_DISPLAY
            )}
          </span>
        </div>
        <div style={CELL}>
          <span style={LAB}>PIT</span>
          <span style={VAL}>
            {ready ? (
              <Unit value={value("°", safePitch)} decimals={0} />
            ) : (
              NULL_DISPLAY
            )}
          </span>
        </div>
        <div style={CELL}>
          <span style={LAB}>ROL</span>
          <span style={VAL}>
            {ready ? (
              <Unit value={value("°", safeRoll)} decimals={0} />
            ) : (
              NULL_DISPLAY
            )}
          </span>
        </div>
      </Grid>
    </div>
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

// Structural inline styles (CSS-var tokens): a bespoke attitude readout, no
// reusable ui-kit primitive fits, so the layout stays local. Off-scale font
// sizes (9/14px) and the 80ms heading chase are deliberately literal (see each
// note) and were already literal in the styled blocks this replaces.

const WRAP: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  alignItems: "stretch",
  gap: "var(--space-4)",
  // Fill the column beside the throttle bar rather than shrinking to the dial's
  // own width. The dial is sized to the SHORTER axis, so on a tall narrow tile
  // it is much narrower than the space available, and a tape sized to it holds
  // barely 30° of heading either side of the pointer.
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
  // The ticks position absolutely against the parent, so transform on the
  // wrapper just shifts them as a group without affecting the pointer.
  // Off the motion scale on purpose: an 80ms chase on live heading, not a
  // UI-motion choice. --duration-instant is the hover rung, and retuning it
  // must not change how the strip tracks telemetry.
  transition: "transform 80ms linear",
};

const HEADING_TICK: CSSProperties = {
  position: "absolute",
  top: 0,
  bottom: 0,
  // The tick container shrinks to fit its label, so anchoring with just a
  // left:Xpx style puts the LEFT EDGE at that position and the visible tick +
  // label end up offset by half the container's intrinsic width.
  // translateX(-50%) centres the visible content on the anchor so the
  // current-heading tick lines up under the fixed pointer at strip centre.
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
  // Off the type scale: this label sits under a 6px tick mark inside
  // HeadingStrip's fixed 22px, which leaves ~20px after its border.
  // --font-size-2xs is 11px on a coarse pointer and the strip's
  // overflow: hidden clips the label at that size.
  fontSize: "9px",
  color: "var(--color-text-muted)",
  marginTop: "var(--space-hair)",
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
  padding: "var(--space-2) 0",
};

// Lab and Val stay off the type scale: their rendered heights are two of the
// terms in Navball's verticalReserve = 74, the bare JS number its
// ResizeObserver subtracts before sizing the dial. The tokens grow this column
// ~2px on desktop and ~4px on a coarse pointer while 74 does not move, which is
// what pushes the strip and readout past the Panel's bottom edge in the
// wide-and-short (mobile 9x8) case that reserve exists for.
const LAB: CSSProperties = {
  fontSize: "9px",
  color: "var(--color-text-faint)",
  letterSpacing: "0.12em",
};

const VAL: CSSProperties = {
  // Off the type scale with Lab above: same verticalReserve budget.
  fontSize: "14px",
  fontWeight: 600,
  color: "var(--color-text-primary)",
  fontVariantNumeric: "tabular-nums",
};
