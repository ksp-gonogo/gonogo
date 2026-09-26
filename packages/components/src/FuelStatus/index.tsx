import type { ComponentProps, ConfigComponentProps } from "@ksp-gonogo/core";
import {
  getWidgetShape,
  registerComponent,
  useTelemetry,
} from "@ksp-gonogo/core";
import {
  DELTA_V_BUDGET,
  type DeltaVBudget,
  type DeltaVStage,
  type ResourceAmountMap,
  useProcessor,
  useStream,
} from "@ksp-gonogo/sitrep-client";
import {
  type Reading,
  stillTrue,
  type Value,
  value,
} from "@ksp-gonogo/sitrep-sdk";
import {
  BigReadout,
  Box,
  ConfigForm,
  Field,
  FieldHint,
  FieldLabel,
  Meter,
  MeterRowGroup,
  MeterStack,
  NULL_DISPLAY,
  Panel,
  ReadoutCaption,
  Section,
  Select,
  Stack,
  speakQuantity,
  Text,
  Unit,
  useModalSaveBar,
  writeQuantity,
} from "@ksp-gonogo/ui-kit";
import type { ReactNode } from "react";
import { useMemo, useState } from "react";
import { magnitudeOf } from "../shared/magnitude";

type DeltaVMode = "vac" | "actual" | "asl";

/** Stable empty stack: `useProcessor` answers undefined before the first frame. */
const NO_STAGES: DeltaVStage[] = [];

interface FuelStatusConfig {
  /** Which ΔV / TWR column to show: "actual" (current atmosphere, the default), "vac" for reference, "asl" for ascent planning. */
  deltaVMode?: DeltaVMode;
}

const DELTA_V_MODE_LABELS: Record<DeltaVMode, string> = {
  actual: "Current atmosphere",
  vac: "Vacuum",
  asl: "Sea level",
};

const DELTA_V_MODE_SHORT: Record<DeltaVMode, string> = {
  actual: "ACT",
  vac: "VAC",
  asl: "ASL",
};

/** A resource we render, with a fixed colour and a scope: `"current"` is the current stage, `"vessel"` the vessel-wide total. */
interface ResourceDef {
  name:
    | "LiquidFuel"
    | "Oxidizer"
    | "MonoPropellant"
    | "XenonGas"
    | "ElectricCharge";
  label: string;
  color: string;
  scope: "current" | "vessel";
}

const RESOURCES: readonly ResourceDef[] = [
  {
    name: "LiquidFuel",
    label: "Liquid Fuel",
    color: "var(--color-accent-fg)",
    scope: "current",
  },
  {
    name: "Oxidizer",
    label: "Oxidizer",
    color: "var(--color-status-info-fg)",
    scope: "current",
  },
  {
    name: "MonoPropellant",
    label: "RCS",
    color: "var(--color-status-warning-bg)",
    scope: "vessel",
  },
  {
    name: "XenonGas",
    label: "Xenon",
    color: "var(--color-tag-purple-fg)",
    scope: "vessel",
  },
  {
    name: "ElectricCharge",
    label: "Power",
    color: "var(--color-status-warning-bg)",
    scope: "vessel",
  },
] as const;

/** One resource's amount and capacity as readings, so `Meter` marks a held figure. All three reads run unconditionally, whichever scope the resource uses. */
function useResourceReading(def: ResourceDef): {
  amount: Reading<Value<"units">>;
  capacity: Reading<Value<"units">>;
} {
  const vessel = useTelemetry("vessel.resources").resources[def.name];
  const stageAmount = useStream<ResourceAmountMap>("dv.currentStageResource")[
    def.name
  ];
  const stageCapacity = useStream<ResourceAmountMap>(
    "dv.currentStageResourceMax",
  )[def.name];
  return def.scope === "vessel"
    ? { amount: vessel.current, capacity: vessel.max }
    : { amount: stageAmount, capacity: stageCapacity };
}

/** Whether the craft carries this resource: a reported capacity, current or held, above zero. A held tank size still says the tank is there. */
function carries(capacity: Reading<Value<"units">>): boolean {
  if (capacity.state !== "observed" && capacity.state !== "stale") return false;
  return capacity.value?.isPositive() ?? false;
}

