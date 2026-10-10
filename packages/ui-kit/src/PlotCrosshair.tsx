import { NULL_DISPLAY } from "./NullValue";
import { ReckoningMarkSvg } from "./reckoningMarkDraw";

/**
 * One line of a {@link PlotCrosshair} readout.
 *
 * @category LineGraph
 */
export interface PlotCrosshairRow {
  id: string;
  label: string;
  /** The colour of the thing the row reads, so the row ties back to its trace. */
  color: string;
  /** The reading, unit included. `null` is an absent sample and is drawn as the null token, never as a number. */
  value: string | null;
  /** How current the reading is ("measured", "modelled"), written after the value when there is room. */
  currency?: string;
  /** A model's figure: drawn with the kit's modelled mark. */
  modelled?: boolean;
  /** Dropped from the compact card of a small plot, where only the figures on the traces fit. */
  detail?: boolean;
  /** Where the row's marker stands on the plot, in pixels. Omitted for a row with no point on the plot, such as a limit. */
  y?: number | null;
}

/**
 * What a {@link PlotCrosshair} draws: where the line stands, the plot it
 * spans, the instant it names and the rows it reads.
 *
 * @category LineGraph
 */
export interface PlotCrosshairProps {
  /** Where the line stands, in pixels. */
  x: number;
  /** The plot's box, in pixels. The line spans it and the readout stays inside it. */
  plot: { x0: number; y0: number; x1: number; y1: number };
  /** Names the instant, written once above the rows. */
  heading: string;
  rows: readonly PlotCrosshairRow[];
  /**
   * A column outside the plot where the readout stands, when the chart has
   * given the card one (see `placePlotReadouts`). The card then sits at the
   * column's top and names the instant even when compact, and nothing it draws
   * covers the plot. Omitted, the card is drawn over the plot where it covers no dot.
   */
  column?: { x0: number; y0: number; x1: number; y1: number };
  /** The traces as drawn, one pixel point per sample with a non-finite `cy` for a hole. Over the plot, the card prefers a corner none of them crosses. */
  traces?: ReadonlyArray<{ cx: readonly number[]; cy: readonly number[] }>;
}

const ROW_PX = 14;
const PAD_PX = 5;
const CHAR_PX = 6.2;
const GAP_PX = 10;
const MARK_PX = 12;
const EDGE_PX = 6;
const SWATCH_PX = 8;
const DOT_PX = 4.5;
const SWATCH_GAP_PX = 4;
const MAX_COMPACT_LABEL_CHARS = 12;
const FULL_MIN_PLOT_W = 190;
const FULL_MIN_PLOT_H = 80;

interface CardLayout {
  full: boolean;
  /** The card writes the instant above its rows. */
  named: boolean;
  headingChars: number;
  /** A column card writes each row over two lines, the label then its figure, so nothing is cut. */
  stacked: boolean;
  rows: readonly PlotCrosshairRow[];
  /** What each row's text says: the label and value on a full card, a shortened label and the value on a compact one. */
  text: (row: PlotCrosshairRow) => string;
  /** The figure's own line on a stacked card. */
  valueText: (row: PlotCrosshairRow) => string;
  currencyText: (row: PlotCrosshairRow) => string;
  cardW: number;
  cardH: number;
  headRows: number;
  fits: boolean;
}

function shortened(label: string, chars: number): string {
  if (chars < 1) return "";
  return label.length <= chars
    ? label
    : `${label.slice(0, Math.max(1, chars - 1))}\u2026`;
}

