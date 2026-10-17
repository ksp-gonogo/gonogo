import { useContributions } from "@ksp-gonogo/core";
import { Cluster, Grid, HeldBadge, SectionTitle } from "@ksp-gonogo/ui-kit";
import { type ReactNode, useMemo } from "react";
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
 * The smallest a plot is drawn: narrower, its corner readouts crowd the marks, so the board takes the height to keep its plots this large and its host scrolls past it, unless the host's visible height is shorter still.
 */
export const MIN_PLOT_PX = 120;

/** The height of a plot's heading row with a held badge beside the title, which the row keeps without one so a badge arriving moves nothing below it. */
const HEADING_ROW_PX = 17;

/** The narrowest square whose heading holds a reserved plot's whole title: below it the heading row is given to the plot, and the title stays in the plot's accessible name and tooltip. */
const TITLED_PLOT_PX = 128;

/**
 * The width a single row of `count` plots takes as tall as the nearest size container, for a host that sets the board beside its other content. The row allows no heading band, so a row too short for headings draws its plots the full height.
 */
export function plotRowWidth(count: number): string {
  return `calc(${count} * 100cqh + ${count - 1} * var(--gap-related))`;
}

/** The plots a board draws: the host's reserved slots, then any contributed beyond them. */
export function usePlotSlots(reserve: readonly PlotSlot[] = []) {
  const contributed = useContributions("plots");
  // Grouped by subject, so two contributions describing one plot draw as one.
  const plots = useMemo(() => mergePlots(contributed), [contributed]);
  return slotsOf(plots, reserve);
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
  /** The smallest a plot is drawn, for a host whose plots carry corner readouts that crowd one another below it. Defaults to `MIN_PLOT_PX`. */
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
  const slots = usePlotSlots(reserve);
  if (slots.length === 0) return null;
  // A held badge has to be seen, so while any plot carries one every heading row stays and the squares stay level.
  const keepHeadings = slots.some((slot) => slot.plot?.held !== undefined);

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "var(--gap-related)",
        flex: "1 1 auto",
        minHeight: 0,
      }}
    >
      {title && <SectionTitle>{title}</SectionTitle>}
      {/* Every plot the same square, in as many columns as draws them largest in the room the host gives the board. */}
      <Grid
        squares
        squareHeadingPx={HEADING_ROW_PX}
        squareHeadingMinPx={keepHeadings ? undefined : TITLED_PLOT_PX}
        minColWidth={`${minPlotPx}px`}
        gap="related"
        data-plot-board=""
      >
        {slots.map((slot) =>
          slot.plot ? (
            <Plot key={slot.key} plot={slot.plot} />
          ) : slot.empty ? (
            <EmptyPlot key={slot.key} slot={slot.empty} />
          ) : null,
        )}
      </Grid>
    </div>
  );
}

/**
 * One cell of the board: the largest square the cell holds, centred, under a
 * heading row every plot keeps while the board gives it one.
 */
function PlotCell({
  heading,
  children,
}: {
  heading: ReactNode;
  children: ReactNode;
}) {
  return (
    <div
      data-plot-cell=""
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <div
        style={{
          width: "min(100cqw, 100cqh - var(--grid-square-heading))",
          display: "flex",
          flexDirection: "column",
          gap: "var(--gap-related)",
        }}
      >
        <div
          data-plot-heading=""
          data-grid-square-heading=""
          style={{ minWidth: 0, height: HEADING_ROW_PX }}
        >
          {heading}
        </div>
        <div
          data-plot-square=""
          style={{
            display: "flex",
            flexDirection: "column",
            width: "100%",
            aspectRatio: "1 / 1",
            minHeight: 0,
          }}
        >
          {children}
        </div>
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
    <PlotCell
      heading={
        // One line whatever the plot's width: a heading that wrapped when a held badge joined it would push the plot down mid-flight. The full title is in the tooltip and the chart's own name.
        plot.held === undefined ? (
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
        )
      }
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
    </PlotCell>
  );
}

/** A reserved slot with no plot: the same heading and square as a plot, its frame drawn empty with the note across it. */
function EmptyPlot({ slot }: { slot: PlotSlot }) {
  return (
    <PlotCell
      heading={
        <SectionTitle style={ONE_LINE} data-tooltip={slot.title}>
          {slot.title}
        </SectionTitle>
      }
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
    </PlotCell>
  );
}