/** One stage's ΔV as a reading dated as the budget it is a row of; the budget's model is dropped because it speaks about the whole budget. */
function stageReading(
  budget: Reading<DeltaVBudget>,
  figure: Value<"m/s">,
): Reading<Value<"m/s">> {
  return {
    state: budget.state,
    value: figure,
    atUt: budget.atUt,
    asOfUt: budget.asOfUt,
    grade: budget.grade,
    reckoning: { status: "none" },
  };
}

function pickDeltaV(s: DeltaVStage, mode: DeltaVMode): number {
  switch (mode) {
    case "vac":
      return s.deltaVVac;
    case "asl":
      return s.deltaVASL;
    default:
      return s.deltaVActual;
  }
}

function pickTWR(s: DeltaVStage, mode: DeltaVMode): number {
  switch (mode) {
    case "vac":
      return s.TWRVac;
    case "asl":
      return s.TWRASL;
    default:
      return s.TWRActual;
  }
}

/** A stage row can lack TWR or ΔV (engine-less stage, decoupler-only, a just-ejected engine). */
function fmtFixed(value: unknown, digits: number): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return NULL_DISPLAY;
  return value.toFixed(digits);
}

/** A resource row: which resource, and its amount and capacity as readings. */
interface ResourceRow {
  def: ResourceDef;
  amount: Reading<Value<"units">>;
  capacity: Reading<Value<"units">>;
}

/** One meter per resource the craft carries: LF/Ox/RCS/Xe/Power. */
function ResourceListSection({ rows }: { rows: ResourceRow[] }) {
  return (
    <MeterStack style={{ marginTop: "var(--gap-related-compact)" }}>
      {rows
        .filter(({ capacity }) => carries(capacity))
        .map(({ def, amount, capacity }) => (
          <Meter
            key={def.name}
            label={`${def.label} · ${def.scope === "current" ? "stage" : "vessel"}`}
            value={amount}
            capacity={capacity}
            fillColor={def.color}
            layout="row"
          />
        ))}
    </MeterStack>
  );
}

/**
 * Per-stage ΔV, burn and TWR, current stage highlighted. Each bar is the stage's
 * ΔV against the largest stage's, and carries the budget reading's currency, so
 * a held budget draws held bars.
 */