function layoutCard(
  plot: PlotCrosshairProps["plot"],
  heading: string,
  allRows: readonly PlotCrosshairRow[],
  column?: PlotCrosshairProps["column"],
): CardLayout {
  const room = column ?? plot;
  const plotW = room.x1 - room.x0;
  const plotH = plot.y1 - plot.y0;
  const full = plotW >= FULL_MIN_PLOT_W && plotH >= FULL_MIN_PLOT_H;
  const named = full || column !== undefined;
  // A column has the height for the limits too, since the card covers nothing there.
  const rows = full || column ? allRows : allRows.filter((row) => !row.detail);

  // A compact row keeps its series' identity: a swatch and as much of the label as the card can hold beside the value.
  const compactRoom =
    plotW - EDGE_PX * 2 - PAD_PX * 2 - SWATCH_PX - SWATCH_GAP_PX;
  const stacked = column !== undefined;
  const stackedChars = Math.floor(compactRoom / CHAR_PX);
  const valueText = (row: PlotCrosshairRow) =>
    shortened(
      row.value ?? NULL_DISPLAY,
      stackedChars - (row.currency ? row.currency.length + 2 : 0),
    );
  const text = (row: PlotCrosshairRow) => {
    const value = row.value ?? NULL_DISPLAY;
    if (stacked) return shortened(row.label, stackedChars);
    if (full) return `${row.label}  ${value}`;
    const room =
      Math.floor((compactRoom - value.length * CHAR_PX) / CHAR_PX) -
      1 -
      (row.modelled ? 2 : 0);
    const label = shortened(row.label, Math.min(room, MAX_COMPACT_LABEL_CHARS));
    if (label !== "") return `${label} ${value}`;
    // A value wider than the card is cut rather than left to spill out of it.
    const chars = Math.floor(compactRoom / CHAR_PX) - (row.modelled ? 2 : 0);
    return shortened(value, chars);
  };
  const currencyText = (row: PlotCrosshairRow) =>
    (full || stacked) && row.currency ? row.currency : "";
  const currencyW = (row: PlotCrosshairRow) =>
    currencyText(row)
      ? GAP_PX +
        currencyText(row).length * CHAR_PX +
        (row.modelled ? MARK_PX : 0)
      : row.modelled
        ? MARK_PX
        : 0;
  const swatchW = full ? 0 : SWATCH_PX + SWATCH_GAP_PX;
  const headingChars = Math.floor((plotW - EDGE_PX * 2 - PAD_PX * 2) / CHAR_PX);

  const textW = Math.max(
    ...rows.map((row) =>
      stacked
        ? swatchW +
          Math.max(
            text(row).length * CHAR_PX,
            valueText(row).length * CHAR_PX + currencyW(row),
          )
        : swatchW + text(row).length * CHAR_PX + currencyW(row),
    ),
    named ? Math.min(heading.length, headingChars) * CHAR_PX : 0,
  );
  const headRows = named ? 1 : 0;
  const cardH =
    (rows.length * (stacked ? 2 : 1) + headRows) * ROW_PX + PAD_PX * 2;
  return {
    full,
    named,
    headingChars,
    stacked,
    rows,
    text,
    valueText,
    currencyText,
    // A column card spans its column, so the captions standing under it line up with it.
    cardW: stacked ? plotW : Math.min(textW + PAD_PX * 2, plotW - EDGE_PX * 2),
    cardH,
    headRows,
    fits: cardH <= plotH - EDGE_PX * 2,
  };
}

/** Whether any stretch of the trace passes through the box, walking each segment in steps no wider than the card's rows. */
function crossesBox(
  trace: { cx: readonly number[]; cy: readonly number[] },
  x: number,
  y: number,
  w: number,
  h: number,
): boolean {
  const inside = (px: number, py: number) =>
    px >= x && px <= x + w && py >= y && py <= y + h;
  for (let i = 1; i < trace.cx.length; i++) {
    const [ax, ay, bx, by] = [
      trace.cx[i - 1],
      trace.cy[i - 1],
      trace.cx[i],
      trace.cy[i],
    ];
    if (![ax, ay, bx, by].every(Number.isFinite)) continue;
    const steps = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / ROW_PX));
    for (let k = 0; k <= steps; k++) {
      if (inside(ax + ((bx - ax) * k) / steps, ay + ((by - ay) * k) / steps)) {
        return true;
      }
    }
  }
  return false;
}

function resolveCard({
  x,
  plot,
  heading,
  rows: allRows,
  column,
  traces = [],
}: PlotCrosshairProps): {
  layout: CardLayout;
  place: { cardX: number; cardY: number } | undefined;
} {
  const layout = layoutCard(plot, heading, allRows, column);
  const { rows, cardW, cardH, fits } = layout;
  const cardY0 = plot.y0 + EDGE_PX;
  const dots = rows.flatMap((row) =>
    row.y === undefined || row.y === null ? [] : [row.y],
  );
  const clearOfDots = (cardX: number, cardY: number) =>
    dots.every(
      (dy) =>
        x + DOT_PX < cardX ||
        x - DOT_PX > cardX + cardW ||
        dy + DOT_PX < cardY ||
        dy - DOT_PX > cardY + cardH,
    );

  // In a column the card stands there. Over the plot it takes the first corner, beside the line on the side with more room, that covers no dot.
  const roomRight = plot.x1 - x - EDGE_PX;
  const rightFirst = roomRight >= cardW || roomRight >= x - plot.x0;
  const clampX = (v: number) =>
    Math.max(plot.x0 + EDGE_PX, Math.min(plot.x1 - EDGE_PX - cardW, v));
  const sideXs = rightFirst
    ? [x + EDGE_PX, x - EDGE_PX - cardW]
    : [x - EDGE_PX - cardW, x + EDGE_PX];
  const corners = [cardY0, plot.y1 - EDGE_PX - cardH].flatMap((cy) =>
    sideXs.map((cx) => ({ cardX: clampX(cx), cardY: cy })),
  );
  const clearOfTraces = (cardX: number, cardY: number) =>
    traces.every((t) => !crossesBox(t, cardX, cardY, cardW, cardH));
  const overPlot =
    corners.find(
      (c) => clearOfDots(c.cardX, c.cardY) && clearOfTraces(c.cardX, c.cardY),
    ) ?? corners.find((c) => clearOfDots(c.cardX, c.cardY));
  const place = !fits
    ? undefined
    : column
      ? { cardX: column.x0, cardY: column.y0 + EDGE_PX }
      : overPlot;
  return { layout, place };
}

