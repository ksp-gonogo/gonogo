import { useContributions } from "@ksp-gonogo/core";
import { Cluster, HeldBadge, SectionTitle } from "@ksp-gonogo/ui-kit";
import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { GraphView } from "../Graph";
import { type MergedPlot, mergePlots } from "./mergePlots";

/**
 * The `plots` arranger: it decides how many plots sit across, the gutters,
 * each heading, and whether the plots region exists at all, and nothing a plot
 * said about itself. A plot arrives having decided it is relevant by returning
 * entries from `compute`. Zero drawable plots renders nothing, not an empty
 * frame.
 */

/**
 * The smallest a plot is drawn across: narrower, its corner readouts crowd the marks, so wrapping beats shrinking further. Every plot on a board is the same height, chart and map alike, so a set reads as instruments rather than a layout accident; a board with width to spare spaces them out across it, and a spatial frame keeps itself square in its own data units.
 */
export const MIN_PLOT_PX = 120;

/** The height of a plot's heading row with a held badge beside the title, which the row keeps without one so a badge arriving moves nothing below it. */
const HEADING_ROW_PX = 17;

/** The height a plot's heading takes above its square, with the gap under it. */
const PLOT_HEADING_PX = HEADING_ROW_PX + 8;

/** The share of the largest plot size a layout of full rows must keep to be chosen over one that leaves a row short. */
const EVEN_ROWS_MIN_SHARE = 0.8;

/** How the board lays its plots out: how many sit across, and the side of every one. */
export interface PlotGrid {
  columns: number;
  side: number;
}

/**
 * The board's layout for `count` plots in a board `widthPx` wide with `gapPx` between them: the number across, up to `maxColumns` and no fewer than keeps each at least `MIN_PLOT_PX`, that gives the largest square, all the same size, so a plot that wraps onto a row of its own is never drawn larger than the rest.
 * `heightPx`, when given, is the most the whole board may take, headings included: in a short tile the plots shrink to it rather than run off the bottom, down to `minSide` (`MIN_PLOT_PX` unless the host asks for larger), though never wider than the board allows.
 */
export function plotGrid(
  count: number,
  widthPx: number,
  gapPx: number,
  heightPx?: number,
  maxColumns = Number.POSITIVE_INFINITY,
  minSide = MIN_PLOT_PX,
): PlotGrid {
  const layout = (columns: number): PlotGrid => {
    const across = (widthPx - gapPx * (columns - 1)) / columns;
    const rows = Math.ceil(count / columns);
    const tall =
      heightPx == null
        ? Number.POSITIVE_INFINITY
        : (heightPx - gapPx * (rows - 1)) / rows - PLOT_HEADING_PX;
    const side = Math.min(across, Math.max(minSide, tall));
    return { columns, side: Math.max(0, Math.floor(side)) };
  };
  const most = Math.max(1, Math.min(count, maxColumns));
  // With no height to answer to, the squares only grow by taking fewer across, so the board sits as many across as it is allowed.
  if (heightPx == null) {
    let columns = most;
    while (
      columns > 1 &&
      (widthPx - gapPx * (columns - 1)) / columns < MIN_PLOT_PX
    ) {
      columns--;
    }
    return layout(columns);
  }
  let best = layout(1);
  // A wide, short board puts more across rather than leaving its width unused; the most columns that reach the largest square win, so a tile short on height shows the plots in fewer rows.
  for (let columns = 2; columns <= most; columns++) {
    if ((widthPx - gapPx * (columns - 1)) / columns < MIN_PLOT_PX) break;
    const next = layout(columns);
    if (next.side >= best.side) best = next;
  }
  // A grid whose rows are all full and which spans more of the board is preferred to the largest squares, unless it costs the plots a fifth of their size: a lone plot on the last row and an empty strip beside the rest are what it avoids.
  const spread = (g: PlotGrid) => g.columns * g.side;
  let chosen = best;
  for (let columns = 1; columns <= most; columns++) {
    if (count % columns !== 0) continue;
    if ((widthPx - gapPx * (columns - 1)) / columns < MIN_PLOT_PX) break;
    const even = layout(columns);
    if (
      even.side >= best.side * EVEN_ROWS_MIN_SHARE &&
      (count % chosen.columns !== 0 || spread(even) > spread(chosen))
    ) {
      chosen = even;
    }
  }
  return chosen;
}

