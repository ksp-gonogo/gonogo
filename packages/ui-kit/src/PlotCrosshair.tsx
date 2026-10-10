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
}

const ROW_PX = 14;
const PAD_PX = 5;
const CHAR_PX = 6.2;
const GAP_PX = 10;
const MARK_PX = 12;
const EDGE_PX = 6;
const SWATCH_PX = 8;
const SWATCH_GAP_PX = 4;
const MAX_COMPACT_LABEL_CHARS = 12;
const FULL_MIN_PLOT_W = 190;
const FULL_MIN_PLOT_H = 80;

interface CardLayout {
  full: boolean;
  rows: readonly PlotCrosshairRow[];
  /** What each row's text says: the label and value on a full card, a shortened label and the value on a compact one. */
  text: (row: PlotCrosshairRow) => string;
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
): CardLayout {
  const plotW = plot.x1 - plot.x0;
  const plotH = plot.y1 - plot.y0;
  const full = plotW >= FULL_MIN_PLOT_W && plotH >= FULL_MIN_PLOT_H;
  const rows = full ? allRows : allRows.filter((row) => !row.detail);

  // A compact row keeps its series' identity: a swatch and as much of the label as the card can hold beside the value.
  const compactRoom =
    plotW - EDGE_PX * 2 - PAD_PX * 2 - SWATCH_PX - SWATCH_GAP_PX;
  const text = (row: PlotCrosshairRow) => {
    const value = row.value ?? NULL_DISPLAY;
    if (full) return `${row.label}  ${value}`;
    const room =
      Math.floor((compactRoom - value.length * CHAR_PX) / CHAR_PX) -
      1 -
      (row.modelled ? 2 : 0);
    const label = shortened(row.label, Math.min(room, MAX_COMPACT_LABEL_CHARS));
    return label === "" ? value : `${label} ${value}`;
  };
  const currencyText = (row: PlotCrosshairRow) =>
    full && row.currency ? row.currency : "";
  const currencyW = (row: PlotCrosshairRow) =>
    currencyText(row)
      ? GAP_PX +
        currencyText(row).length * CHAR_PX +
        (row.modelled ? MARK_PX : 0)
      : row.modelled
        ? MARK_PX
        : 0;
  const swatchW = full ? 0 : SWATCH_PX + SWATCH_GAP_PX;

  const textW = Math.max(
    ...rows.map((row) => swatchW + text(row).length * CHAR_PX + currencyW(row)),
    full ? heading.length * CHAR_PX : 0,
  );
  const headRows = full ? 1 : 0;
  const cardH = (rows.length + headRows) * ROW_PX + PAD_PX * 2;
  return {
    full,
    rows,
    text,
    currencyText,
    cardW: Math.min(textW + PAD_PX * 2, plotW - EDGE_PX * 2),
    cardH,
    headRows,
    fits: cardH <= plotH - EDGE_PX * 2,
  };
}

/**
 * Whether {@link PlotCrosshair} has room to draw its readout card for these
 * rows on this plot. A chart that drew a legend in the same corner hides it
 * while the card is up, since each row names its series in its colour.
 *
 * @category LineGraph
 */
export function plotCrosshairShowsCard(
  plot: PlotCrosshairProps["plot"],
  rows: readonly PlotCrosshairRow[],
): boolean {
  return layoutCard(plot, "", rows).fits;
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
}: PlotCrosshairProps) {
  const { full, rows, text, currencyText, cardW, cardH, headRows, fits } =
    layoutCard(plot, heading, allRows);

  // Beside the line, on the side with more room.
  const roomRight = plot.x1 - x - EDGE_PX;
  const onRight = roomRight >= cardW || roomRight >= x - plot.x0;
  const cardX = Math.max(
    plot.x0 + EDGE_PX,
    Math.min(
      plot.x1 - EDGE_PX - cardW,
      onRight ? x + EDGE_PX : x - EDGE_PX - cardW,
    ),
  );
  const cardY = plot.y0 + EDGE_PX;
  const textX = cardX + PAD_PX + (full ? 0 : SWATCH_PX + SWATCH_GAP_PX);

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
      {fits && (
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
          {full && (
            <text
              x={cardX + PAD_PX}
              y={cardY + PAD_PX + 10}
              fill="var(--color-text-muted)"
              fontSize={10}
            >
              {heading}
            </text>
          )}
          {rows.map((row, i) => {
            const baseline = cardY + PAD_PX + (i + headRows) * ROW_PX + 10;
            return (
              <g key={row.id} data-plot-crosshair-row={row.id}>
                {!full && (
                  <rect
                    x={cardX + PAD_PX}
                    y={baseline - 8}
                    width={SWATCH_PX}
                    height={SWATCH_PX}
                    fill={row.color}
                    data-plot-crosshair-swatch=""
                  />
                )}
                <text
                  x={textX}
                  y={baseline}
                  fill={
                    row.value === null ? "var(--color-text-faint)" : row.color
                  }
                  fontSize={10}
                  style={{ whiteSpace: "pre" }}
                >
                  {text(row)}
                </text>
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
