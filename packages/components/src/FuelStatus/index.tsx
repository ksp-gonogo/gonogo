import type { ComponentProps } from "@ksp-gonogo/core";
import { registerComponent, useTelemetry } from "@ksp-gonogo/core";
import { DELTA_V_BUDGET, useProcessor } from "@ksp-gonogo/sitrep-client";
import {
  stillTrue,
  type TinyEssential,
  type Value,
  value,
} from "@ksp-gonogo/sitrep-sdk";
import {
  getWidgetShape,
  Panel,
  ReadoutCaption,
  Section,
} from "@ksp-gonogo/ui-kit";
import type { ReactNode } from "react";
import { magnitudeOf } from "../shared/magnitude";
import {
  DELTA_V_MODE_SHORT,
  type DeltaVMode,
  type FuelStatusConfig,
} from "./config";
import { budgetFigure, maxStageDeltaV, NO_STAGES, pickTotal } from "./deltaV";
import { FuelStatusConfigForm } from "./FuelStatusConfigForm";
import { ResourceListSection } from "./ResourceListSection";
import { useResourceRows } from "./resources";
import { StageStackSection } from "./StageStackSection";
import { TotalsSection } from "./TotalsSection";
import "./slots";

/** The craft's ΔV in the configured reference, and how long it burns for. */
function useFuelEssentials({
  config,
}: ComponentProps<FuelStatusConfig>): readonly TinyEssential[] {
  const mode: DeltaVMode = config?.deltaVMode ?? "actual";
  const budgetReading = useProcessor(DELTA_V_BUDGET);
  const budget =
    budgetReading?.state === "observed" || budgetReading?.state === "stale"
      ? budgetReading.value
      : undefined;
  const dated = <UnitSymbol extends string>(
    figure: Value<UnitSymbol> | null | undefined,
  ) =>
    figure == null || budgetReading === undefined
      ? figure
      : budgetFigure(budgetReading, figure);
  return [
    {
      label: `ΔV ${DELTA_V_MODE_SHORT[mode]}`,
      value: dated(pickTotal(budget, mode)),
      decimals: 0,
    },
    { label: "Burn", value: dated(budget?.totalBurnTime) },
  ];
}

