import type { ComponentProps, ConfigComponentProps } from "@ksp-gonogo/core";
import {
  clampSafe,
  getWidgetShape,
  registerComponent,
  useTelemetry,
} from "@ksp-gonogo/core";
import {
  DELTA_V_BUDGET,
  type DeltaVStage,
  type Reading,
  type ResourceAmountMap,
  useProcessor,
  useStream,
} from "@ksp-gonogo/sitrep-client";
import { value } from "@ksp-gonogo/sitrep-sdk";
import {
  BigReadout,
  Box,
  ConfigForm,
  Field,
  FieldHint,
  FieldLabel,
  Grid,
  NULL_DISPLAY,
  Panel,
  ReadoutCaption,
  Section,
  Select,
  Stack,
  Text,
  Truncate,
  Unit,
  useModalSaveBar,
  writeQuantity,
} from "@ksp-gonogo/ui-kit";
import type { ReactNode } from "react";
import { useMemo, useState } from "react";
import { magnitudeOf, magnitudeOr } from "../shared/magnitude";

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
 * The value a VERDICT may be drawn from: current, or modelled forward to the frame.
 * A stale reading gives nothing, because a judgement cannot be dated: the operator
 * reads a band or a pill as the situation NOW.
 */
function judgeable<T>(reading: Reading<T>): T | undefined {
  if (reading.reckoning === "available") return reading.reckoned.value;
  if (reading.state === "observed") return reading.value;
  return undefined;
}

/**
 * The value of a FACT: something that stays true until an event changes it, and no
 * event can reach us down a link that is not delivering. `whenConfirmedNothing` is
 * what an `absent` tombstone means here, which is a different answer from `pending`
 * and must not collapse into it.
 */
function stillTrue<T, A>(
  reading: Reading<T>,
  whenConfirmedNothing: A,
): T | A | undefined {
  if (reading.state === "observed") return reading.value;
  if (reading.state === "stale") return reading.value;
  if (reading.state === "absent") return whenConfirmedNothing;
  return undefined;
}

