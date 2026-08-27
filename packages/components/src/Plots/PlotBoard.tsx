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

/** A plot narrower than this is unreadable, so wrapping beats shrinking. */
const MIN_PLOT_WIDTH_PX = 200;
/**
 * The tallest a plot is allowed to be, whatever shape it asked for.
 *
 * `aspect` is a proportion, and a proportion in a column narrower than the
 * arranger expected turns into a height. A plot asking to be three times as
 * tall as it is wide got 600 px in a 200 px column and filled the widget with
 * one marker on an empty scale, which is a plot that has been honoured into
 * uselessness. The cap is the arranger doing the one job it has: a plot states
 * its shape and the arranger decides how much room that is worth here.
 */
const MAX_PLOT_HEIGHT_PX = 300;

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
 * `aspect` is honoured through `aspect-ratio` on a flex-basis box rather than a
 * fixed height, so a plot keeps its proportions as the row wraps and the column
 * widths change. A plot that wants to be tall and narrow (an altitude rail) and
 * one that wants to be square (a touchdown reticle) share the row without
 * either being told what its shape is worth.
 */
function Plot({ plot }: { plot: MergedPlot }) {
  const aspect = plot.aspect && plot.aspect > 0 ? plot.aspect : 1;
  // A wide plot earns proportionally more of the row, so three squares and one
  // 3:1 panorama do not come out the same width. Clamped below at the minimum
  // legible width rather than at the basis, so the shape drives the share and
  // the floor drives the wrap.
  const basisPx = Math.max(MIN_PLOT_WIDTH_PX, MIN_PLOT_WIDTH_PX * aspect);

  return (
    <div
      style={{
        flex: `1 1 ${basisPx}px`,
        minWidth: MIN_PLOT_WIDTH_PX,
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
          aspectRatio: `${aspect}`,
          maxHeight: MAX_PLOT_HEIGHT_PX,
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
