import type {
  ComponentProps,
  ConfigComponentProps,
  StageInfo,
} from "@gonogo/core";
import { registerComponent, useDataValue } from "@gonogo/core";
import {
  BigReadout,
  ConfigForm,
  Field,
  FieldHint,
  FieldLabel,
  Panel,
  PanelSubtitle,
  PanelTitle,
  PrimaryButton,
  ReadoutCaption,
  Select,
} from "@gonogo/ui";
import { useState } from "react";
import styled from "styled-components";

// ── Config ────────────────────────────────────────────────────────────────────

type DeltaVMode = "vac" | "actual" | "asl";

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

function useResourceReading(def: ResourceDef): { value: number; max: number } {
  const vesselKey = `r.resource[${def.name}]` as const;
  const vesselMaxKey = `r.resourceMax[${def.name}]` as const;
  const stageKey = `r.resourceCurrent[${def.name}]` as const;
  const stageMaxKey = `r.resourceCurrentMax[${def.name}]` as const;

  // Always subscribe to all four — calling useDataValue conditionally would
  // violate the Rules of Hooks. Cheap on Telemachus.
  const vessel = useDataValue("data", vesselKey) ?? 0;
  const vesselMax = useDataValue("data", vesselMaxKey) ?? 0;
  const stage = useDataValue("data", stageKey) ?? 0;
  const stageMax = useDataValue("data", stageMaxKey) ?? 0;

  return def.scope === "vessel"
    ? { value: vessel, max: vesselMax }
    : { value: stage, max: stageMax };
}

function pickDeltaV(s: StageInfo, mode: DeltaVMode): number {
  switch (mode) {
    case "vac":
      return s.deltaVVac;
    case "asl":
      return s.deltaVASL;
    default:
      return s.deltaVActual;
  }
}

function pickTWR(s: StageInfo, mode: DeltaVMode): number {
  switch (mode) {
    case "vac":
      return s.TWRVac;
    case "asl":
      return s.TWRASL;
    default:
      return s.TWRActual;
  }
}

// ── Component ─────────────────────────────────────────────────────────────────

