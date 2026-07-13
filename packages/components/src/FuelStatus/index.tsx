import type {
  ComponentProps,
  ConfigComponentProps,
  StageInfo,
} from "@ksp-gonogo/core";
import {
  AugmentSlot,
  clampSafe,
  getWidgetShape,
  registerComponent,
  useDataStreamStatus,
  useDataValue,
} from "@ksp-gonogo/core";
import {
  BigReadout,
  ConfigForm,
  Field,
  FieldHint,
  FieldLabel,
  Panel,
  PanelSubtitle,
  PanelTitle,
  ReadoutCaption,
  Select,
  StreamStatusBadge,
  useModalSaveBar,
} from "@ksp-gonogo/ui";
import { useMemo, useState } from "react";
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

/**
 * Telemachus occasionally hands us a stage row where TWR / ΔV is missing
 * (engine-less stage, decoupler-only, post-staging frame where the engine
 * has been ejected). The fix at 21:08 BST on 2026-05-17 was the absence
 * of this guard — `twr.toFixed` crashed the whole widget when twr was
 * undefined for one row.
 */
function fmtFixed(value: unknown, digits: number): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "—";
  return value.toFixed(digits);
}

/**
 * `dv.stages` can now arrive off either transport under the identical key
 * (map-topic.ts's whole-topic identity read): the
 * legacy Telemachus `DataSource` still ships the historical `StageInfo`
 * camelCase names (`deltaVVac`/`TWRVac`/`thrustASL`/...), while the new mod
 * streams a `StageDeltaVEntry` (mod/sitrep-sdk contract.ts:491) through the
 * same `dv.stages` topic — `dvVac`/`dvAsl`/`dvActual`/`twrVac`/`twrAsl`/
 * `twrActual`/`thrustAsl`, and it never carries `stageMass`/`isp*` at all.
 * Normalize every entry to the `StageInfo` shape the renderer already reads
 * so `pickDeltaV`/`pickTWR` don't need to know which wire produced the row.
 * Mirrors ScienceOfficer's `parseInstruments` shape-reconciliation pattern.
 */
export function parseStages(raw: unknown): StageInfo[] {
  if (!Array.isArray(raw)) return [];
  const out: StageInfo[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const e = entry as Record<string, unknown>;
    const num = (...keys: string[]): number => {
      for (const k of keys) {
        const v = e[k];
        if (typeof v === "number" && Number.isFinite(v)) return v;
      }
      return Number.NaN;
    };
    out.push({
      stage: num("stage"),
      stageMass: num("stageMass"),
      dryMass: num("dryMass"),
      fuelMass: num("fuelMass"),
      startMass: num("startMass"),
      endMass: num("endMass"),
      burnTime: num("burnTime"),
      deltaVVac: num("deltaVVac", "dvVac"),
      deltaVASL: num("deltaVASL", "dvAsl"),
      deltaVActual: num("deltaVActual", "dvActual"),
      TWRVac: num("TWRVac", "twrVac"),
      TWRASL: num("TWRASL", "twrAsl"),
      TWRActual: num("TWRActual", "twrActual"),
      ispVac: num("ispVac"),
      ispASL: num("ispASL"),
      ispActual: num("ispActual"),
      thrustVac: num("thrustVac"),
      thrustASL: num("thrustASL", "thrustAsl"),
      thrustActual: num("thrustActual"),
    });
  }
  return out;
}

// ── Component ─────────────────────────────────────────────────────────────────

