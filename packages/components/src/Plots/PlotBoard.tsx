import { useContributions } from "@ksp-gonogo/core";
import { SectionTitle } from "@ksp-gonogo/ui-kit";
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
 * A plot narrower than this is unreadable, so wrapping beats shrinking. Every
 * plot on a board is the same square, chart and map alike, so a set reads as
 * instruments rather than a layout accident; a spatial frame keeps itself
 * square in its own data units.
 */
const PLOT_SIZE_PX = 200;

export interface PlotBoardProps {
  /** Rendered above the plots when there is at least one. Omit when the host already wrote a heading. */
  title?: string;
}

export function PlotBoard({ title }: Readonly<PlotBoardProps>) {
  const contributed = useContributions("plots");
  // Grouped by subject, so two contributions describing one plot draw as one.
  const plots = useMemo(() => mergePlots(contributed), [contributed]);
  if (plots.length === 0) return null;

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
        style={{
          display: "flex",
          flexWrap: "wrap",
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

/** One contributed plot, in the same square as every other. */
function Plot({ plot }: { plot: MergedPlot }) {
  return (
    <div
      style={{
        flex: `1 1 ${PLOT_SIZE_PX}px`,
        minWidth: PLOT_SIZE_PX,
        display: "flex",
        flexDirection: "column",
        gap: "var(--gap-related)",
      }}
    >
      <SectionTitle>{plot.title}</SectionTitle>
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