/**
 * Whether {@link PlotCrosshair} draws its readout card for these props: the
 * card fits, and over the plot there is a corner that covers no dot. A chart
 * that drew a legend in the same place hides it while the card is up, since
 * each row names its series in its colour.
 *
 * @category LineGraph
 */
export function plotCrosshairShowsCard(
  props: Pick<
    PlotCrosshairProps,
    "x" | "plot" | "heading" | "rows" | "column" | "traces"
  >,
): boolean {
  return resolveCard(props).place !== undefined;
}

/**
 * A crosshair for an SVG plot: a vertical line at an instant, a dot on each
 * trace where it is read, and a readout of every row's exact value.
 *
 * The readout is drawn over the plot at a fixed corner on whichever side of
 * the line has room, so moving the line never resizes or reflows the chart. A
 * plot too small for the full card gets a compact one: a swatch, as much of
 * the label as fits, and the value, so an absent row still says whose it is.
 * An absent reading is the null token. Place it as the last child of the
 * plot's `<svg>`; it takes no pointer events, so the plot keeps them.
 *
 * @category LineGraph
 */
export function PlotCrosshair({
  x,
  plot,
  heading,
  rows: allRows,
  column,
}: PlotCrosshairProps) {
  const { layout, place } = resolveCard({
    x,
    plot,
    heading,
    rows: allRows,
    column,
  });
  const {
    full,
    named,
    headingChars,
    stacked,
    rows,
    text,
    valueText,
    currencyText,
    cardW,
    cardH,
    headRows,
  } = layout;
  const drawn = place !== undefined;
  const cardX = place?.cardX ?? 0;
  const cardY = place?.cardY ?? 0;
  const textX = (cx: number) =>
    cx + PAD_PX + (full ? 0 : SWATCH_PX + SWATCH_GAP_PX);

  return (
    <g pointerEvents="none" data-plot-crosshair="">
      <line
        x1={x}
        y1={plot.y0}
        x2={x}
        y2={plot.y1}
        stroke="var(--color-text-primary)"
        strokeWidth={1}
        opacity={0.7}
      />
      {rows.map((row) =>
        row.y === undefined || row.y === null ? null : (
          <circle
            key={row.id}
            cx={x}
            cy={row.y}
            r={3.5}
            fill={row.color}
            stroke="var(--color-text-primary)"
            strokeWidth={1}
          />
        ),
      )}
      {drawn && (
        <g data-plot-crosshair-card="">
          <rect
            x={cardX}
            y={cardY}
            width={cardW}
            height={cardH}
            rx={3}
            fill="var(--color-surface-panel)"
            stroke="var(--color-border-strong)"
          />
          {named && (
            <text
              x={cardX + PAD_PX}
              y={cardY + PAD_PX + 10}
              fill="var(--color-text-muted)"
              fontSize={10}
            >
              {shortened(heading, headingChars)}
            </text>
          )}
          {rows.map((row, i) => {
            const lines = stacked ? 2 : 1;
            const labelBaseline =
              cardY + PAD_PX + (i * lines + headRows) * ROW_PX + 10;
            // A stacked card gives the figure the line under the label.
            const baseline = labelBaseline + (stacked ? ROW_PX : 0);
            return (
              <g key={row.id} data-plot-crosshair-row={row.id}>
                {!full && (
                  <rect
                    x={cardX + PAD_PX}
                    y={labelBaseline - 8}
                    width={SWATCH_PX}
                    height={SWATCH_PX}
                    fill={row.color}
                    data-plot-crosshair-swatch=""
                  />
                )}
                <text
                  x={textX(cardX)}
                  y={labelBaseline}
                  fill={
                    row.value === null || stacked
                      ? "var(--color-text-faint)"
                      : row.color
                  }
                  fontSize={10}
                  style={{ whiteSpace: "pre" }}
                >
                  {text(row)}
                </text>
                {stacked && (
                  <text
                    x={textX(cardX)}
                    y={baseline}
                    fill={
                      row.value === null ? "var(--color-text-faint)" : row.color
                    }
                    fontSize={10}
                    style={{ whiteSpace: "pre" }}
                  >
                    {valueText(row)}
                  </text>
                )}
                {row.modelled && (
                  <ReckoningMarkSvg
                    kind="modelled"
                    x={
                      cardX +
                      cardW -
                      PAD_PX -
                      currencyText(row).length * CHAR_PX -
                      (currencyText(row) ? 8 : 4)
                    }
                    y={baseline - 3}
                  />
                )}
                {currencyText(row) && (
                  <text
                    x={cardX + cardW - PAD_PX}
                    y={baseline}
                    textAnchor="end"
                    fill="var(--color-text-faint)"
                    fontSize={10}
                  >
                    {currencyText(row)}
                  </text>
                )}
              </g>
            );
          })}
        </g>
      )}
    </g>
  );
}