/** A place the board keeps for a plot whether or not it has anything to draw: its frame stays, and `note` is what the frame says until the plot arrives. */
export interface PlotSlot {
  /** The subject of the plot that fills the slot. */
  subject: string;
  /** The heading above the slot while its plot is absent. */
  title: string;
  /** What the empty frame says. */
  note: string;
}

export interface PlotBoardProps {
  /** Rendered above the plots when there is at least one. Omit when the host already wrote a heading. */
  title?: string;
  /** The most height the plots may take, headings included, so a host can keep its other content in view; the plots shrink to it, never below `minPlotPx`. */
  heightPx?: number;
  /** The smallest a plot is drawn across, for a host whose plots carry corner readouts that crowd one another below it. Defaults to `MIN_PLOT_PX`. */
  minPlotPx?: number;
  /** The most plots sat across, so a host with a few plots draws them larger than the narrowest they could be. */
  maxColumns?: number;
  /** Plots the host expects through its whole life, in the order they sit: each keeps its place, drawn as an empty frame while its plot is absent, so a plot arriving or leaving moves nothing. Plots contributed beyond them follow. */
  reserve?: readonly PlotSlot[];
}

interface Slot {
  key: string;
  plot?: MergedPlot;
  empty?: PlotSlot;
}

function slotsOf(
  plots: readonly MergedPlot[],
  reserve: readonly PlotSlot[],
): Slot[] {
  const reserved = new Set(reserve.map((r) => r.subject));
  return [
    ...reserve.map((r) => ({
      key: r.subject,
      plot: plots.find((p) => p.subject === r.subject),
      empty: r,
    })),
    ...plots
      .filter((p) => !reserved.has(p.subject))
      .map((p) => ({ key: p.key, plot: p })),
  ];
}

export function PlotBoard({
  title,
  heightPx,
  maxColumns,
  minPlotPx,
  reserve = [],
}: Readonly<PlotBoardProps>) {
  const contributed = useContributions("plots");
  // Grouped by subject, so two contributions describing one plot draw as one.
  const plots = useMemo(() => mergePlots(contributed), [contributed]);
  const ref = useRef<HTMLDivElement>(null);
  const [measured, setMeasured] = useState({ width: 0, gap: 0 });
  const slots = slotsOf(plots, reserve);
  const shown = slots.length > 0;
  // Measured before the first paint, so the plots are never drawn at a placeholder size and then jump to their own. The gutter is a theme token, so its pixels are read off the board rather than restated here.
  useLayoutEffect(() => {
    const board = ref.current;
    if (!shown || !board) return;
    const read = (width: number) => {
      const gap = Number.parseFloat(getComputedStyle(board).columnGap);
      const next = {
        width: Math.floor(width),
        gap: Number.isFinite(gap) ? gap : 0,
      };
      setMeasured((prev) =>
        prev.width === next.width && prev.gap === next.gap ? prev : next,
      );
    };
    read(board.getBoundingClientRect().width);
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width;
      if (width != null && width > 0) read(width);
    });
    observer.observe(board);
    return () => observer.disconnect();
  }, [shown]);
  // Sized for the most plots the board has held, so a plot that leaves (the descent envelope at touchdown) does not grow the rest mid-flight.
  const most = useRef(0);
  most.current = Math.max(most.current, slots.length);
  if (!shown) return null;

  // Where nothing lays out, as in a test, the plots take the smallest legible square.
  const grid =
    measured.width > 0
      ? plotGrid(
          most.current,
          measured.width,
          measured.gap,
          heightPx,
          maxColumns,
          minPlotPx,
        )
      : { columns: most.current, side: MIN_PLOT_PX };

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "var(--gap-related)",
      }}
    >
      {title && <SectionTitle>{title}</SectionTitle>}
      <div
        ref={ref}
        data-plot-columns={grid.columns}
        style={{
          display: "grid",
          gridTemplateColumns: `repeat(${grid.columns}, ${grid.side}px)`,
          // The squares keep their size and share out the room left across the board, so the right edge is not left empty.
          justifyContent: "space-between",
          gap: "var(--gap-related)",
        }}
      >
        {slots.map((slot) =>
          slot.plot ? (
            <Plot key={slot.key} plot={slot.plot} side={grid.side} />
          ) : slot.empty ? (
            <EmptyPlot key={slot.key} slot={slot.empty} side={grid.side} />
          ) : null,
        )}
      </div>
    </div>
  );
}