function StageStackSection({
  budgetReading,
  stages,
  mode,
  currentStage,
  maxStageDv,
}: {
  budgetReading: Reading<DeltaVBudget>;
  stages: DeltaVStage[];
  mode: DeltaVMode;
  currentStage: number | undefined;
  maxStageDv: Value<"m/s">;
}) {
  return (
    <Stack
      style={{
        marginTop: "var(--gap-stage-section)",
        paddingTop: "var(--inset-below-rule)",
        borderTop: "1px solid var(--color-border-subtle)",
      }}
    >
      <ReadoutCaption
        style={{
          color: "var(--color-text-faint)",
          letterSpacing: "0.1em",
          marginBottom: "var(--gap-under-title)",
        }}
      >
        Stages · ΔV ({DELTA_V_MODE_SHORT[mode]}) · burn · TWR
      </ReadoutCaption>
      <MeterStack>
        {stages.map((s) => {
          const figure = pickDeltaV(s, mode);
          // NaN is a stage the wire carried no ΔV for, which the meter draws as absent rather than empty.
          const dv = Number.isFinite(figure)
            ? stageReading(budgetReading, value("m/s", figure))
            : null;
          const twr = pickTWR(s, mode);
          const active = s.stage === currentStage;
          // NaN is a burn time the wire did not carry, not a stage that burns for no time.
          const burn = !Number.isFinite(s.burnTime) ? (
            NULL_DISPLAY
          ) : s.burnTime > 0 ? (
            <Unit value={value("s", s.burnTime)} />
          ) : (
            "0s"
          );
          return (
            <MeterRowGroup key={s.stage}>
              <Meter
                label={`${active ? "▶ " : ""}S${s.stage}`}
                value={dv}
                capacity={maxStageDv}
                layout="row"
                fillColor={
                  active
                    ? "var(--color-status-warning-bg)"
                    : "var(--color-text-faint)"
                }
                valueLabel={
                  dv === null ? undefined : speakQuantity(value("m/s", figure))
                }
                valueLabelNode={
                  dv === null ? undefined : <Unit value={dv} decimals={0} />
                }
              />
              <Text
                size="xs"
                style={{
                  justifySelf: "end",
                  whiteSpace: "nowrap",
                  color: active
                    ? "var(--color-status-nogo-fg)"
                    : "var(--color-text-faint)",
                }}
              >
                {burn} · TWR {fmtFixed(twr, 2)}
              </Text>
            </MeterRowGroup>
          );
        })}
      </MeterStack>
    </Stack>
  );
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
   * A dated budget is carried and captioned rather than blanked: it only falls by burning and rises by staging or docking, so the last figure is still the figure.
   */
  const budgetReading = useProcessor(DELTA_V_BUDGET);
  const budget =
    budgetReading?.state === "observed" || budgetReading?.state === "stale"
      ? budgetReading.value
      : undefined;
  const budgetNotCurrent = budget?.budget.state === "stale";
  // Gated on the sim having answered: a craft with no engines answers `null` for every total, and the row draws its labelled pair of dashes.
  const budgetReported =
    budget !== undefined &&
    budget.budget.state !== "pending" &&
    // A build whose ΔV sim publishes nothing has not answered and never will, so the row stays away.
    budget.budget.state !== "unowned";
  const stageCount = budget?.stageCount ?? undefined;
  // Magnitudes: these feed `fmtFixed` and the per-stage bar scaling.
  const totalDVVac = magnitudeOf(budget?.totalVac) ?? undefined;
  const totalDVASL = magnitudeOf(budget?.totalAsl) ?? undefined;
  const totalDVActual = magnitudeOf(budget?.totalActual) ?? undefined;
  // `null` when the sim reported no figure, so it still goes through `Unit` rather than the bare-string branch.
  const totalBurnTime = budget?.totalBurnTime;

  // Rules of Hooks forbids calls in a `.map`; the RESOURCES catalogue has a fixed order so these reads are 1:1.
  const lf = useResourceReading(RESOURCES[0]);
  const ox = useResourceReading(RESOURCES[1]);
  const rcs = useResourceReading(RESOURCES[2]);
  const xe = useResourceReading(RESOURCES[3]);
  const ec = useResourceReading(RESOURCES[4]);
  const readings: ResourceRow[] = [
    { def: RESOURCES[0], ...lf },
    { def: RESOURCES[1], ...ox },
    { def: RESOURCES[2], ...rcs },
    { def: RESOURCES[3], ...xe },
    { def: RESOURCES[4], ...ec },
  ];

  // Entries arrive high to low (stage 3 first), matching the top-down render order.
  const stages = budget?.stages ?? NO_STAGES;
  // The largest finite stage ΔV, floored above zero so a stack of spent stages still has an axis.
  const finiteDvs = stages
    .map((s) => pickDeltaV(s, mode))
    .filter((v): v is number => Number.isFinite(v));
  const maxStageDv = value("m/s", Math.max(...finiteDvs, 0.001));

  const totalDv =
    mode === "vac" ? totalDVVac : mode === "asl" ? totalDVASL : totalDVActual;

  // Total ΔV is the headline; resource bars and the stage stack drop bottom-up as height shrinks.
  const cols = w ?? 8;
  const rows = h ?? 14;
  // Wide-short: width compensates for the height gates, so the resource list and stage stack show beneath the totals row.
  const isLandscape = getWidgetShape(w, h).shape === "landscape";
  const showSubtitle = rows >= 5;
  const showTotals = rows >= 4;
  const showResourceList = cols >= 5 && (rows >= 7 || isLandscape);
  const showStageStack = cols >= 5 && (rows >= 10 || isLandscape);
  const showHeroDv = !showTotals && totalDv !== undefined;

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
          maxStageDv={maxStageDv}
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
              {/* A dated budget is still the budget, so it is said out loud rather than blanked. */}
              {budgetNotCurrent && " · ΔV at last contact"}
            </ReadoutCaption>
          </Section>
        ),
        showHeroDv && (
          <Section key="hero" full>
            <BigReadout
              $tone="alert"
              style={{ fontSize: "clamp(13px, 3.5vw, 17px)" }}
            >
              <span style={{ whiteSpace: "nowrap" }}>
                <Unit value={value("m/s", totalDv)} decimals={0} />
              </span>
              <ReadoutCaption>
                ΔV {DELTA_V_MODE_SHORT[mode]}
                {budgetNotCurrent && " · at last contact"}
              </ReadoutCaption>
            </BigReadout>
          </Section>
        ),
        /* No engine data and no totals row: draw a dash so the tiny widget is not blank. */
        !showHeroDv && !showTotals && totalDv === undefined && (
          <Section key="null" full>
            <BigReadout>{NULL_DISPLAY}</BigReadout>
          </Section>
        ),
        showTotals && budgetReported && (
          <Section key="totals" full>
            <Box
              surface="panel"
              bordered
              radius="regular"
              style={{
                display: "flex",
                gap: "var(--gap-section)",
                padding: "var(--inset-surface)",
              }}
            >
              <Stack>
                <ReadoutCaption
                  style={{
                    color: "var(--color-text-faint)",
                    letterSpacing: "0.1em",
                  }}
                >
                  Total ΔV
                </ReadoutCaption>
                <Text
                  tone="default"
                  size="sm"
                  style={{
                    display: "inline-flex",
                    alignItems: "baseline",
                    gap: "var(--gap-related)",
                    flexWrap: "wrap",
                    fontWeight: 700,
                    color: "var(--color-status-nogo-fg)",
                  }}
                >
                  <span style={{ whiteSpace: "nowrap" }}>
                    {totalDv !== undefined
                      ? writeQuantity(value("m/s", totalDv), { decimals: 0 })
                      : NULL_DISPLAY}
                  </span>
                  <span
                    style={{
                      color: "var(--color-text-dim)",
                      fontSize: "var(--font-size-caption)",
                      letterSpacing: "0.08em",
                    }}
                  >
                    {DELTA_V_MODE_SHORT[mode]}
                  </span>
                </Text>
              </Stack>
              <Stack>
                <ReadoutCaption
                  style={{
                    color: "var(--color-text-faint)",
                    letterSpacing: "0.1em",
                  }}
                >
                  Total burn
                </ReadoutCaption>
                <Text
                  tone="default"
                  size="sm"
                  style={{
                    display: "inline-flex",
                    alignItems: "baseline",
                    gap: "var(--gap-related)",
                    flexWrap: "wrap",
                    fontWeight: 700,
                    color: "var(--color-status-nogo-fg)",
                  }}
                >
                  <span style={{ whiteSpace: "nowrap" }}>
                    {totalBurnTime !== undefined ? (
                      <Unit value={totalBurnTime} />
                    ) : (
                      NULL_DISPLAY
                    )}
                  </span>
                </Text>
              </Stack>
            </Box>
          </Section>
        ),
        ...columns.map(({ key, node }) => <Section key={key}>{node}</Section>),
      ]}
    />
  );
}

