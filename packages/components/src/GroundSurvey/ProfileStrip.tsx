import styled from "styled-components";
import type { SurveySample } from "./useGroundSurveySamples";

export interface ProfileStripProps {
  samples: readonly SurveySample[];
  /** Right-edge time (typically Date.now()). */
  nowMs: number;
  windowMs: number;
  width: number;
  height: number;
}

const PAD_X = 6;
const PAD_TOP = 6;
const PAD_BOTTOM = 14;

export function ProfileStrip({
  samples,
  nowMs,
  windowMs,
  width,
  height,
}: ProfileStripProps) {
  if (width <= 0 || height <= 0) return null;
  if (samples.length < 2) {
    return (
      <Svg
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label="Awaiting terrain samples"
      >
        <Baseline
          x1={PAD_X}
          x2={width - PAD_X}
          y1={height - PAD_BOTTOM}
          y2={height - PAD_BOTTOM}
        />
      </Svg>
    );
  }

  const tEnd = nowMs;
  const tStart = nowMs - windowMs;

  let yMin = Infinity;
  let yMax = -Infinity;
  for (const s of samples) {
    if (s.terrain < yMin) yMin = s.terrain;
    if (s.terrain > yMax) yMax = s.terrain;
  }
  if (!Number.isFinite(yMin) || !Number.isFinite(yMax)) return null;
  if (yMax === yMin) {
    yMax += 1;
    yMin -= 1;
  }
  const yPad = (yMax - yMin) * 0.1;
  yMin -= yPad;
  yMax += yPad;

  const innerW = width - PAD_X * 2;
  const innerH = height - PAD_TOP - PAD_BOTTOM;

  const xOf = (t: number) => PAD_X + ((t - tStart) / (tEnd - tStart)) * innerW;
  const yOf = (v: number) =>
    PAD_TOP + (1 - (v - yMin) / (yMax - yMin)) * innerH;

  // Split by kind so dashed segments render distinctly. Treat each
  // contiguous run as one polyline so the line breaks look intentional
  // at boundaries. Tag each run with its starting sample time so React
  // gets a stable key across renders.
  const segments: Array<{
    kind: "real" | "frozen";
    pts: string;
    startT: number;
  }> = [];
  let runKind: "real" | "frozen" | null = null;
  let runPts: string[] = [];
  let runStartT = 0;
  for (const s of samples) {
    const x = xOf(s.t);
    const y = yOf(s.terrain);
    const pt = `${x.toFixed(2)},${y.toFixed(2)}`;
    if (runKind === null) {
      runStartT = s.t;
      runPts.push(pt);
      runKind = s.kind;
    } else if (runKind === s.kind) {
      runPts.push(pt);
    } else {
      // Bridge the discontinuity: copy the last point into the new run so
      // the eye sees a continuous transition with a style change.
      segments.push({
        kind: runKind,
        pts: runPts.join(" "),
        startT: runStartT,
      });
      runPts = [runPts[runPts.length - 1], pt];
      runKind = s.kind;
      runStartT = s.t;
    }
  }
  if (runKind !== null && runPts.length > 0) {
    segments.push({ kind: runKind, pts: runPts.join(" "), startT: runStartT });
  }

  const lastX = xOf(samples[samples.length - 1].t);
  const lastY = yOf(samples[samples.length - 1].terrain);

  return (
    <Svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label="Terrain elevation along ground track"
    >
      <Baseline
        x1={PAD_X}
        x2={width - PAD_X}
        y1={height - PAD_BOTTOM}
        y2={height - PAD_BOTTOM}
      />
      {segments.map((seg) =>
        seg.kind === "real" ? (
          <RealLine key={`r-${seg.startT}`} points={seg.pts} />
        ) : (
          <FrozenLine key={`f-${seg.startT}`} points={seg.pts} />
        ),
      )}
      <ShipMarker cx={lastX} cy={lastY} r={3} />
    </Svg>
  );
}

const Svg = styled.svg`
  display: block;
  background: var(--color-surface-app);
`;

const Baseline = styled.line`
  stroke: var(--color-surface-raised);
  stroke-width: 1;
`;

const RealLine = styled.polyline`
  fill: none;
  stroke: var(--color-accent-fg);
  stroke-width: 1.5;
  stroke-linejoin: round;
`;

const FrozenLine = styled.polyline`
  fill: none;
  stroke: var(--color-text-faint);
  stroke-width: 1.2;
  stroke-dasharray: 4 3;
`;

const ShipMarker = styled.circle`
  fill: var(--color-status-go-fg);
  stroke: var(--color-surface-app);
  stroke-width: 1;
`;
