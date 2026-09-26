import type { PlotEmphasis, PlotLayer, PlotTone } from "@ksp-gonogo/sitrep-sdk";
import type { ReactElement } from "react";

/**
 * Draws the `PlotLayer` vocabulary inside `LineChart`'s plot rect. Layers arrive in data space, so a
 * contributor never sees pixels, margins, clip or paint order, and the host's own marks take the same
 * path. Paint order is by kind (field, region, series, marker), with `z` ordering only within a kind,
 * so one contributor's wash cannot bury another's curve.
 */

const TONE_COLOR: Record<PlotTone, string> = {
  neutral: "var(--color-text-muted)",
  go: "var(--color-accent-fg)",
  warn: "var(--color-status-warning-bg)",
  nogo: "var(--color-status-nogo-bg)",
  info: "var(--color-status-info-fg)",
};

const EMPHASIS_OPACITY: Record<PlotEmphasis, number> = {
  faint: 0.45,
  normal: 0.85,
  bright: 1,
};

const BASE_STROKE_WIDTH = 1.5;
/** Larger than a scatter point, so a lone mark does not read as one sample of a series. */
const BASE_MARKER_RADIUS = 5;
const ANNOTATION_HALF = 7;
const CAPTION_PAD = 6;
/** This svg has no viewBox, so font sizes are CSS px and stay off the type scale. */
const CAPTION_SIZE = 10;
const CAPTION_LABEL_SIZE = 9;
const CAPTION_LINE = 12;
const REGION_LABEL_SIZE = 9;
/** Width a rotated edge word takes, for a corner readout to clear. */
const EDGE_STRIP_PX = 13;
const DEFAULT_REGION_OPACITY = 0.1;
const DEFAULT_FIELD_OPACITY = 0.5;

function toneColor(layer: PlotLayer): string {
  return TONE_COLOR[layer.tone ?? "neutral"];
}

function toneOpacity(layer: PlotLayer): number {
  return EMPHASIS_OPACITY[layer.emphasis ?? "normal"];
}

export interface PlotLayerFrame {
  scaleX: (v: number) => number;
  scaleYPrimary: (v: number) => number;
  scaleYSecondary: (v: number) => number;
  plotX0: number;
  plotX1: number;
  plotY0: number;
  plotY1: number;
  /** Unique per chart instance: every `<defs>` id below is suffixed with it. */
  uid: string;
  /** False drops every label and caption; each layer's description still reaches the accessible name. */
  labels: boolean;
}

function scaleYOf(frame: PlotLayerFrame, layer: PlotLayer) {
  return layer.axis === "secondary"
    ? frame.scaleYSecondary
    : frame.scaleYPrimary;
}

/** Data-space extents for domain expansion; a rule constrains one axis only. */
export function plotLayerExtent(layer: PlotLayer): {
  xs: number[];
  ys: number[];
  axis: "primary" | "secondary";
} {
  const axis = layer.axis === "secondary" ? "secondary" : "primary";
  switch (layer.kind) {
    case "series":
      return {
        xs: layer.points.map((p) => p.x),
        ys: layer.points.map((p) => p.y),
        axis,
      };
    case "region":
      return {
        xs: [...layer.boundary, ...(layer.boundaryHigh ?? [])].map((p) => p.x),
        ys: [...layer.boundary, ...(layer.boundaryHigh ?? [])].map((p) => p.y),
        axis,
      };
    case "rule":
      return layer.along === "y"
        ? { xs: [], ys: [layer.value], axis }
        : { xs: [layer.value], ys: [], axis };
    case "marker":
    case "annotation":
      return { xs: [layer.at.x], ys: [layer.at.y], axis };
    // Context must never decide the scale the readings are drawn at.
    default:
      return { xs: [], ys: [], axis };
  }
}

/** A label already on the plot. Placement is the host's job, since a contributor cannot know what else was contributed. */
interface PlacedLabel {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}

const LABEL_CHAR_PX = 5.8;
const LABEL_LINE_PX = 11;
const LABEL_NUDGES = 4;