function FuelStatusComponent({
  config,
  w,
  h,
}: Readonly<ComponentProps<FuelStatusConfig>>) {
  const mode: DeltaVMode = config?.deltaVMode ?? "actual";
  const currentStage = useDataValue("data", "v.currentStage");
  const stageCount = useDataValue("data", "dv.stageCount");
  const totalDVVac = useDataValue("data", "dv.totalDVVac");
  const totalDVASL = useDataValue("data", "dv.totalDVASL");
  const totalDVActual = useDataValue("data", "dv.totalDVActual");
  const totalBurnTime = useDataValue("data", "dv.totalBurnTime");

  // Hooks unrolled explicitly — Rules of Hooks forbids hook calls inside any
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

  // `dv.stages` is the whole-vessel stage array. One subscription, all the
  // per-stage data Telemachus knows about — length matches the real stage
  // count, no hardcoded cap, no hook-per-stage. Entries arrive high → low
  // (stage 3 first, stage 0 last) matching the stack-top-down render order.
  const stages = useDataValue("data", "dv.stages") ?? [];
  const maxStageDv = Math.max(...stages.map((s) => pickDeltaV(s, mode)), 0.001);

  const totalDv =
    mode === "vac" ? totalDVVac : mode === "asl" ? totalDVASL : totalDVActual;

  // Selective rendering — total ΔV is the headline. Resource bars and the
  // per-stage stack drop bottom-up as height shrinks.
  const cols = w ?? 8;
  const rows = h ?? 14;
  const showSubtitle = rows >= 5;
  const showTotals = rows >= 4;
  const showResourceList = rows >= 7 && cols >= 5;
  const showStageStack = rows >= 10 && cols >= 5;
  const showHeroDv = !showTotals && totalDv !== undefined;

  return (
    <Panel>
      <PanelTitle>FUEL · ΔV</PanelTitle>
      {showSubtitle && currentStage !== undefined && (
        <PanelSubtitle>
          Stage {currentStage}
          {stageCount !== undefined && ` / ${Math.max(stageCount - 1, 0)}`}
        </PanelSubtitle>
      )}

      {showHeroDv && (
        <BigReadout $tone="alert">
          {`${(totalDv as number).toFixed(0)} m/s`}
          <ReadoutCaption>ΔV {DELTA_V_MODE_SHORT[mode]}</ReadoutCaption>
        </BigReadout>
      )}

      {showTotals && (totalDv !== undefined || totalBurnTime !== undefined) && (
        <TotalsRow>
          <TotalsBlock>
            <TotalsLabel>Total ΔV</TotalsLabel>
            <TotalsValue>
              {totalDv !== undefined ? `${totalDv.toFixed(0)} m/s` : "—"}
              <TotalsModeTag>{DELTA_V_MODE_SHORT[mode]}</TotalsModeTag>
            </TotalsValue>
          </TotalsBlock>
          <TotalsBlock>
            <TotalsLabel>Total burn</TotalsLabel>
            <TotalsValue>
              {totalBurnTime !== undefined
                ? formatDuration(totalBurnTime)
                : "—"}
            </TotalsValue>
          </TotalsBlock>
        </TotalsRow>
      )}

      {showResourceList && (
        <ResourceList>
          {readings
            .filter(({ max }) => max > 0)
            .map(({ def, value, max }) => (
              <ResourceRow key={def.name}>
                <ResourceLabel>
                  {def.label}
                  {def.scope === "current" && <ScopeHint> · stage</ScopeHint>}
                  {def.scope === "vessel" && <ScopeHint> · vessel</ScopeHint>}
                </ResourceLabel>
                <Bar>
                  <BarFill
                    style={{
                      width: `${clampPct((value / max) * 100)}%`,
                      background: def.color,
                    }}
                  />
                </Bar>
                <ResourceReadout>
                  {formatAmount(value)} / {formatAmount(max)}
                </ResourceReadout>
              </ResourceRow>
            ))}
        </ResourceList>
      )}

      {showStageStack && stages.length > 0 && (
        <StageStack>
          <StageHeader>
            Stages · ΔV ({DELTA_V_MODE_SHORT[mode]}) · burn · TWR
          </StageHeader>
          {stages.map((s) => {
            const dv = pickDeltaV(s, mode);
            const twr = pickTWR(s, mode);
            const active = s.stage === currentStage;
            return (
              <StageRow key={s.stage} $active={active}>
                <StageLabel>
                  {active ? "▶ " : "  "}S{s.stage}
                </StageLabel>
                <Bar>
                  <BarFill
                    style={{
                      width: `${clampPct((dv / maxStageDv) * 100)}%`,
                      background: active
                        ? "var(--color-status-warning-bg)"
                        : "var(--color-text-faint)",
                    }}
                  />
                </Bar>
                <StageReadout>
                  <StageDv>{dv.toFixed(0)} m/s</StageDv>
                  <StageMeta>
                    {formatDuration(s.burnTime)} · TWR {twr.toFixed(2)}
                  </StageMeta>
                </StageReadout>
              </StageRow>
            );
          })}
        </StageStack>
      )}
    </Panel>
  );
}

// ── Config component ──────────────────────────────────────────────────────────

