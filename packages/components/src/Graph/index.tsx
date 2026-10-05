import type { ComponentProps } from "@ksp-gonogo/core";
import { registerComponent } from "@ksp-gonogo/core";
import { useTopicFieldCatalog } from "@ksp-gonogo/data";
import { useMemo } from "react";
import { GraphConfigComponent } from "./GraphConfigForm";
import { GraphView } from "./GraphView";
import { graphThresholdsOf, graphViewConfigOf } from "./savedConfig";
import type { GraphConfig } from "./types";

function GraphComponent({
  config,
  w,
  h,
}: Readonly<ComponentProps<GraphConfig>>) {
  const catalog = useTopicFieldCatalog();
  const view = useMemo(() => graphViewConfigOf(config), [config]);
  const thresholds = useMemo(
    () => graphThresholdsOf(config, catalog),
    [config, catalog],
  );
  return <GraphView config={view} thresholds={thresholds} w={w} h={h} />;
}

registerComponent<GraphConfig>({
  id: "graph",
  name: "Graph",
  description: "Line chart of one or more live telemetry series over time.",
  tags: ["telemetry", "graph"],
  defaultSize: { w: 10, h: 8 },
  minSize: { w: 5, h: 4 },
  // The plot area collapses below about 240px tall.
  mobileHeight: 280,
  component: GraphComponent,
  configComponent: GraphConfigComponent,
  openConfigOnAdd: true,
  dataRequirements: [],
  defaultConfig: { series: [], windowSec: 300 },
  actions: [],
  pushable: true,
});

export type { GraphViewProps, ReferenceCurve } from "./GraphView";
export { GraphView } from "./GraphView";
export type {
  ComputedSeries,
  GraphConfig,
  GraphSeries,
  GraphSeriesConfig,
  GraphThreshold,
  GraphThresholdConfig,
  GraphViewConfig,
} from "./types";
export { TIME_AXIS } from "./types";
export { GraphComponent };