function placeLabel(
  placed: PlacedLabel[],
  opts: {
    anchorX: number;
    anchorY: number;
    gap: number;
    text: string;
    frame: PlotLayerFrame;
  },
): { x: number; y: number; anchor: "start" | "end" } {
  const width = opts.text.length * LABEL_CHAR_PX;
  const { frame } = opts;
  // Flip to the left when the whole label would not fit, not merely when the mark is near the edge.
  const rightX = opts.anchorX + opts.gap;
  const anchor: "start" | "end" =
    rightX + width <= frame.plotX1 - 4 ? "start" : "end";
  const x = anchor === "start" ? rightX : opts.anchorX - opts.gap;
  const x0 = anchor === "start" ? x : x - width;
  const x1 = x0 + width;

  const overlaps = (y: number) =>
    placed.some(
      (p) => x0 < p.x1 && x1 > p.x0 && y - LABEL_LINE_PX < p.y1 && y + 2 > p.y0,
    );

  let y = opts.anchorY + 3;
  for (let i = 0; i < LABEL_NUDGES && overlaps(y); i++) {
    y += LABEL_LINE_PX;
  }
  if (overlaps(y)) {
    y = opts.anchorY + 3;
    for (let i = 0; i < LABEL_NUDGES && overlaps(y); i++) {
      y -= LABEL_LINE_PX;
    }
  }
  y = Math.min(
    Math.max(y, frame.plotY0 + LABEL_LINE_PX),
    frame.plotY1 - LABEL_LINE_PX,
  );
  placed.push({ x0, x1, y0: y - LABEL_LINE_PX, y1: y + 2 });
  return { x, y, anchor };
}

function pathFrom(points: readonly { x: number; y: number }[]): string {
  return points
    .map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(2)},${p.y.toFixed(2)}`)
    .join(" ");
}

function stepPathFrom(points: readonly { x: number; y: number }[]): string {
  if (points.length === 0) return "";
  const parts = [`M${points[0].x.toFixed(2)},${points[0].y.toFixed(2)}`];
  for (let i = 1; i < points.length; i++) {
    parts.push(`H${points[i].x.toFixed(2)}`, `V${points[i].y.toFixed(2)}`);
  }
  return parts.join(" ");
}

/** Close a half-plane along the plot edges, appending the boundary's end corner first so the ring never crosses itself. */
export function closeHalfPlane(
  pts: readonly { x: number; y: number }[],
  side: "left" | "right" | "above" | "below",
  frame: PlotLayerFrame,
): { x: number; y: number }[] {
  if (pts.length === 0) return [];
  const first = pts[0];
  const last = pts[pts.length - 1];
  const out = [...pts];
  if (side === "right" || side === "left") {
    const edge = side === "right" ? frame.plotX1 : frame.plotX0;
    out.push({ x: edge, y: last.y }, { x: edge, y: first.y });
  } else {
    const edge = side === "above" ? frame.plotY0 : frame.plotY1;
    out.push({ x: last.x, y: edge }, { x: first.x, y: edge });
  }
  return out;
}

function FieldLayer({
  layer,
  frame,
}: {
  layer: Extract<PlotLayer, { kind: "field" }>;
  frame: PlotLayerFrame;
}) {
  if (layer.stops.length === 0) return null;
  const scaleY = scaleYOf(frame, layer);
  const span =
    layer.along === "y"
      ? frame.plotY1 - frame.plotY0
      : frame.plotX1 - frame.plotX0;
  if (span <= 0) return null;
  const origin = layer.along === "y" ? frame.plotY0 : frame.plotX0;
  const place = layer.along === "y" ? scaleY : frame.scaleX;
  const max = layer.maxOpacity ?? DEFAULT_FIELD_OPACITY;
  const tint = layer.tint ?? toneColor(layer);
  const gradientId = `plot-field-${layer.id}-${frame.uid}`;
  const blurId = `plot-field-blur-${layer.id}-${frame.uid}`;
  const stops = layer.stops
    .map((s) => ({
      offset: ((place(s.at) - origin) / span) * 100,
      intensity: Math.max(0, Math.min(1, s.intensity)),
    }))
    .sort((a, b) => a.offset - b.offset);

  return (
    <>
      <defs>
        <linearGradient
          id={gradientId}
          x1="0%"
          y1="0%"
          x2={layer.along === "x" ? "100%" : "0%"}
          y2={layer.along === "y" ? "100%" : "0%"}
        >
          {stops.map((s, i) => (
            <stop
              // biome-ignore lint/suspicious/noArrayIndexKey: a stop's position IS its identity, and two stops may share an offset on a collapsed domain
              key={i}
              offset={`${s.offset.toFixed(2)}%`}
              stopColor={tint}
              stopOpacity={max * s.intensity}
            />
          ))}
        </linearGradient>
        {layer.blur !== undefined && (
          <filter id={blurId}>
            <feGaussianBlur stdDeviation={layer.blur} />
          </filter>
        )}
      </defs>
      <rect
        data-plot-layer={layer.id}
        data-plot-layer-kind="field"
        x={frame.plotX0}
        y={frame.plotY0}
        width={frame.plotX1 - frame.plotX0}
        height={frame.plotY1 - frame.plotY0}
        fill={`url(#${gradientId})`}
        filter={layer.blur !== undefined ? `url(#${blurId})` : undefined}
      />
    </>
  );
}