function FuelStatusComponent({
  config,
  w,
  h,
}: Readonly<ComponentProps<FuelStatusConfig>>) {
  const mode: DeltaVMode = config?.deltaVMode ?? "actual";
  // The staging structure is a fact: staging is an event, so the last reported stage is still the stage.
  const currentStage = stillTrue(
    useTelemetry("vessel.structure"),
    undefined,
  )?.currentStage;
  /*
   * Every total is the game's own figure off `dv.summary`, never a sum of the stage rows, which are built from a different stage list (see `DELTA_V_BUDGET`).
   * A dated budget is carried and marked held rather than blanked: it only falls by burning and rises by staging or docking, so the last figure is still the figure.
   */
  const budgetReading = useProcessor(DELTA_V_BUDGET);
  const budget =
    budgetReading?.state === "observed" || budgetReading?.state === "held"
      ? budgetReading.value
      : undefined;
  // Gated on the sim having answered: a craft with no engines answers `null` for every total, and the row draws its labelled pair of dashes.
  const budgetReported =
    budget !== undefined &&
    budget.budget.state !== "pending" &&
    // A build whose ΔV sim publishes nothing has not answered and never will, so the row stays away.
    budget.budget.state !== "unowned";
  const stageCount = budget?.stageCount ?? undefined;
  const dated = <UnitSymbol extends string>(figure: Value<UnitSymbol>) =>
    budgetReading === undefined ? figure : budgetFigure(budgetReading, figure);
  const totalDv = magnitudeOf(pickTotal(budget, mode)) ?? undefined;
  // `null` when the sim reported no figure, so it still goes through `Unit` rather than the bare-string branch.
  const totalBurnTime = budget?.totalBurnTime;

  const readings = useResourceRows();

  // Entries arrive high to low (stage 3 first), matching the top-down render order.
  const stages = budget?.stages ?? NO_STAGES;

  // Total ΔV is the headline; resource bars and the stage stack drop bottom-up as height shrinks.
  const cols = w ?? 8;
  const rows = h ?? 14;
  // Wide-short: width compensates for the height gates, so the resource list and stage stack show beneath the totals row.
  const isLandscape = getWidgetShape(w, h).shape === "landscape";
  const showSubtitle = rows >= 5;
  const showResourceList = cols >= 5 && (rows >= 7 || isLandscape);
  const showStageStack = cols >= 5 && (rows >= 10 || isLandscape);

  // Keyed by name so a column keeps its identity as the size gates add and drop them.
  const columns: { key: string; node: ReactNode }[] = [];
  if (showResourceList) {
    columns.push({
      key: "resources",
      node: <ResourceListSection rows={readings} />,
    });
  }
  if (showStageStack && budgetReading !== undefined && stages.length > 0) {
    columns.push({
      key: "stages",
      node: (
        <StageStackSection
          budgetReading={budgetReading}
          stages={stages}
          mode={mode}
          currentStage={currentStage}
          maxStageDv={maxStageDeltaV(stages, mode)}
        />
      ),
    });
  }

  return (
    <Panel
      panelTitle="FUEL · ΔV"
      compactTitle={["FUEL"]}
      sections={[
        /* The caption and the totals span the row: they describe the columns rather than sit beside them. */
        showSubtitle && currentStage !== undefined && (
          <Section key="stage" full>
            <ReadoutCaption>
              Stage {currentStage}
              {stageCount !== null &&
                stageCount !== undefined &&
                ` / ${stageCount.minus(1).max(0).magnitude}`}
            </ReadoutCaption>
          </Section>
        ),
        budgetReported && (
          <Section key="totals" full>
            <TotalsSection
              totalDv={
                totalDv === undefined ? undefined : dated(value("m/s", totalDv))
              }
              totalBurnTime={
                totalBurnTime === null || totalBurnTime === undefined
                  ? totalBurnTime
                  : dated(totalBurnTime)
              }
              mode={mode}
            />
          </Section>
        ),
        ...columns.map(({ key, node }) => <Section key={key}>{node}</Section>),
      ]}
    />
  );
}

registerComponent<FuelStatusConfig>({
  id: "fuel-status",
  name: "Fuel & ΔV",
  description:
    "Resource bars for LF/Ox/RCS/Xe/Power, total ΔV + burn time, and a per-stage stack with ΔV, burn time, and TWR. ΔV reference is configurable (vac / ASL / current atmosphere).",
  tags: ["telemetry", "fuel", "delta-v"],
  defaultSize: { w: 8, h: 14 },
  minSize: { w: 3, h: 3 },
  component: FuelStatusComponent,
  tiny: {
    title: "FUEL",
    // The totals row needs four rows; below it the two figures stand alone.
    bodyMinSize: { w: 3, h: 4 },
    useEssentials: useFuelEssentials,
  },
  configComponent: FuelStatusConfigForm,
  // The three resource channels rather than per-resource paths: the component reads each map whole, and every `r.resource[X]` alarm target lies inside one of them.
  dataRequirements: [
    "vessel.structure.currentStage",
    "dv.summary.stageCount",
    "dv.summary.totalDvVac",
    "dv.summary.totalDvAsl",
    "dv.summary.totalDvActual",
    "dv.summary.totalBurnTime",
    "dv.stages",
    "vessel.resources",
    "dv.currentStageResource",
    "dv.currentStageResourceMax",
  ],
  defaultConfig: { deltaVMode: "actual" },
  actions: [],
  augmentSlots: ["fuel-status.sections"],
  pushable: true,
  requires: ["flight"],
});

export { FuelStatusComponent };
