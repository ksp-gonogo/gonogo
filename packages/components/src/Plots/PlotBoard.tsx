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
 * The smallest a plot is drawn across: narrower, its corner readouts crowd the marks, so wrapping beats shrinking further. Every plot on a board is the same square, chart and map alike, so a set reads as instruments rather than a layout accident; a spatial frame keeps itself square in its own data units.
 */
export const MIN_PLOT_PX = 120;

/** The height a plot's heading takes above its square, with the gap under it. */
const PLOT_HEADING_PX = 24;

/** How the board lays its plots out: how many sit across, and the side of every one. */
export interface PlotGrid {
  columns: number;
  side: number;
}

/**
 * The board's layout for `count` plots in a board `widthPx` wide with `gapPx` between them: as many across as stay at least `MIN_PLOT_PX`, all the same size, so a plot that wraps onto a row of its own is never drawn larger than the rest.
 * `heightPx`, when given, is the most the whole board may take, headings included: in a short tile the plots shrink to it rather than run off the bottom, down to `MIN_PLOT_PX`.
 */
export function plotGrid(
  count: number,
  widthPx: number,
  gapPx: number,
  heightPx?: number,
): PlotGrid {
  let columns = Math.max(1, count);
  while (
    columns > 1 &&
    (widthPx - gapPx * (columns - 1)) / columns < MIN_PLOT_PX
  ) {
    columns--;
  }
  const across = (widthPx - gapPx * (columns - 1)) / columns;
  const rows = Math.ceil(count / columns);
  const tall =
    heightPx == null
      ? Number.POSITIVE_INFINITY
      : (heightPx - gapPx * (rows - 1)) / rows - PLOT_HEADING_PX;
  const side = Math.min(across, Math.max(MIN_PLOT_PX, tall));
  return { columns, side: Math.max(0, Math.floor(side)) };
}

export interface PlotBoardProps {
  /** Rendered above the plots when there is at least one. Omit when the host already wrote a heading. */
  title?: string;
  /** The most height the plots may take, headings included, so a host can keep its other content in view; the plots shrink to it, never below `MIN_PLOT_PX`. */
  heightPx?: number;
}

export function PlotBoard({ title, heightPx }: Readonly<PlotBoardProps>) {
  const contributed = useContributions("plots");
  // Grouped by subject, so two contributions describing one plot draw as one.
  const plots = useMemo(() => mergePlots(contributed), [contributed]);
  const ref = useRef<HTMLDivElement>(null);
  const [measured, setMeasured] = useState({ width: 0, gap: 0 });
  const shown = plots.length > 0;
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
  most.current = Math.max(most.current, plots.length);
  if (!shown) return null;

  // Where nothing lays out, as in a test, the plots take the smallest legible square.
  const grid =
    measured.width > 0
      ? plotGrid(most.current, measured.width, measured.gap, heightPx)
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
          gap: "var(--gap-related)",
        }}
      >
        {plots.map((plot) => (
          <Plot key={plot.key} plot={plot} />
        ))}
      </div>
    </div>
  );
}

const ONE_LINE = {
  minWidth: 0,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
} as const;

/** One contributed plot, in the same square as every other, its title carrying the held badge while any contribution to it is held. */
function Plot({ plot }: { plot: MergedPlot }) {
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
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          aspectRatio: "1",
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
