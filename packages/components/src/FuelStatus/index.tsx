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

// ── Config ────────────────────────────────────────────────────────────────────

type DeltaVMode = "vac" | "actual" | "asl";

/** Stable empty stack: `useProcessor` answers undefined before the first frame. */
const NO_STAGES: DeltaVStage[] = [];

interface FuelStatusConfig {
  /**
   * Which ΔV / TWR column to display from `dv.stages`. Defaults to "actual",
   * i.e. the value under current atmospheric conditions. "vac" is what you
   * want for reference values; "asl" for ascent planning.
   */
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

// ── Resource catalogue ────────────────────────────────────────────────────────

/**
 * Resources we know how to render, with a fixed colour and which scope to
 * read (`"current"` = current-stage only; `"vessel"` = vessel-wide totals).
 * Resources absent from the active vessel (max === 0) are skipped at render.
 */
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

// ── Hooks ─────────────────────────────────────────────────────────────────────

/**
 * One resource's amount and capacity, each still carrying the currency of the
 * reading it came in, so `Meter` can mark a held figure rather than the widget
 * deciding whether to draw it.
 *
 * Vessel totals are fields of `vessel.resources`; a stage's share is a field of
 * the derived `dv.currentStageResource` / `dv.currentStageResourceMax` pair. All
 * three reads happen unconditionally (Rules of Hooks) whichever scope this
 * resource uses.
 */
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

/**
 * Whether the craft carries this resource at all: a capacity that has been
 * reported, current or held, and is above zero. A tank's size is a fact of the
 * craft, so a held one still says the tank is there.
 */
function carries(capacity: Reading<Value<"units">>): boolean {
  if (capacity.state !== "observed" && capacity.state !== "stale") return false;
  return capacity.value?.isPositive() ?? false;
}

/**
 * One stage's ΔV as a reading of its own, dated as the budget it is a row of.
 *
 * The figure is part of the budget's observation, so it takes that
 * observation's arm, instant and grade. The model is dropped rather than
 * carried: the budget's reckoning speaks about the budget, not about one row.
 */
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

/**
 * A provider occasionally hands us a stage row where TWR / ΔV is missing
 * (engine-less stage, decoupler-only, post-staging frame where the engine
 * has been ejected). The fix at 21:08 BST on 2026-05-17 was the absence
 * of this guard: `twr.toFixed` crashed the whole widget when twr was
 * undefined for one row.
 */
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
    <MeterStack style={{ marginTop: "var(--space-6)" }}>
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
        marginTop: "var(--space-10)",
        paddingTop: "var(--space-6)",
        borderTop: "1px solid var(--color-border-subtle)",
      }}
    >
      <ReadoutCaption
        style={{
          color: "var(--color-text-faint)",
          letterSpacing: "0.1em",
          marginBottom: "var(--space-4)",
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

// ── Component ─────────────────────────────────────────────────────────────────

function FuelStatusComponent({
  config,
  w,
  h,
}: Readonly<ComponentProps<FuelStatusConfig>>) {
  const mode: DeltaVMode = config?.deltaVMode ?? "actual";
  // The staging structure is a fact: staging is an event, so the last reported
  // stage is still the stage.
  const currentStage = stillTrue(
    useTelemetry("vessel.structure"),
    undefined,
  )?.currentStage;
  /**
   * The one ΔV derivation, shared. Every total below is the game's own figure off
   * `dv.summary`, never a client-side sum of the stage rows: the two are built
   * from different stage lists and disagree in flight (see `DELTA_V_BUDGET`).
   *
   * A dated budget is CARRIED and captioned rather than blanked. It only falls by
   * burning and only rises by staging or docking, all events the operator caused,
   * so the last figure is still the figure.
   */
  /*
   * Both value-bearing arms. A budget that has stopped being current is still
   * the best figure available, and every readout drawn from it below is a
   * FIGURE rather than a control: dropping it would blank the panel for a craft
   * whose link merely went quiet.
   */
  const budgetReading = useProcessor(DELTA_V_BUDGET);
  const budget =
    budgetReading?.state === "observed" || budgetReading?.state === "stale"
      ? budgetReading.value
      : undefined;
  const budgetNotCurrent = budget?.budget.state === "stale";
  /**
   * The stock ΔV sim has answered about this craft, whatever it answered.
   *
   * Gates the totals row on the sim having ANSWERED, not on any total being
   * present. A craft with no engines is a real answer of `null` for every
   * total, and the row should render its labelled pair of em-dashes for it.
   * Gating on the values instead would hang the row on a wire detail and blank
   * it the day a total starts arriving absent rather than null.
   */
  const budgetReported =
    budget !== undefined &&
    budget.budget.state !== "pending" &&
    // A build whose ΔV sim publishes nothing has not answered and never will,
    // so the row stays away rather than showing a pair of em-dashes that read
    // as "this craft has no ΔV" instead of "nothing here measures it".
    budget.budget.state !== "unowned";
  const stageCount = budget?.stageCount ?? undefined;
  // Magnitudes: these feed `fmtFixed` and the per-stage bar scaling.
  const totalDVVac = magnitudeOf(budget?.totalVac) ?? undefined;
  const totalDVASL = magnitudeOf(budget?.totalAsl) ?? undefined;
  const totalDVActual = magnitudeOf(budget?.totalActual) ?? undefined;
  // `null` when the sim reported no figure, which `Unit` renders as the em-dash:
  // NOT collapsed to `undefined`, which would take the bare-string branch below
  // and bypass the one unit renderer.
  const totalBurnTime = budget?.totalBurnTime;

  // Hooks unrolled explicitly: Rules of Hooks forbids hook calls inside any
  // loop or `.map` callback (even ones that happen to iterate a constant
  // tuple). The RESOURCES catalogue has a fixed order so these reads are 1:1.
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

  // Entries arrive high → low (stage 3 first, stage 0 last), matching the
  // stack-top-down render order, with either wire's field names already
  // reconciled by the processor.
  const stages = budget?.stages ?? NO_STAGES;
  /* The scale every stage bar is drawn against: the largest finite stage ΔV.
     Filtered before Math.max, because one NaN entry would make the whole scale
     NaN. A floor above zero keeps a stack of spent stages a stack of empty bars
     rather than a stack with no axis. */
  const finiteDvs = stages
    .map((s) => pickDeltaV(s, mode))
    .filter((v): v is number => Number.isFinite(v));
  const maxStageDv = value("m/s", Math.max(...finiteDvs, 0.001));

  const totalDv =
    mode === "vac" ? totalDVVac : mode === "asl" ? totalDVASL : totalDVActual;

  // Selective rendering: total ΔV is the headline. Resource bars and the
  // per-stage stack drop bottom-up as height shrinks.
  const cols = w ?? 8;
  const rows = h ?? 14;
  /* Wide-short: width compensates for the height gates, so show the resource
     list and the stage stack beneath the totals row instead of leaving the box
     sparse. Panel flows them into columns from there.

     This used to carry a `rows >= 6` guard as well, because below about six
     rows even ONE section overflowed the tile and painted over what followed
     it. The section grid takes its children at their natural height inside the
     body's own scroller, so the same content now scrolls with a glow instead,
     and an 18x5 tile showing a caption and a totals box over 600px of empty
     width was the worse of the two. */
  const isLandscape = getWidgetShape(w, h).shape === "landscape";
  const showSubtitle = rows >= 5;
  const showTotals = rows >= 4;
  const showResourceList = cols >= 5 && (rows >= 7 || isLandscape);
  const showStageStack = cols >= 5 && (rows >= 10 || isLandscape);
  const showHeroDv = !showTotals && totalDv !== undefined;

  /* The breakdown columns, keyed by name rather than index, which is both what
     the biome noArrayIndexKey rule wants and what keeps a column's identity
     stable as the size gates add and drop them.

     The engine-realism augment segment is NOT pushed here any more. Panel mounts
     `${componentId}.sections` inside its own section grid, so an Uplink's
     supplemental rows (ignitions remaining, propellant boil-off) already land
     as a column beside these rather than in a block underneath them, which is
     exactly what the hand-placed mount was for. */
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
        /* The readouts above the breakdown span the row: the caption names the
           stage the columns describe, and the totals are the headline they add
           up to. Neither belongs beside a column as a peer of it. */
        showSubtitle && currentStage !== undefined && (
          <Section key="stage" full>
            {/* Stage caption relocated out of the panel subtitle into the body
                (staging change), carried by ui-kit's ReadoutCaption. */}
            <ReadoutCaption>
              Stage {currentStage}
              {stageCount !== null &&
                stageCount !== undefined &&
                ` / ${stageCount.minus(1).max(0).magnitude}`}
              {/* A budget only falls by burning and rises by staging or
                  docking, so a dated one is still the budget and gets said out
                  loud rather than blanked. This caption existed as a variable
                  and was never rendered, because the number it would have
                  qualified was withheld instead. */}
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
        /* No engine data + no totals row to fall back on: render an em-dash so
           the tiny widget does not appear blank. Without this branch the panel
           shows only the title and a black void below (the no-engine-data
           fixture at tiny-3x3 hit this state). */
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

// ── Config component ──────────────────────────────────────────────────────────

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

// ── Augment slots ─────────────────────────────────────────────────────────────

// Declaration-merge this widget's slot ids → their props types into core's
// `SlotRegistry`. Both slots are plain
// section/badge slots (not overlays), so they pass no coordinate/projection
// context: an empty props object. Kept co-located here, not in a shared
// central registry file, so parallel per-widget slot work never collides.
declare module "@ksp-gonogo/core" {
  interface SlotRegistry {
    "fuel-status.sections": Record<string, never>;
  }
}

// ── Registration ──────────────────────────────────────────────────────────────

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
  // The three resource CHANNELS rather than twenty per-resource paths: the
  // component reads each map whole and indexes it by resource name (see
  // `useResourceReading`), so naming the cells would claim a precision it does
  // not have. Alarms on a single resource still land here, because every
  // `r.resource[X]`-family target is a path INSIDE one of these three.
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