function FuelStatusConfigComponent({
  config,
  onSave,
}: Readonly<ConfigComponentProps<FuelStatusConfig>>) {
  const [mode, setMode] = useState<DeltaVMode>(config?.deltaVMode ?? "actual");
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
          "Current atmosphere" matches live conditions — what you'll actually
          burn. Switch to vacuum for planning headroom.
        </FieldHint>
      </Field>
      <PrimaryButton onClick={() => onSave({ deltaVMode: mode })}>
        Save
      </PrimaryButton>
    </ConfigForm>
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function clampPct(pct: number): number {
  if (!Number.isFinite(pct) || pct < 0) return 0;
  if (pct > 100) return 100;
  return pct;
}

/** Units of stock KSP resources aren't kg — Telemachus returns the raw unit count. */
function formatAmount(value: number): string {
  if (value >= 10_000) return value.toFixed(0);
  if (value >= 100) return value.toFixed(1);
  return value.toFixed(2);
}

function formatDuration(s: number): string {
  if (!Number.isFinite(s) || s <= 0) return "0s";
  if (s < 60) return `${s.toFixed(0)}s`;
  const m = Math.floor(s / 60);
  const sec = Math.round(s - m * 60);
  if (m < 60) return `${m}m ${sec}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${m - h * 60}m`;
}

// ── Styles ────────────────────────────────────────────────────────────────────

const ResourceList = styled.div`
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-top: 6px;
`;

const ResourceRow = styled.div`
  display: grid;
  grid-template-columns: 7em 1fr auto;
  align-items: center;
  gap: 8px;
  font-size: 11px;
`;

const ResourceLabel = styled.span`
  color: var(--color-text-primary);
  letter-spacing: 0.02em;
`;

const ScopeHint = styled.span`
  color: var(--color-text-faint);
  font-size: var(--font-size-xs);
  letter-spacing: 0.05em;
  text-transform: uppercase;
`;

const ResourceReadout = styled.span`
  color: var(--color-text-muted);
  font-size: var(--font-size-xs);
  white-space: nowrap;
`;

const Bar = styled.div`
  height: 8px;
  background: var(--color-surface-panel);
  border: 1px solid var(--color-border-subtle);
  overflow: hidden;
`;

const BarFill = styled.div`
  height: 100%;
  transition: width 120ms linear;
`;

const TotalsRow = styled.div`
  display: flex;
  gap: 16px;
  margin-top: 8px;
  padding: 6px 8px;
  background: var(--color-surface-panel);
  border: 1px solid var(--color-border-subtle);
  border-radius: 2px;
`;

const TotalsBlock = styled.div`
  display: flex;
  flex-direction: column;
  gap: 2px;
`;

const TotalsLabel = styled.span`
  color: var(--color-text-faint);
  font-size: var(--font-size-xs);
  letter-spacing: 0.1em;
  text-transform: uppercase;
`;

const TotalsValue = styled.span`
  color: var(--color-status-nogo-fg);
  font-size: 13px;
  font-weight: 700;
  display: inline-flex;
  align-items: baseline;
  gap: 6px;
`;

const TotalsModeTag = styled.span`
  color: var(--color-text-dim);
  font-size: var(--font-size-xs);
  letter-spacing: 0.08em;
`;

const StageStack = styled.div`
  margin-top: 10px;
  padding-top: 6px;
  border-top: 1px solid var(--color-border-subtle);
  display: flex;
  flex-direction: column;
  gap: 3px;
`;

const StageHeader = styled.div`
  color: var(--color-text-faint);
  font-size: var(--font-size-xs);
  letter-spacing: 0.1em;
  text-transform: uppercase;
  margin-bottom: 4px;
`;

const StageRow = styled.div<{ $active?: boolean }>`
  display: grid;
  grid-template-columns: 3.5em 1fr auto;
  align-items: center;
  gap: 8px;
  font-size: 11px;
  color: ${({ $active }) => ($active ? "var(--color-status-nogo-fg)" : "var(--color-text-muted)")};
`;

const StageLabel = styled.span`
  font-size: var(--font-size-xs);
  letter-spacing: 0.02em;
`;

const StageReadout = styled.span`
  font-size: var(--font-size-xs);
  white-space: nowrap;
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  line-height: 1.2;
`;

const StageDv = styled.span``;

const StageMeta = styled.span`
  color: var(--color-text-faint);
  font-size: var(--font-size-xs);
`;

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
  dataRequirements: [
    "v.currentStage",
    "dv.stageCount",
    "dv.totalDVVac",
    "dv.totalDVASL",
    "dv.totalDVActual",
    "dv.totalBurnTime",
    "r.resource[LiquidFuel]",
    "r.resourceMax[LiquidFuel]",
    "r.resourceCurrent[LiquidFuel]",
    "r.resourceCurrentMax[LiquidFuel]",
    "r.resource[Oxidizer]",
    "r.resourceMax[Oxidizer]",
    "r.resourceCurrent[Oxidizer]",
    "r.resourceCurrentMax[Oxidizer]",
    "r.resource[MonoPropellant]",
    "r.resourceMax[MonoPropellant]",
    "r.resourceCurrent[MonoPropellant]",
    "r.resourceCurrentMax[MonoPropellant]",
    "r.resource[XenonGas]",
    "r.resourceMax[XenonGas]",
    "r.resourceCurrent[XenonGas]",
    "r.resourceCurrentMax[XenonGas]",
    "r.resource[ElectricCharge]",
    "r.resourceMax[ElectricCharge]",
    "r.resourceCurrent[ElectricCharge]",
    "r.resourceCurrentMax[ElectricCharge]",
    "dv.stages",
  ],
  defaultConfig: { deltaVMode: "actual" },
  actions: [],
  pushable: true,
});

export { FuelStatusComponent };