const HEADING_ROW = { minWidth: 0, minHeight: HEADING_ROW_PX } as const;

const ONE_LINE = {
  minWidth: 0,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
} as const;

/** One contributed plot, in the same square as every other, its title carrying the held badge while any contribution to it is held. */
function Plot({ plot, side }: { plot: MergedPlot; side: number }) {
  return (
    <div
      style={{
        minWidth: 0,
        display: "flex",
        flexDirection: "column",
        gap: "var(--gap-related)",
      }}
    >
      {/* One line whatever the plot's width: a heading that wrapped when a held badge joined it would push the plot down mid-flight. The full title is in the tooltip and the chart's own name. */}
      <div style={HEADING_ROW}>
        {plot.held === undefined ? (
          <SectionTitle style={ONE_LINE} data-tooltip={plot.title}>
            {plot.title}
          </SectionTitle>
        ) : (
          <Cluster align="baseline">
            <SectionTitle style={ONE_LINE} data-tooltip={plot.title}>
              {plot.title}
            </SectionTitle>
            <span style={{ flexShrink: 0 }}>
              <HeldBadge grade={plot.held} subject={plot.title} size="sm" />
            </span>
          </Cluster>
        )}
      </div>
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          width: side,
          height: side,
          minHeight: 0,
        }}
      >
        <GraphView
          chrome="bare"
          aria-label={plot.title}
          layers={plot.layers}
          config={{
            series: [],
            windowSec: 0,
            xDomain: plot.frame.xDomain,
            xUnit: plot.frame.xUnit,
            hideXAxis: plot.frame.hideXAxis,
            spatial: plot.frame.kind === "spatial",
            gridScale: plot.frame.gridScale,
            yDomainPrimary: plot.frame.yDomain,
            yUnit: plot.frame.yUnit,
            yDomainSecondary: plot.frame.ySecondaryDomain,
            yScalePrimary: plot.frame.yScale === "log" ? "log" : "linear",
          }}
        />
      </div>
    </div>
  );
}

/** A reserved slot with no plot: the same heading and square as a plot, its frame drawn empty with the note across it. */
function EmptyPlot({ slot, side }: { slot: PlotSlot; side: number }) {
  return (
    <div
      style={{
        minWidth: 0,
        display: "flex",
        flexDirection: "column",
        gap: "var(--gap-related)",
      }}
    >
      <div style={HEADING_ROW}>
        <SectionTitle style={ONE_LINE} data-tooltip={slot.title}>
          {slot.title}
        </SectionTitle>
      </div>
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          width: side,
          height: side,
          minHeight: 0,
        }}
      >
        <GraphView
          chrome="bare"
          aria-label={`${slot.title}: ${slot.note}`}
          // The note is a caption, so the frame has a layer and the chart draws it rather than its own "configure series" notice, whose placement would move with the plot's size.
          layers={[
            {
              kind: "caption",
              id: "awaiting",
              anchor: "top-left",
              text: slot.note,
              tone: "neutral",
            },
          ]}
          config={{
            series: [],
            windowSec: 0,
            xDomain: [-1, 1],
            spatial: true,
            yDomainPrimary: [-1, 1],
          }}
        />
      </div>
    </div>
  );
}
