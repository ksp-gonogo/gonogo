import { useContributions } from "@ksp-gonogo/core";
import { Cluster, HeldBadge, SectionTitle } from "@ksp-gonogo/ui-kit";
import { useMemo } from "react";
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
 * The smallest a plot is drawn across: narrower, its corner readouts crowd the marks, so the board wraps onto another row rather than shrink further. A board with more width than that grows its plots to share it, every plot the same square, so the set reads as instruments rather than a layout accident.
 */
export const MIN_PLOT_PX = 120;

/** The height of a plot's heading row with a held badge beside the title, which the row keeps without one so a badge arriving moves nothing below it. */
const HEADING_ROW_PX = 17;

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
  /** The smallest a plot is drawn across, for a host whose plots carry corner readouts that crowd one another below it. Defaults to `MIN_PLOT_PX`. */
  minPlotPx?: number;
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
  minPlotPx = MIN_PLOT_PX,
  reserve = [],
}: Readonly<PlotBoardProps>) {
  const contributed = useContributions("plots");
  // Grouped by subject, so two contributions describing one plot draw as one.
  const plots = useMemo(() => mergePlots(contributed), [contributed]);
  const slots = slotsOf(plots, reserve);
  if (slots.length === 0) return null;

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
        data-plot-board=""
        style={{
          display: "grid",
          // As many columns as fit at the smallest plot, each taking an equal share of the width; the plot is a square of its cell.
          gridTemplateColumns: `repeat(auto-fit, minmax(min(100%, ${minPlotPx}px), 1fr))`,
          gap: "var(--gap-related)",
        }}
      >
        {slots.map((slot) =>
          slot.plot ? (
            <Plot key={slot.key} plot={slot.plot} />
          ) : slot.empty ? (
            <EmptyPlot key={slot.key} slot={slot.empty} />
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
          width: "100%",
          aspectRatio: "1 / 1",
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
function EmptyPlot({ slot }: { slot: PlotSlot }) {
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
          width: "100%",
          aspectRatio: "1 / 1",
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
