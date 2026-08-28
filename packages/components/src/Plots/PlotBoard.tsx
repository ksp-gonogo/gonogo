import { useContributions } from "@ksp-gonogo/core";
import { SectionTitle } from "@ksp-gonogo/ui-kit";
import { useMemo } from "react";
import { GraphView } from "../Graph";
import { type MergedPlot, mergePlots } from "./mergePlots";

/**
 * The `plots` arranger: it lays out whatever plots are contributed and decides
 * nothing about any of them.
 *
 * What it may decide is the whole of this file: how many plots sit across at
 * the width it has, the gutters between them, the heading over each one, and
 * whether the plots region exists at all. What it may not decide is anything a
 * plot said about itself: no domain is rescaled, no layer is dropped, no tone is
 * reinterpreted, no plot with a mark on it is withheld, and none is re-ordered
 * beyond the `priority` the registry already sorted by.
 *
 * That split is what makes the seam a capability rather than a favour. A plot
 * arrives here having already decided that it is RELEVANT, by the only route a
 * contribution has: it returned entries from `compute` instead of `null`. An
 * arranger that could second-guess that would be deciding what the operator
 * sees, from a widget that knows nothing about the plot's subject.
 *
 * The two exceptions are enforcement of that rule rather than departures from
 * it: an entry with NO layers is dropped, and entries sharing a SUBJECT are
 * merged onto one frame. Both live in `mergePlots`, which carries the
 * reasoning.
 *
 * Zero drawable plots renders nothing at all, not an empty frame and not a
 * heading over a gap. A widget with no plot to show this frame has no plots
 * region, which is the same absence discipline every plot follows internally.
 */

/**
 * A plot narrower than this is unreadable, so wrapping beats shrinking.
 *
 * It is also the only dimension in this file, because EVERY plot on a board is
 * the same square. Not similar, not whatever the content wants: one size, one
 * shape, for the chart and the maps alike. A row of boxes that are each a
 * slightly different height reads as a layout accident rather than as a set of
 * instruments, and the operator sees the difference before they see anything
 * drawn in them. Being a chart changes what goes INSIDE the square, never the
 * square.
 *
 * A spatial frame therefore has to be square in its own DATA units too, or the
 * equal scale it depends on is lost. That is the frame's job rather than the
 * arranger's, and both spatial contributions do it (see `crossSectionPlot` and
 * `touchdownReticlePlot`).
 */
const PLOT_SIZE_PX = 200;

export interface PlotBoardProps {
  /**
   * Rendered above the plots when there is at least one. Omit for a board that
   * sits under a heading its host already wrote.
   */
  title?: string;
}

export function PlotBoard({ title }: Readonly<PlotBoardProps>) {
  const contributed = useContributions("plots");
  // Grouped by SUBJECT, so two contributions describing one plot come out as
  // one plot rather than as two drawings of the same corridor. `mergePlots`
  // also drops a subject nobody framed and a plot with no marks on it; see its
  // own file for why each of those is an absence rather than a filter.
  const plots = useMemo(() => mergePlots(contributed), [contributed]);
  if (plots.length === 0) return null;

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "var(--space-6)",
      }}
    >
      {title && <SectionTitle>{title}</SectionTitle>}
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: "var(--space-6)",
        }}
      >
        {plots.map((plot) => (
          <Plot key={plot.key} plot={plot} />
        ))}
      </div>
    </div>
  );
}

/**
 * One contributed plot, in a box the shape it asked for.
 *
 * One square, the same as every other plot's. The shape is not the plot's to
 * choose: a board of identical squares is the format, and it is what lets an
 * operator compare three instruments at a glance instead of reading three
 * differently-shaped boxes.
 */
function Plot({ plot }: { plot: MergedPlot }) {
  return (
    <div
      style={{
        flex: `1 1 ${PLOT_SIZE_PX}px`,
        minWidth: PLOT_SIZE_PX,
        display: "flex",
        flexDirection: "column",
        gap: "var(--space-4)",
      }}
    >
      <SectionTitle>{plot.title}</SectionTitle>
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          // Square, every one of them, and the only shape any plot gets.
          aspectRatio: "1",
          minHeight: 0,
        }}
      >
        <GraphView
          chrome="bare"
          ariaLabel={plot.title}
          layers={plot.layers}
          config={{
            series: [],
            windowSec: 0,
            xDomain: plot.frame.xDomain,
            xUnit: plot.frame.xUnit,
            hideXAxis: plot.frame.hideXAxis,
            spatial: plot.frame.kind === "spatial",
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
