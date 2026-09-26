import { registerComponent } from "@ksp-gonogo/core";
import {
  AUTO_PAIR,
  type LibrationPointsConfig,
  librationPointsActions,
} from "./config";
import { LibrationPointsConfigForm } from "./LibrationPointsConfigForm";
import { LibrationPointsComponent } from "./LibrationPointsView";
import { librationPointsTopics } from "./topics";

export type { LibrationPointsActions } from "./config";

/**
 * Libration points as places: where a body pair's five are, and how far off
 * one of them a craft is. A libration point stands still only in a frame
 * co-rotating with its pair, so the pair is the frame and the widget's one
 * control. It is drawn in the pair's own units rather than on the metric
 * system diagram, where the markers would walk in and out once per orbit.
 */
registerComponent<LibrationPointsConfig>({
  id: "libration-points",
  name: "Libration Points",
  description:
    "The five libration points of a body pair, drawn in the frame that turns with it so they hold still, with the craft's offset from the one it is nearest.",
  tags: ["telemetry", "navigation"],
  defaultSize: { w: 6, h: 10 },
  minSize: { w: 4, h: 7 },
  component: LibrationPointsComponent,
  configComponent: LibrationPointsConfigForm,
  channels: librationPointsTopics.channels,
  optionalChannels: librationPointsTopics.optionalChannels,
  defaultConfig: { pair: AUTO_PAIR },
  actions: librationPointsActions,
  pushable: true,
});

export { LibrationDiagram } from "./LibrationDiagram";
export { LibrationPointsComponent };
