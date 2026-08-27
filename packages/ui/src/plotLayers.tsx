import type { PlotEmphasis, PlotLayer, PlotTone } from "@ksp-gonogo/sitrep-sdk";

/**
 * Draws the `plot-layers` vocabulary inside `LineChart`'s own plot rect.
 *
 * Every layer arrives in the plot's DATA SPACE and is scaled here, so a
 * contributor never learns the plot's pixels, its margins, its clip or its
 * paint order. That is the whole point of the seam: the host's own marks go
 * through this renderer too, so there is no geometry a first-party widget can
 * reach that a guest cannot.
 *
 * Paint order is by KIND rather than by contribution order, because the kinds
 * are a depth stack and not a list: a field is context, a region is a division
 * of the plot, a series is the reading, and a marker is where you are. Ordering
 * them by who registered first would let one Uplink's wash bury another's
 * curve. `z` orders WITHIN a kind, which is the only place a contributor has an
 * opinion worth honouring.
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

/** Series weight 1, matching `LineChart`'s own live traces. */
const BASE_STROKE_WIDTH = 1.5;
/** Marker scale 1: a dot a little larger than a scatter point, so a single
 *  "you are here" mark reads as a mark and not as one sample of a series. */
const BASE_MARKER_RADIUS = 5;
const ANNOTATION_HALF = 7;
const CAPTION_PAD = 6;
/** Every font size here stays off the type scale for the reason LineChart's
 *  own do: this `<svg>` carries no viewBox, so its user units ARE CSS px. */
const CAPTION_SIZE = 10;
const CAPTION_LABEL_SIZE = 9;
const CAPTION_LINE = 12;
const REGION_LABEL_SIZE = 9;
/** Width a rotated edge word takes out of the plot, for a corner readout to
 *  clear. One line of 9 px type plus its letter spacing. */
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
  /**
   * Whether the plot is big enough to carry a layer's text at all. False drops
   * every label and caption, the same thinning the axis tick labels already do,
   * and nothing is lost that a reader needs: a layer's `description` carries
   * its reading to the accessible name whatever the tile is doing.
   */
  labels: boolean;
}

/** Y scale for a layer, honouring its declared axis. */
function scaleYOf(frame: PlotLayerFrame, layer: PlotLayer) {
  return layer.axis === "secondary"
    ? frame.scaleYSecondary
    : frame.scaleYPrimary;
}

/** Data-space extents of everything a layer draws, for domain expansion.
 *  A caption has no position and a rule constrains one axis only, so both
 *  return partial extents rather than pretending to a point. */
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
    // A field is a wash over whatever the plot already spans: letting it pull
    // the domain would let context decide the scale the readings are drawn at.
    default:
      return { xs: [], ys: [], axis };
  }
}

/**
 * Where a mark's own label goes, once the labels already on the plot are taken
 * into account.
 *
 * Two marks at nearly the same height print two labels in the same place, and
 * on this plot that is the COMMON case rather than the edge one: the whole
 * point of a second contributor is that its settle tick sits near the host's,
 * and two ticks saying different heights that overprint each other say neither.
 *
 * Placement is the host's job for the same reason the scales are: a contributor
 * states a point and a string, and cannot know what else has been contributed.
 */
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
  // Prefer the right of the mark, and flip when the WHOLE label would not fit
  // rather than when the mark is merely near the edge: a long label on a mark
  // two thirds across still runs off, and a `β 210 kg/m²` running under the
  // region's own edge caption is what that mistake looks like.
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

/**
 * Close a half-plane along the plot's own edges. Exported for its own test:
 * the winding is the whole correctness of a region and reading it back out of
 * a rendered `points` attribute is not a test of it.
 *
 * The two corners are appended in the order the boundary's own direction
 * implies (its END first), which is what keeps the ring from crossing itself.
 * Closing it the other way draws a bow tie, which fills two triangles that mean
 * nothing, and it is the mistake every hand-rolled version of this makes once.
 */
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

  // The label runs up the region's own free edge: the half-plane's outer edge
  // for a half-plane, the boundary's far end for a band. That strip is the only
  // part of a shaded area reliably clear of what is drawn over it.
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
      // An OPEN chevron, never a filled triangle: a filled arrowhead reads as a
      // direction of travel, and on a plot whose axes are already two
      // directions that is one meaning too many. Its size carries the reading.
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

/** Stacks captions that share an anchor, so two contributors aiming at one
 *  corner read as a list rather than as one illegible overprint. */
function CaptionLayer({
  layer,
  frame,
  row,
  edges,
}: {
  layer: Extract<PlotLayer, { kind: "caption" }>;
  frame: PlotLayerFrame;
  row: number;
  /** Which vertical edge strips are already spoken for by rotated text. A
   *  corner readout that runs under one is two words in one place. */
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
  field: 0,
  region: 1,
  series: 2,
  rule: 3,
  annotation: 4,
  marker: 5,
  caption: 6,
};

/**
 * Which of the chart's three passes a kind belongs to.
 *
 * `background` goes UNDER the gridlines, because a field and a region are the
 * plot's context and a chart whose axes are buried by a guest's wash has stopped
 * being a chart. `foreground` goes over them, with the live series. `caption`
 * goes outside the clip entirely, so a corner readout is never trimmed by the
 * frame's rounded edge.
 */
export type PlotLayerPass = "background" | "foreground" | "caption";

const KIND_PASS: Record<PlotLayer["kind"], PlotLayerPass> = {
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
  // Shared across every label in this pass, so a second contributor's tick
  // steps clear of the first's rather than overprinting it.
  const placedLabels: PlacedLabel[] = [];
  // A rotated word up an edge and a corner readout running into it are two
  // readings printed on top of each other, and the corner one always loses,
  // because the rotated word is drawn later. So the corner steps inboard of any
  // strip that is spoken for, by whoever contributed it.
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

/** The clauses a plot's accessible name gains from its layers, in the order
 *  they are drawn. A layer with nothing to say adds nothing, which is what
 *  keeps an absent reading from being spoken as a zero. */
export function plotLayerDescriptions(layers: readonly PlotLayer[]): string[] {
  return layers
    .map((l) => l.description)
    .filter((d): d is string => typeof d === "string" && d.length > 0);
}
