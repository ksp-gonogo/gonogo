import type { PorkchopCell } from "@ksp-gonogo/core";
import { kspCalendar, NULL_DISPLAY } from "@ksp-gonogo/ui-kit";
import { useId, useState } from "react";
import {
  Inspector,
  MapBox,
  MapSvg,
  PorkchopTitle,
  PorkchopWrap,
} from "./styles";
import type { buildTransferPorkchop } from "./transferData";

// Continuous Δv to colour ramp, violet (cheap optimum) through to red (worst), with no discrete banding. `t` is the capped, normalised Δv in [0,1].
function clamp01(t: number): number {
  if (t < 0) return 0;
  if (t > 1) return 1;
  return t;
}
const rampColor = (t: number): string =>
  `hsl(${(258 * (1 - clamp01(t))).toFixed(1)}, 66%, 48%)`;

// Plot geometry (SVG user units); margins leave room for the ticks and the Δv legend.
const VB_W = 360;
const VB_H = 300;
const M = { top: 12, right: 74, bottom: 34, left: 50 };
const PLOT_W = VB_W - M.left - M.right;
const PLOT_H = VB_H - M.top - M.bottom;

/** Three tick indices (first, middle, last) for an axis of `n` samples. */
const tickIndices = (n: number): number[] =>
  n <= 1 ? [0] : [...new Set([0, Math.floor((n - 1) / 2), n - 1])];

