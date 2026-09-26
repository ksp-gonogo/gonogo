import { registerComponent } from "@ksp-gonogo/core";
import {
  PerfBudgetsComponent,
  type PerfBudgetsConfig,
} from "./PerfBudgetsView";

registerComponent<PerfBudgetsConfig>({
  id: "perf-budgets",
  name: "Perf Budgets",
  description:
    "Live view of every registered PerfBudget: current rate vs soft cap, with exceedance counts. Updates 1 Hz. Useful for spotting performance regressions at a glance during development or real flights.",
  tags: ["debug", "perf"],
  defaultSize: { w: 6, h: 6 },
  minSize: { w: 3, h: 3 },
  component: PerfBudgetsComponent,
  dataRequirements: [],
  defaultConfig: {},
  actions: [],
  pushable: true,
});

export { PerfBudgetsComponent };