/*
 * Relief: hypsometric colour is the reading and band edges are the iso-lines; no lighting model, since
 * a sun direction biases which slopes look steep. Values are bilinearly resampled to a fixed grid first
 * so bands follow the terrain instead of the coarse data cells. Rects rather than a canvas keep the
 * renderer stateless and deterministic for the visual gate.
 */

const DEFAULT_RELIEF_BANDS = 6;
const RELIEF_RESOLUTION = 56;

/** Bilinear sample of a row-major grid at continuous (col, row). */
function sampleGrid(
  values: readonly number[],
  size: number,
  col: number,
  row: number,
): number {
  const x0 = Math.max(0, Math.min(size - 1, Math.floor(col)));
  const y0 = Math.max(0, Math.min(size - 1, Math.floor(row)));
  const x1 = Math.min(size - 1, x0 + 1);
  const y1 = Math.min(size - 1, y0 + 1);
  const fx = Math.max(0, Math.min(1, col - x0));
  const fy = Math.max(0, Math.min(1, row - y0));
  const top =
    values[y0 * size + x0] +
    (values[y0 * size + x1] - values[y0 * size + x0]) * fx;
  const bottom =
    values[y1 * size + x0] +
    (values[y1 * size + x1] - values[y1 * size + x0]) * fx;
  return top + (bottom - top) * fy;
}

/** Low-key on purpose: this is context under the marks. */
const HYPSO: ReadonlyArray<
  readonly [number, readonly [number, number, number]]
> = [
  [0.0, [26, 32, 40]],
  [0.35, [36, 52, 56]],
  [0.6, [58, 70, 66]],
  [0.8, [90, 90, 74]],
  [1.0, [132, 130, 116]],
];

function hypso(t: number): readonly [number, number, number] {
  const x = Math.max(0, Math.min(1, t));
  for (let i = 1; i < HYPSO.length; i++) {
    if (x <= HYPSO[i][0]) {
      const [t0, c0] = HYPSO[i - 1];
      const [t1, c1] = HYPSO[i];
      const f = t1 > t0 ? (x - t0) / (t1 - t0) : 0;
      return [
        Math.round(c0[0] + (c1[0] - c0[0]) * f),
        Math.round(c0[1] + (c1[1] - c0[1]) * f),
        Math.round(c0[2] + (c1[2] - c0[2]) * f),
      ];
    }
  }
  return HYPSO[HYPSO.length - 1][1];
}

/** Darkened where the band differs from the neighbour above or left, drawing iso-lines without a second pass. */
function fillFor(
  bandAt: Int16Array,
  grid: number,
  bands: number,
  row: number,
  col: number,
): string {
  const band = bandAt[row * grid + col];
  const [r, g, b] = hypso(band / (bands - 1));
  const leftBand = col > 0 ? bandAt[row * grid + col - 1] : band;
  const upBand = row > 0 ? bandAt[(row - 1) * grid + col] : band;
  const edge = leftBand !== band || upBand !== band ? 0.5 : 1;
  return `rgb(${Math.round(r * edge)}, ${Math.round(g * edge)}, ${Math.round(b * edge)})`;
}