export function Porkchop({
  grid,
  nowUt,
}: {
  grid: NonNullable<ReturnType<typeof buildTransferPorkchop>>;
  nowUt: number;
}) {
  const [hover, setHover] = useState<PorkchopCell | null>(null);
  const gradientId = useId();
  const cols = grid.cells.length; // departure axis (x), cells[i]
  const rows = grid.cells[0]?.length ?? 0; // arrival axis (y), cells[i][j]
  const min = grid.minDeltaV;
  const max = grid.maxDeltaV;
  if (cols === 0 || rows === 0 || min == null || max == null) return null;
  // Capped near the optimum (never past the real max) so the bullseye keeps contour resolution; outliers saturate the top band.
  const scaleMax = Math.min(max, min * 1.8);
  const scaleSpan = scaleMax - min || 1;
  const capped = scaleMax < max;
  const cellW = PLOT_W / cols;
  const cellH = PLOT_H / rows;
  const days = (sec: number) => Math.round(sec / kspCalendar().day);
  const dayOffset = (ut: number) => days(ut - nowUt);
  const kms = (ms: number) => (ms / 1000).toFixed(1);

  // Departure increases left to right; arrival bottom to top, like a canonical porkchop.
  const cellX = (i: number) => M.left + i * cellW;
  const cellY = (j: number) => M.top + (rows - 1 - j) * cellH;

  const best = grid.best;

  return (
    <PorkchopWrap>
      <PorkchopTitle>Transfer Δv: departure vs arrival</PorkchopTitle>
      <Inspector aria-live="polite">
        {hover && hover.deltaV != null
          ? `Departs +${dayOffset(hover.depUt)}d · Arrives +${dayOffset(hover.arrUt)}d · Transfer ${days(hover.tofSec)}d · Δv ${kms(hover.deltaV)} km/s`
          : `Best ${best ? `${kms(best.deltaV)} km/s, depart +${dayOffset(best.depUt)}d` : NULL_DISPLAY} · hover a cell for its numbers.`}
      </Inspector>
      <MapBox>
        <MapSvg
          viewBox={`0 0 ${VB_W} ${VB_H}`}
          preserveAspectRatio="xMidYMid meet"
          role="img"
          aria-label={`Transfer Δv contour plot, departure against arrival date. Best transfer ${best ? `${Math.round(best.deltaV)} metres per second departing ${dayOffset(best.depUt)} days from now` : "none"}.`}
        >
          <defs>
            {/* Legend ramp: worst at top, cheap at bottom, matching the plot's scale. */}
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={rampColor(1)} />
              <stop offset="25%" stopColor={rampColor(0.75)} />
              <stop offset="50%" stopColor={rampColor(0.5)} />
              <stop offset="75%" stopColor={rampColor(0.25)} />
              <stop offset="100%" stopColor={rampColor(0)} />
            </linearGradient>
          </defs>
          {/* The off-scale colour fills the plot and only lower-Δv cells paint on top; no-solution cells stay background. */}
          <rect
            x={M.left}
            y={M.top}
            width={PLOT_W}
            height={PLOT_H}
            fill={rampColor(1)}
            pointerEvents="none"
          />
          {grid.cells.map((col, i) =>
            col.map((c, j) => {
              if (c.deltaV == null) return null;
              const t = (c.deltaV - min) / scaleSpan; // 0 cheap → 1 dear
              if (t >= 1) return null; // at/above the cap → background
              return (
                // biome-ignore lint/a11y/noStaticElementInteractions: decorative plot cell (svg is role=img); hover is a pointer-only enhancement, the windows list is the accessible interactive surface.
                <rect
                  className="porkchop-cell"
                  key={`${c.depUt.toFixed(0)}-${c.arrUt.toFixed(0)}`}
                  x={cellX(i)}
                  y={cellY(j)}
                  width={cellW + 0.6}
                  height={cellH + 0.6}
                  fill={rampColor(t)}
                  onMouseEnter={() => setHover(c)}
                />
              );
            }),
          )}

          {best && (
            <g
              stroke="var(--color-accent-fg)"
              strokeWidth={1.4}
              fill="none"
              pointerEvents="none"
            >
              <circle
                cx={cellX(best.i) + cellW / 2}
                cy={cellY(best.j) + cellH / 2}
                r={4.5}
              />
            </g>
          )}

          <rect
            x={M.left}
            y={M.top}
            width={PLOT_W}
            height={PLOT_H}
            fill="none"
            stroke="var(--color-border-subtle)"
            strokeWidth={1}
            pointerEvents="none"
          />

          {tickIndices(cols).map((i) => (
            <text
              key={`xt-${i}`}
              x={cellX(i) + cellW / 2}
              y={M.top + PLOT_H + 12}
              fontSize={9}
              textAnchor="middle"
              fill="var(--color-text-dim)"
            >
              +{dayOffset(grid.departureUts[i])}
            </text>
          ))}
          <text
            x={M.left + PLOT_W / 2}
            y={VB_H - 4}
            fontSize={9}
            textAnchor="middle"
            fill="var(--color-text-muted)"
          >
            departure: days from now
          </text>

          {tickIndices(rows).map((j) => (
            <text
              key={`yt-${j}`}
              x={M.left - 6}
              y={cellY(j) + cellH / 2 + 3}
              fontSize={9}
              textAnchor="end"
              fill="var(--color-text-dim)"
            >
              +{dayOffset(grid.arrivalUts[j])}
            </text>
          ))}
          <text
            x={12}
            y={M.top + PLOT_H / 2}
            fontSize={9}
            textAnchor="middle"
            fill="var(--color-text-muted)"
            transform={`rotate(-90 12 ${M.top + PLOT_H / 2})`}
          >
            arrival: days from now
          </text>

          <rect
            x={VB_W - M.right + 20}
            y={M.top}
            width={12}
            height={PLOT_H}
            fill={`url(#${gradientId})`}
          />
          <text
            x={VB_W - M.right + 38}
            y={M.top + 7}
            fontSize={9}
            textAnchor="start"
            fill="var(--color-text-dim)"
          >
            {capped ? "≥" : ""}
            {kms(scaleMax)}
          </text>
          <text
            x={VB_W - M.right + 38}
            y={M.top + PLOT_H / 2 + 3}
            fontSize={9}
            textAnchor="start"
            fill="var(--color-text-dim)"
          >
            {kms((min + scaleMax) / 2)}
          </text>
          <text
            x={VB_W - M.right + 38}
            y={M.top + PLOT_H}
            fontSize={9}
            textAnchor="start"
            fill="var(--color-text-dim)"
          >
            {kms(min)}
          </text>
          <text
            x={VB_W - M.right + 20}
            y={M.top + PLOT_H + 12}
            fontSize={9}
            textAnchor="start"
            fill="var(--color-text-muted)"
          >
            Δv km/s
          </text>
        </MapSvg>
      </MapBox>
    </PorkchopWrap>
  );
}