function FuelStatusComponent({
  config,
  w,
  h,
}: Readonly<ComponentProps<FuelStatusConfig>>) {
  const mode: DeltaVMode = config?.deltaVMode ?? "actual";
  const currentStage = useDataValue("data", "v.currentStage");
  // Connectivity indicator, mirroring the WarpControl pilot.
  // `v.currentStage` is this widget's one representative MAPPED key
  // (-> `vessel.structure.currentStage`). The ΔV totals/stage-stack `dv.*`
  // keys are UN-GAPPED (`dv.stages` ->
  // whole-topic `dv.stages`; `dv.stageCount`/`totalDV*`/`totalBurnTime` ->
  // raw-field walks on the sibling `dv.summary` topic, map-topic.ts's
  // `TELEMACHUS_CLEAN_HOMES`) and route through the stream too. The
  // LiquidFuel/Oxidizer resource bars' stage-scoped `r.resourceCurrent(Max)[X]`
  // keys are ALSO un-gapped now (the `dv.currentStageResource(Max)`
  // DERIVED channels, dv-stage-resources.ts), so every key this badge
  // could plausibly stand in for rides the same transport together.
  const streamStatus = useDataStreamStatus("data", "v.currentStage");
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
  // per-stage data Telemachus (or the mod's StageDeltaVEntry[] topic, same
  // key) knows about — length matches the real stage count, no hardcoded
  // cap, no hook-per-stage. Entries arrive high → low (stage 3 first,
  // stage 0 last) matching the stack-top-down render order. `parseStages`
  // reconciles either wire's field names into the `StageInfo` shape below.
  const stagesRaw = useDataValue("data", "dv.stages");
  const stages = parseStages(stagesRaw);
  // Filter to finite values before Math.max — a single NaN/undefined entry
  // would propagate NaN through every BarFill width and render a row of
  // invisible bars.
  const finiteDvs = stages
    .map((s) => pickDeltaV(s, mode))
    .filter((v): v is number => Number.isFinite(v));
  const maxStageDv =
    finiteDvs.length > 0 ? Math.max(...finiteDvs, 0.001) : 0.001;

  const totalDv =
    mode === "vac" ? totalDVVac : mode === "asl" ? totalDVASL : totalDVActual;

  // Selective rendering — total ΔV is the headline. Resource bars and the
  // per-stage stack drop bottom-up as height shrinks.
  const cols = w ?? 8;
  const rows = h ?? 14;
  // Wide-short: width compensates for the height-gates, so show the resource
  // list + stage stack side-by-side beneath the totals row instead of leaving
  // the box sparse. The boost still needs vertical room beneath the totals row
  // — below ~6 rows even a single section overflows (landscape-18x5), so don't
  // let the landscape override force the columns on at those heights.
  const isLandscape = getWidgetShape(w, h).shape === "landscape" && rows >= 6;
  const showSubtitle = rows >= 5;
  const showTotals = rows >= 4;
  const showResourceList = cols >= 5 && (rows >= 7 || isLandscape);
  const showStageStack = cols >= 5 && (rows >= 10 || isLandscape);
  const showHeroDv = !showTotals && totalDv !== undefined;
  // At the narrowest width the stage stack ever renders at (cols === 5,
  // portrait-5x18), "<burn> · TWR <n>" doesn't fit next to the ΔV bar even
  // with the bar's 28px floor honoured — the row overflows past the panel
  // edge and gets clipped. Splitting burn time and TWR onto their own lines
  // shortens the longest line enough to fit; there's always vertical room
  // to spare here since the stage stack only shows once rows >= 10.
  const compactStageMeta = cols < 7;

  return (
    <Panel>
      <TitleRow>
        <PanelTitle>FUEL · ΔV</PanelTitle>
        {/* Header escape-hatch slot (augment-slot-map "Feedback round 1"):
            any Uplink can drop an inline badge next to the title. Renders
            nothing until an augment binds `fuel-status.badges`. */}
        <AugmentSlot name="fuel-status.badges" props={{}} />
        <StreamStatusBadge status={streamStatus} />
      </TitleRow>
      {showSubtitle && currentStage !== undefined && (
        <PanelSubtitle>
          Stage {currentStage}
          {stageCount !== undefined && ` / ${Math.max(stageCount - 1, 0)}`}
        </PanelSubtitle>
      )}

      {showHeroDv && (
        <HeroReadout $tone="alert">
          <HeroValue>{`${fmtFixed(totalDv, 0)} m/s`}</HeroValue>
          <ReadoutCaption>ΔV {DELTA_V_MODE_SHORT[mode]}</ReadoutCaption>
        </HeroReadout>
      )}

      {/* No engine data + no totals row to fall back on → render an
          em-dash so the tiny widget doesn't appear blank. Without this
          branch the panel shows only the title and a black void below
          (the no-engine-data fixture at tiny-3x3 hit this state). */}
      {!showHeroDv && !showTotals && totalDv === undefined && (
        <BigReadout>—</BigReadout>
      )}

      {showTotals && (totalDv !== undefined || totalBurnTime !== undefined) && (
        <TotalsRow>
          <TotalsBlock>
            <TotalsLabel>Total ΔV</TotalsLabel>
            <TotalsValue>
              {totalDv !== undefined ? `${fmtFixed(totalDv, 0)} m/s` : "—"}
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

      <Sections $row={isLandscape}>
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
                        width: `${clampPct(((Number.isFinite(dv) ? dv : 0) / maxStageDv) * 100)}%`,
                        background: active
                          ? "var(--color-status-warning-bg)"
                          : "var(--color-text-faint)",
                      }}
                    />
                  </Bar>
                  <StageReadout>
                    <StageDv>{fmtFixed(dv, 0)} m/s</StageDv>
                    {compactStageMeta ? (
                      <>
                        <StageMeta>{formatDuration(s.burnTime)}</StageMeta>
                        <StageMeta>TWR {fmtFixed(twr, 2)}</StageMeta>
                      </>
                    ) : (
                      <StageMeta>
                        {formatDuration(s.burnTime)} · TWR {fmtFixed(twr, 2)}
                      </StageMeta>
                    )}
                  </StageReadout>
                </StageRow>
              );
            })}
          </StageStack>
        )}

        {/* Body slot appended after the per-stage ΔV/TWR stack. An
            engine-realism Uplink (ignitions-remaining, propellant boil-off)
            contributes per-stage supplemental rows here. Renders nothing
            until an augment binds `fuel-status.sections`. */}
        <AugmentSlot name="fuel-status.sections" props={{}} />
      </Sections>
    </Panel>
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
          "Current atmosphere" matches live conditions — what you'll actually
          burn. Switch to vacuum for planning headroom.
        </FieldHint>
      </Field>
    </ConfigForm>
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const clampPct = (pct: number): number => clampSafe(pct, 0, 100);

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