function useResourceReading(def: ResourceDef): { value: number; max: number } {
  // Vessel-total amounts come off `vessel.resources` (the wire topic, a
  // resource-name-keyed `{ current, max }` map). Stage-scoped amounts come off
  // the derived `dv.currentStageResource`/`dv.currentStageResourceMax` channels
  // (`dv-stage-resources.ts`): the active stage's slice of `dv.stages`, keyed
  // by resource name. All three reads happen unconditionally (Rules of Hooks)
  // regardless of which scope this resource ultimately uses.
  /**
   * Propellant only falls while an engine burns, and every readout here is a gauge
   * the operator reads as "what is left". A held figure overstates the remaining
   * fuel, which is the direction that strands a craft.
   */
  const resourcesReading = useTelemetry("vessel.resources");
  const vesselResources = judgeable(resourcesReading)?.resources;
  const stageCurrent = useStream<ResourceAmountMap>("dv.currentStageResource");
  const stageMaxMap = useStream<ResourceAmountMap>(
    "dv.currentStageResourceMax",
  );

  const vessel = magnitudeOr(vesselResources?.[def.name]?.current, 0);
  const vesselMax = magnitudeOr(vesselResources?.[def.name]?.max, 0);
  const stage = magnitudeOr(stageCurrent?.[def.name], 0);
  const stageMax = magnitudeOr(stageMaxMap?.[def.name], 0);

  return def.scope === "vessel"
    ? { value: vessel, max: vesselMax }
    : { value: stage, max: stageMax };
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

// ── Helpers ───────────────────────────────────────────────────────────────────

const clampPct = (pct: number): number => clampSafe(pct, 0, 100);

/** Units of stock KSP resources aren't kg: this is the raw unit count. */
function formatAmount(value: number): string {
  if (value >= 10_000) return value.toFixed(0);
  if (value >= 100) return value.toFixed(1);
  return value.toFixed(2);
}

/** Thin resource bar: a hand-scaled fill in a fixed track, not `ProgressBar`
 * (which is a fixed-colour pill) - each row needs its own resource colour and
 * a square, bordered track. */
function ResourceBar({ pct, color }: { pct: number; color: string }) {
  return (
    <div
      style={{
        height: 8,
        minWidth: 28,
        background: "var(--color-surface-panel)",
        border: "1px solid var(--color-border-subtle)",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          height: "100%",
          transition: "width var(--duration-fast) var(--ease-linear)",
          width: `${pct}%`,
          background: color,
        }}
      />
    </div>
  );
}

/** The resource bar list: LF/Ox/RCS/Xe/Power rows with a non-zero max. */
function ResourceListSection({
  readings,
}: {
  readings: { def: ResourceDef; value: number; max: number }[];
}) {
  return (
    <Stack gap="sm" style={{ marginTop: "var(--space-6)" }}>
      {readings
        .filter(({ max }) => max > 0)
        .map(({ def, value: amount, max }) => (
          <Grid
            key={def.name}
            cols="minmax(0, 13em) minmax(28px, 1fr) auto"
            gap="md"
            align="center"
            style={{ fontSize: "var(--font-size-xs)" }}
          >
            <Truncate
              style={{
                color: "var(--color-text-primary)",
                letterSpacing: "0.02em",
              }}
            >
              {def.label}
              {def.scope === "current" && (
                <span
                  style={{
                    color: "var(--color-text-faint)",
                    fontSize: "var(--font-size-xs)",
                    letterSpacing: "0.05em",
                    textTransform: "uppercase",
                  }}
                >
                  {" "}
                  · stage
                </span>
              )}
              {def.scope === "vessel" && (
                <span
                  style={{
                    color: "var(--color-text-faint)",
                    fontSize: "var(--font-size-xs)",
                    letterSpacing: "0.05em",
                    textTransform: "uppercase",
                  }}
                >
                  {" "}
                  · vessel
                </span>
              )}
            </Truncate>
            <ResourceBar
              pct={clampPct((amount / max) * 100)}
              color={def.color}
            />
            <span
              style={{
                color: "var(--color-text-muted)",
                fontSize: "var(--font-size-xs)",
                whiteSpace: "nowrap",
              }}
            >
              {formatAmount(amount)} / {formatAmount(max)}
            </span>
          </Grid>
        ))}
    </Stack>
  );
}

/** Per-stage ΔV/burn/TWR stack, current stage highlighted. */
function StageStackSection({
  stages,
  mode,
  currentStage,
  maxStageDv,
  compactStageMeta,
}: {
  stages: DeltaVStage[];
  mode: DeltaVMode;
  currentStage: number | undefined;
  maxStageDv: number;
  compactStageMeta: boolean;
}) {
  return (
    <Stack
      gap="xs"
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
      {stages.map((s) => {
        const dv = pickDeltaV(s, mode);
        const twr = pickTWR(s, mode);
        const active = s.stage === currentStage;
        // parseStages yields NaN burnTime for a stage with no burn data;
        // show "0s" for that (and for a non-positive value) rather than
        // the helper's NULL_DISPLAY, matching the pre-refactor local formatter.
        const burn =
          Number.isFinite(s.burnTime) && s.burnTime > 0 ? (
            <Unit value={value("s", s.burnTime)} />
          ) : (
            "0s"
          );
        return (
          <Grid
            key={s.stage}
            cols="3.5em minmax(28px, 1fr) auto"
            gap="md"
            align="center"
            style={{
              fontSize: "var(--font-size-xs)",
              color: active
                ? "var(--color-status-nogo-fg)"
                : "var(--color-text-muted)",
            }}
          >
            <span
              style={{
                fontSize: "var(--font-size-xs)",
                letterSpacing: "0.02em",
              }}
            >
              {active ? "▶ " : "  "}S{s.stage}
            </span>
            <ResourceBar
              pct={clampPct(
                ((Number.isFinite(dv) ? dv : 0) / maxStageDv) * 100,
              )}
              color={
                active
                  ? "var(--color-status-warning-bg)"
                  : "var(--color-text-faint)"
              }
            />
            <div
              style={{
                fontSize: "var(--font-size-xs)",
                whiteSpace: "nowrap",
                display: "flex",
                flexDirection: "column",
                alignItems: "flex-end",
                lineHeight: "var(--line-height-tight)",
              }}
            >
              <span>
                <Unit value={value("m/s", dv)} decimals={0} />
              </span>
              {compactStageMeta ? (
                <>
                  <span
                    style={{
                      color: "var(--color-text-faint)",
                      fontSize: "var(--font-size-xs)",
                    }}
                  >
                    {burn}
                  </span>
                  <span
                    style={{
                      color: "var(--color-text-faint)",
                      fontSize: "var(--font-size-xs)",
                    }}
                  >
                    TWR {fmtFixed(twr, 2)}
                  </span>
                </>
              ) : (
                <span
                  style={{
                    color: "var(--color-text-faint)",
                    fontSize: "var(--font-size-xs)",
                  }}
                >
                  {burn} · TWR {fmtFixed(twr, 2)}
                </span>
              )}
            </div>
          </Grid>
        );
      })}
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
  const budget = useProcessor(DELTA_V_BUDGET);
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
  const readings = [
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
  // Filter to finite values before Math.max: a single NaN/undefined entry
  // would propagate NaN through every BarFill width and render a row of
  // invisible bars.
  const finiteDvs = stages
    .map((s) => pickDeltaV(s, mode))
    .filter((v): v is number => Number.isFinite(v));
  const maxStageDv =
    finiteDvs.length > 0 ? Math.max(...finiteDvs, 0.001) : 0.001;

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
  // At the narrowest width the stage stack ever renders at (cols === 5,
  // portrait-5x18), "<burn> · TWR <n>" doesn't fit next to the ΔV bar even
  // with the bar's 28px floor honoured: the row overflows past the panel
  // edge and gets clipped. Splitting burn time and TWR onto their own lines
  // shortens the longest line enough to fit; there's always vertical room
  // to spare here since the stage stack only shows once rows >= 10.
  const compactStageMeta = cols < 7;

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
      node: <ResourceListSection readings={readings} />,
    });
  }
  if (showStageStack && stages.length > 0) {
    columns.push({
      key: "stages",
      node: (
        <StageStackSection
          stages={stages}
          mode={mode}
          currentStage={currentStage}
          maxStageDv={maxStageDv}
          compactStageMeta={compactStageMeta}
        />
      ),
    });
  }

  return (
    <Panel
      panelTitle="FUEL · ΔV"
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
              radius="xs"
              style={{
                display: "flex",
                gap: "var(--space-16)",
                padding: "var(--space-6) var(--space-8)",
              }}
            >
              <Stack gap="xs">
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
                    gap: "var(--space-6)",
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
                      fontSize: "var(--font-size-xs)",
                      letterSpacing: "0.08em",
                    }}
                  >
                    {DELTA_V_MODE_SHORT[mode]}
                  </span>
                </Text>
              </Stack>
              <Stack gap="xs">
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
                    gap: "var(--space-6)",
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