function FuelStatusConfigComponent({
  config,
  onSave,
}: Readonly<ConfigComponentProps<FuelStatusConfig>>) {
  const [mode, setMode] = useState<DeltaVMode>(config?.deltaVMode ?? "actual");

  const candidate = useMemo<FuelStatusConfig>(
    () => ({ deltaVMode: mode }),
    [mode],
  );

  useModalSaveBar({
    onSave: () => onSave(candidate),
    value: candidate,
    saved: config ?? {},
  });

  return (
    <ConfigForm>
      <Field>
        <FieldLabel htmlFor="fuel-dv-mode">ΔV reference</FieldLabel>
        <Select
          id="fuel-dv-mode"
          value={mode}
          onChange={(e) => setMode(e.target.value as DeltaVMode)}
        >
          <option value="actual">{DELTA_V_MODE_LABELS.actual}</option>
          <option value="vac">{DELTA_V_MODE_LABELS.vac}</option>
          <option value="asl">{DELTA_V_MODE_LABELS.asl}</option>
        </Select>
        <FieldHint>
          "Current atmosphere" matches live conditions: what you'll actually
          burn. Switch to vacuum for planning headroom.
        </FieldHint>
      </Field>
    </ConfigForm>
  );
}

// Both slots are plain section/badge slots, so they take an empty props object.
declare module "@ksp-gonogo/core" {
  interface SlotRegistry {
    "fuel-status.sections": Record<string, never>;
  }
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
  configComponent: FuelStatusConfigComponent,
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