function ReliefLayer({
  layer,
  frame,
}: {
  layer: Extract<PlotLayer, { kind: "relief" }>;
  frame: PlotLayerFrame;
}) {
  const { size, values, bounds } = layer;
  if (size < 2 || values.length < size * size) return null;

  let lo = Number.POSITIVE_INFINITY;
  let hi = Number.NEGATIVE_INFINITY;
  for (let i = 0; i < size * size; i++) {
    const v = values[i];
    // A grid with a hole draws nothing rather than a field with a wrong range.
    if (!Number.isFinite(v)) return null;
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  const range = hi - lo;
  const bands = Math.max(2, layer.bands ?? DEFAULT_RELIEF_BANDS);
  const scaleY = scaleYOf(frame, layer);

  // `bounds` need not be min-first, and the plot Y axis may run either way.
  const sx0 = frame.scaleX(bounds.x0);
  const sx1 = frame.scaleX(bounds.x1);
  const sy0 = scaleY(bounds.y0);
  const sy1 = scaleY(bounds.y1);
  const left = Math.min(sx0, sx1);
  const top = Math.min(sy0, sy1);
  const grid = RELIEF_RESOLUTION;
  const cellW = Math.abs(sx1 - sx0) / grid;
  const cellH = Math.abs(sy1 - sy0) / grid;
  if (!(cellW > 0) || !(cellH > 0)) return null;
  const flipRows = sy0 < sy1;

  const bandAt = new Int16Array(grid * grid);
  for (let row = 0; row < grid; row++) {
    for (let col = 0; col < grid; col++) {
      const v = sampleGrid(
        values,
        size,
        (col / (grid - 1)) * (size - 1),
        (row / (grid - 1)) * (size - 1),
      );
      const t = range > 0 ? (v - lo) / range : 0.5;
      bandAt[row * grid + col] = Math.max(
        0,
        Math.min(bands - 1, Math.floor(t * bands)),
      );
    }
  }

  // One rect per run of same-coloured cells, not per cell, to keep the node count reconcilable every frame.
  const cells: ReactElement[] = [];
  for (let row = 0; row < grid; row++) {
    const screenRow = flipRows ? row : grid - 1 - row;
    let runStart = 0;
    let runFill = "";
    for (let col = 0; col <= grid; col++) {
      const fill = col < grid ? fillFor(bandAt, grid, bands, row, col) : "";
      if (col === 0) {
        runFill = fill;
        continue;
      }
      if (fill === runFill && col < grid) continue;
      cells.push(
        <rect
          key={`${row}-${runStart}`}
          x={left + runStart * cellW}
          y={top + screenRow * cellH}
          // A hairline overlap stops the rasteriser painting seams between runs.
          width={(col - runStart) * cellW + 0.5}
          height={cellH + 0.5}
          fill={runFill}
        />,
      );
      runStart = col;
      runFill = fill;
    }
  }

  return (
    // biome-ignore lint/a11y/noAriaHiddenOnFocusable: an SVG <g> with no tabindex and no interactive descendant is not focusable; the rule treats every <g> as one
    <g
      data-plot-layer={layer.id}
      data-plot-layer-kind="relief"
      opacity={toneOpacity(layer)}
      aria-hidden="true"
    >
      {cells}
    </g>
  );
}

function RegionLayer({
  layer,
  frame,
}: {
  layer: Extract<PlotLayer, { kind: "region" }>;
  frame: PlotLayerFrame;
}) {
  const scaleY = scaleYOf(frame, layer);
  const project = (p: { x: number; y: number }) => ({
    x: frame.scaleX(p.x),
    y: scaleY(p.y),
  });
  const boundary = layer.boundary.map(project);
  if (boundary.length < 2) return null;
  const ring =
    layer.side === "between"
      ? [...boundary, ...(layer.boundaryHigh ?? []).map(project).reverse()]
      : closeHalfPlane(boundary, layer.side, frame);
  if (layer.side === "between" && !layer.boundaryHigh) return null;

  // The region's free edge is the only part reliably clear of what is drawn over it.
  const labelX =
    layer.side === "right"
      ? frame.plotX1 - 4
      : layer.side === "left"
        ? frame.plotX0 + 11
        : boundary[boundary.length - 1].x;
  const labelY = frame.plotY1 - 34;

  return (
    <>
      <polygon
        data-plot-layer={layer.id}
        data-plot-layer-kind="region"
        points={ring
          .map((p) => `${p.x.toFixed(2)},${p.y.toFixed(2)}`)
          .join(" ")}
        fill={toneColor(layer)}
        fillOpacity={layer.opacity ?? DEFAULT_REGION_OPACITY}
      />
      {frame.labels && layer.label && (
        <text
          x={labelX}
          y={labelY}
          transform={`rotate(-90 ${labelX} ${labelY})`}
          fontSize={REGION_LABEL_SIZE}
          letterSpacing="0.14em"
          fill="var(--color-text-muted)"
        >
          {layer.label}
        </text>
      )}
    </>
  );
}

function SeriesLayer({
  layer,
  frame,
}: {
  layer: Extract<PlotLayer, { kind: "series" }>;
  frame: PlotLayerFrame;
}) {
  const scaleY = scaleYOf(frame, layer);
  const pts = layer.points.map((p) => ({
    x: frame.scaleX(p.x),
    y: scaleY(p.y),
  }));
  if (pts.length === 0) return null;
  const width = BASE_STROKE_WIDTH * (layer.weight ?? 1);
  if (layer.style === "scatter") {
    return (
      <g
        data-plot-layer={layer.id}
        data-plot-layer-kind="series"
        fill={toneColor(layer)}
        opacity={toneOpacity(layer)}
      >
        {pts.map((p, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: scatter points have no other identity
          <circle key={i} cx={p.x} cy={p.y} r={width} />
        ))}
      </g>
    );
  }
  return (
    <path
      data-plot-layer={layer.id}
      data-plot-layer-kind="series"
      d={layer.style === "step" ? stepPathFrom(pts) : pathFrom(pts)}
      fill="none"
      stroke={toneColor(layer)}
      strokeOpacity={toneOpacity(layer)}
      strokeWidth={width}
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeDasharray={layer.dashed ? "5 3.5" : undefined}
    />
  );
}

function RuleLayer({
  layer,
  frame,
}: {
  layer: Extract<PlotLayer, { kind: "rule" }>;
  frame: PlotLayerFrame;
}) {
  const scaleY = scaleYOf(frame, layer);
  const dashed = layer.dashed ?? true;
  const color = toneColor(layer);
  const horizontal = layer.along === "y";
  const at = horizontal ? scaleY(layer.value) : frame.scaleX(layer.value);
  return (
    <>
      <line
        data-plot-layer={layer.id}
        data-plot-layer-kind="rule"
        x1={horizontal ? frame.plotX0 : at}
        x2={horizontal ? frame.plotX1 : at}
        y1={horizontal ? at : frame.plotY0}
        y2={horizontal ? at : frame.plotY1}
        stroke={color}
        strokeOpacity={toneOpacity(layer)}
        strokeWidth={1}
        strokeDasharray={dashed ? "4 3" : undefined}
      />
      {frame.labels && layer.label && (
        <text
          x={horizontal ? frame.plotX1 - 4 : at + 3}
          y={horizontal ? at - 3 : frame.plotY0 + 10}
          textAnchor={horizontal ? "end" : "start"}
          fill={color}
          fontSize={CAPTION_LABEL_SIZE}
        >
          {layer.label}
        </text>
      )}
    </>
  );
}

function AnnotationLayer({
  layer,
  frame,
  placed,
}: {
  layer: Extract<PlotLayer, { kind: "annotation" }>;
  frame: PlotLayerFrame;
  placed: PlacedLabel[];
}) {
  const scaleY = scaleYOf(frame, layer);
  const x = frame.scaleX(layer.at.x);
  const y = scaleY(layer.at.y);
  const across = layer.across ?? "x";
  const color = toneColor(layer);
  const spot =
    frame.labels && layer.label
      ? placeLabel(placed, {
          anchorX: x,
          anchorY: y,
          gap: ANNOTATION_HALF + 3,
          text: layer.label,
          frame,
        })
      : null;
  return (
    <>
      <line
        data-plot-layer={layer.id}
        data-plot-layer-kind="annotation"
        x1={across === "x" ? x - ANNOTATION_HALF : x}
        x2={across === "x" ? x + ANNOTATION_HALF : x}
        y1={across === "x" ? y : y - ANNOTATION_HALF}
        y2={across === "x" ? y : y + ANNOTATION_HALF}
        stroke={color}
        strokeOpacity={toneOpacity(layer)}
        strokeWidth={1.75}
        strokeLinecap="round"
      />
      {spot && layer.label && (
        <text
          x={spot.x}
          y={spot.y}
          textAnchor={spot.anchor}
          fontSize={CAPTION_LABEL_SIZE}
          letterSpacing="0.05em"
          fill={color}
          fillOpacity={toneOpacity(layer)}
        >
          {layer.label}
        </text>
      )}
    </>
  );
}

function MarkerLayer({
  layer,
  frame,
}: {
  layer: Extract<PlotLayer, { kind: "marker" }>;
  frame: PlotLayerFrame;
}) {
  const scaleY = scaleYOf(frame, layer);
  const x = frame.scaleX(layer.at.x);
  const y = scaleY(layer.at.y) + (layer.offsetPx ?? 0);
  const r = BASE_MARKER_RADIUS * (layer.scale ?? 1);
  const color = toneColor(layer);
  const shape = layer.shape ?? "dot";
  const common = {
    "data-plot-layer": layer.id,
    "data-plot-layer-kind": "marker",
    opacity: toneOpacity(layer),
  } as const;

  const mark =
    shape === "dot" ? (
      <circle
        {...common}
        cx={x}
        cy={y}
        r={r}
        fill={color}
        stroke="var(--color-surface-raised)"
        strokeWidth={1.5}
      />
    ) : shape === "ring" ? (
      <circle
        {...common}
        cx={x}
        cy={y}
        r={r}
        fill="none"
        stroke={color}
        strokeWidth={1.5}
      />
    ) : shape === "cross" ? (
      <path
        {...common}
        d={`M${x - r},${y} L${x + r},${y} M${x},${y - r} L${x},${y + r}`}
        stroke={color}
        strokeWidth={1.5}
        strokeLinecap="round"
      />
    ) : (
      // An open chevron: a filled arrowhead would read as a direction of travel.
      <polyline
        {...common}
        points={
          shape === "chevron-up"
            ? `${x - r},${y + r * 0.5} ${x},${y - r * 0.5} ${x + r},${y + r * 0.5}`
            : `${x - r},${y - r * 0.5} ${x},${y + r * 0.5} ${x + r},${y - r * 0.5}`
        }
        fill="none"
        stroke={color}
        strokeWidth={1.25}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    );

  return (
    <>
      {mark}
      {frame.labels && layer.label && (
        <text
          x={x + r + 3}
          y={y + 3}
          fontSize={CAPTION_LABEL_SIZE}
          fill={color}
          fillOpacity={toneOpacity(layer)}
        >
          {layer.label}
        </text>
      )}
    </>
  );
}

/** Captions sharing an anchor stack as a list rather than overprinting. */
function CaptionLayer({
  layer,
  frame,
  row,
  edges,
}: {
  layer: Extract<PlotLayer, { kind: "caption" }>;
  frame: PlotLayerFrame;
  row: number;
  /** Edge strips already taken by rotated text, which a corner readout must step inboard of. */
  edges: { left: boolean; right: boolean };
}) {
  const color = toneColor(layer);
  const lines = layer.caption ? 2 : 1;
  if (layer.anchor === "left-edge" || layer.anchor === "right-edge") {
    const x =
      layer.anchor === "left-edge"
        ? frame.plotX0 + CAPTION_PAD + row * CAPTION_LINE
        : frame.plotX1 - CAPTION_PAD - row * CAPTION_LINE;
    const y = frame.plotY1 - 34;
    return (
      <text
        data-plot-layer={layer.id}
        data-plot-layer-kind="caption"
        x={x}
        y={y}
        transform={`rotate(-90 ${x} ${y})`}
        fontSize={CAPTION_LABEL_SIZE}
        letterSpacing="0.14em"
        fill={color}
        fillOpacity={toneOpacity(layer)}
      >
        {layer.text}
      </text>
    );
  }
  const top = layer.anchor.startsWith("top");
  const right = layer.anchor.endsWith("right");
  const inset = (side: boolean) => CAPTION_PAD + (side ? EDGE_STRIP_PX : 0);
  const x = right
    ? frame.plotX1 - inset(edges.right)
    : frame.plotX0 + inset(edges.left);
  const block = row * (lines * CAPTION_LINE + 2);
  const baseY = top
    ? frame.plotY0 + CAPTION_PAD + CAPTION_SIZE + block
    : frame.plotY1 - CAPTION_PAD - block;
  const captionY = top ? baseY - CAPTION_LINE : baseY - CAPTION_LINE;
  return (
    <g
      data-plot-layer={layer.id}
      data-plot-layer-kind="caption"
      textAnchor={right ? "end" : "start"}
    >
      {layer.caption && (
        <text
          x={x}
          y={top ? baseY : captionY}
          fontSize={CAPTION_LABEL_SIZE}
          letterSpacing="0.05em"
          fill="var(--color-text-faint)"
        >
          {layer.caption}
        </text>
      )}
      <text
        x={x}
        y={layer.caption && top ? baseY + CAPTION_LINE : baseY}
        fontSize={CAPTION_SIZE}
        fontWeight={700}
        fill={color}
        fillOpacity={toneOpacity(layer)}
      >
        {layer.text}
      </text>
    </g>
  );
}

const KIND_ORDER: Record<PlotLayer["kind"], number> = {
  relief: -1,
  field: 0,
  region: 1,
  series: 2,
  rule: 3,
  annotation: 4,
  marker: 5,
  caption: 6,
};

/** `background` sits under the gridlines, `foreground` over them with the series, and `caption` outside the clip. */
export type PlotLayerPass = "background" | "foreground" | "caption";

const KIND_PASS: Record<PlotLayer["kind"], PlotLayerPass> = {
  relief: "background",
  field: "background",
  region: "background",
  series: "foreground",
  rule: "foreground",
  annotation: "foreground",
  marker: "foreground",
  caption: "caption",
};

export function PlotLayers({
  layers,
  frame,
  pass,
}: {
  layers: readonly PlotLayer[];
  frame: PlotLayerFrame;
  pass: PlotLayerPass;
}) {
  const ordered = layers
    .map((layer, index) => ({ layer, index }))
    .filter(({ layer }) => KIND_PASS[layer.kind] === pass)
    .sort(
      (a, b) =>
        KIND_ORDER[a.layer.kind] - KIND_ORDER[b.layer.kind] ||
        (a.layer.z ?? 0) - (b.layer.z ?? 0) ||
        a.index - b.index,
    );

  const captionRows = new Map<string, number>();
  const placedLabels: PlacedLabel[] = [];
  const edges = {
    left: layers.some(
      (l) =>
        (l.kind === "caption" && l.anchor === "left-edge") ||
        (l.kind === "region" && l.side === "left" && !!l.label),
    ),
    right: layers.some(
      (l) =>
        (l.kind === "caption" && l.anchor === "right-edge") ||
        (l.kind === "region" && l.side === "right" && !!l.label),
    ),
  };

  return (
    <>
      {ordered.map(({ layer, index }) => {
        const key = `${layer.id}-${index}`;
        switch (layer.kind) {
          case "relief":
            return <ReliefLayer key={key} layer={layer} frame={frame} />;
          case "field":
            return <FieldLayer key={key} layer={layer} frame={frame} />;
          case "region":
            return <RegionLayer key={key} layer={layer} frame={frame} />;
          case "series":
            return <SeriesLayer key={key} layer={layer} frame={frame} />;
          case "rule":
            return <RuleLayer key={key} layer={layer} frame={frame} />;
          case "annotation":
            return (
              <AnnotationLayer
                key={key}
                layer={layer}
                frame={frame}
                placed={placedLabels}
              />
            );
          case "marker":
            return <MarkerLayer key={key} layer={layer} frame={frame} />;
          case "caption": {
            const row = captionRows.get(layer.anchor) ?? 0;
            captionRows.set(layer.anchor, row + 1);
            return (
              <CaptionLayer
                key={key}
                layer={layer}
                frame={frame}
                row={row}
                edges={edges}
              />
            );
          }
          default:
            return null;
        }
      })}
    </>
  );
}

/** Accessible-name clauses in draw order; a layer with nothing to say adds nothing. */
export function plotLayerDescriptions(layers: readonly PlotLayer[]): string[] {
  return layers
    .map((l) => l.description)
    .filter((d): d is string => typeof d === "string" && d.length > 0);
}