const TitleRow = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  min-width: 0;
  flex-wrap: wrap;
`;

/**
 * `BigReadout`'s font-size clamps up to 38px regardless of the widget's own
 * grid size — it reads from viewport width, not container width — which is
 * fine for a lone short value (see other consumers) but overflows badly for
 * "<n> m/s": at the 3x3 minSize the string wraps at the space and the
 * wrapped "m/s" line gets clipped by `Panel`'s `overflow: hidden`. We can't
 * touch the shared `BigReadout` (same constraint CrewManifest hit), so cap
 * the font lower here, scoped to the hero branch only.
 */
const HeroReadout = styled(BigReadout)`
  font-size: clamp(13px, 3.5vw, 17px);
`;

/**
 * Keeps the value and its unit glued to one line — a number must never wrap
 * away from (or get clipped apart from) its unit. Paired with `HeroReadout`'s
 * smaller font so the whole string actually fits at tiny widget sizes
 * instead of merely refusing to wrap while still overflowing.
 */
const HeroValue = styled.span`
  white-space: nowrap;
`;

// Wrapper around the resource list + stage stack. Transparent (`display:
// contents`) by default so the normal vertical stack is unchanged; at
// wide-short it becomes a row so the two sit side-by-side, each taking half.
const Sections = styled.div<{ $row?: boolean }>`
  display: ${(p) => (p.$row ? "flex" : "contents")};
  ${(p) =>
    p.$row &&
    `flex-direction: row; gap: 16px; min-height: 0; align-items: flex-start;
     & > * { flex: 1 1 0; min-width: 0; }`}
`;

const ResourceList = styled.div`
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-top: 6px;
`;

const ResourceRow = styled.div`
  display: grid;
  /* Label column: a fixed 13em ideal (fits the longest label,
     "Liquid Fuel · STAGE") keeps every bar's left edge aligned so the
     fills can be compared at a glance, while minmax(0, ...) lets the
     column shrink with an ellipsis when the cell is genuinely narrow.
     The old 5em cap truncated "Liquid Fuel" → "Liquid ..." even at
     default/wide sizes. The bar keeps a hard min-width (see Bar) so it
     never collapses to a sliver when the readout column claims its
     space at narrow widths. */
  grid-template-columns: minmax(0, 13em) minmax(28px, 1fr) auto;
  align-items: center;
  gap: 8px;
  font-size: 11px;
`;

const ResourceLabel = styled.span`
  color: var(--color-text-primary);
  letter-spacing: 0.02em;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
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
  min-width: 28px;
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
  /* Bar column needs a real floor (28px, matching Bar's own min-width and
     ResourceRow's identical column below) — not minmax(0, ...). With a 0
     base, a narrow row (e.g. portrait-5x18) collapses this track to 0 and
     the Bar div's min-width then overflows the 0-width cell to the right,
     landing directly under the StageReadout column. StageReadout paints
     after Bar in DOM order, so the burn-time/TWR text rendered on top of
     the ΔV bar instead of beside it. */
  grid-template-columns: 3.5em minmax(28px, 1fr) auto;
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

// ── Augment slots ─────────────────────────────────────────────────────────────

// Declaration-merge this widget's slot ids → their props types into core's
// `SlotRegistry` (Uplink architecture §4.6). Both slots are plain
// section/badge slots (not overlays), so they pass no coordinate/projection
// context — an empty props object. Kept co-located here, not in a shared
// central registry file, so parallel per-widget slot work never collides.
declare module "@ksp-gonogo/core" {
  interface SlotRegistry {
    "fuel-status.sections": Record<string, never>;
    "fuel-status.badges": Record<string, never>;
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
  // dv.stageCount/dv.totalDVVac/dv.totalDVASL/dv.totalDVActual/
  // dv.totalBurnTime/dv.stages are all UN-GAPPED —
  // same declared keys, routed through the stream by `mapTopic`
  // (map-topic.ts's TELEMACHUS_CLEAN_HOMES) with a zero call-site rename;
  // `dv.stages`'s wire shape changed underneath it though, see
  // `parseStages` above. The r.resourceCurrent(Max)[X] stage-scoped splits
  // stay GAPPED (no wire home) and remain legacy-only.
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
  augmentSlots: ["fuel-status.sections", "fuel-status.badges"],
  pushable: true,
  requires: ["flight"],
});

export { FuelStatusComponent };
