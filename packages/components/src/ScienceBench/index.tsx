import type { ComponentProps } from "@gonogo/core";
import {
  registerComponent,
  useDataStreamStatus,
  useDataValue,
  useGameContext,
} from "@gonogo/core";
import {
  DimmedOverlay,
  Panel,
  PanelSubtitle,
  PanelTitle,
  ScrollArea,
  StreamStatusBadge,
} from "@gonogo/ui";
import { useEffect, useRef, useState } from "react";
import styled from "styled-components";

type ScienceBenchConfig = Record<string, never>;

const SENSOR_TYPES = ["temp", "pres", "grav", "acc"] as const;
type SensorType = (typeof SENSOR_TYPES)[number];

const SENSOR_LABELS: Record<SensorType, string> = {
  temp: "Temperature",
  pres: "Pressure",
  grav: "Gravity",
  acc: "Acceleration",
};

const SENSOR_UNITS: Record<SensorType, string> = {
  temp: "K",
  pres: "kPa",
  grav: "m/s²",
  acc: "m/s²",
};

/**
 * Telemachus's `s.sensor.<type>` is documented loosely ("Sensor data by
 * type"). Defensive parser: accepts arrays of `{ partName, value }`-shaped
 * entries OR plain object maps OR a single number OR Telemachus's parallel
 * `[names, values]` tuple, and falls back to "no sensors" when nothing
 * resolves to a real reading.
 *
 * Returns `"no sensors"` to mean "vessel has no sensor of this type" — the
 * UI distinguishes this from the loading state (`null`).
 */
interface SensorReading {
  partName: string;
  value: number;
}

export type SensorParseResult = SensorReading[] | "no sensors" | null;

/** Telemachus emits this exact string when no sensor of the requested type exists. */
const NO_SENSORS_SENTINEL = "No Sensors of the Appropriate Type";

export function parseSensorReadings(raw: unknown): SensorParseResult {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === "number" && Number.isFinite(raw)) {
    return [{ partName: "Sensor", value: raw }];
  }
  if (Array.isArray(raw)) {
    // Parallel-arrays tuple: `[partNames[], values[]]`. Telemachus uses this
    // shape for `s.sensor.<type>` — names in slot 0, values in slot 1, by
    // index. Detect it before falling through to the heterogeneous-entries
    // path so we don't drop matched name/value pairs on the floor.
    if (
      raw.length === 2 &&
      Array.isArray(raw[0]) &&
      Array.isArray(raw[1]) &&
      raw[0].every((n) => typeof n === "string") &&
      raw[1].every((v) => typeof v === "number")
    ) {
      const names = raw[0] as string[];
      const values = raw[1] as number[];
      // Telemachus's empty state is the literal name "No Sensors …" paired
      // with a single 0. Surface as "no sensors" so the UI shows a friendly
      // empty row instead of the raw shape.
      if (names.length === 1 && names[0] === NO_SENSORS_SENTINEL) {
        return "no sensors";
      }
      const out: SensorReading[] = [];
      for (let i = 0; i < Math.min(names.length, values.length); i++) {
        if (Number.isFinite(values[i])) {
          out.push({ partName: names[i], value: values[i] });
        }
      }
      return out.length > 0 ? out : "no sensors";
    }
    const out: SensorReading[] = [];
    for (const entry of raw) {
      const parsed = readingFromObject(entry);
      if (parsed) out.push(parsed);
    }
    return out.length > 0 ? out : "no sensors";
  }
  if (typeof raw === "object") {
    const out: SensorReading[] = [];
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
      if (typeof v === "number" && Number.isFinite(v)) {
        out.push({ partName: k, value: v });
      }
    }
    return out.length > 0 ? out : "no sensors";
  }
  return "no sensors";
}

function readingFromObject(entry: unknown): SensorReading | null {
  if (!entry || typeof entry !== "object") return null;
  const e = entry as Record<string, unknown>;
  const value =
    typeof e.value === "number"
      ? e.value
      : typeof e.reading === "number"
        ? e.reading
        : typeof e.v === "number"
          ? e.v
          : null;
  if (value === null || !Number.isFinite(value)) return null;
  const partName =
    typeof e.partName === "string"
      ? e.partName
      : typeof e.name === "string"
        ? e.name
        : typeof e.part === "string"
          ? e.part
          : "Sensor";
  return { partName, value };
}

export interface ParsedExperiment {
  /** Human-readable experiment + biome label (e.g. "Crew report from KSC"). */
  title: string;
  /** Host part title (e.g. "Mystery Goo Container"). */
  part: string | null;
  /** Mits of data already collected. */
  dataAmount: number | null;
  /** Stable id we can key React lists on. */
  subjectId: string;
}

/**
 * Parses `sci.experiments`. Two wire shapes land here:
 *
 * - Legacy Telemachus Reborn: `{ part, title, dataAmount,
 *   scienceValueBase, transmitBoost, subjectId }` (see
 *   ScienceCareerDataLinkHandler in the Telemachus fork).
 * - New SDK `science.experiments` (M3 science/parts batch, mapped onto this
 *   same widget-facing key via `map-topic.ts`): `{ partName, location,
 *   experimentId, subjectId, title, dataAmount, ... }` —
 *   `mod/Sitrep.Host/ScienceViewProvider.cs`'s superset of the legacy shape,
 *   `partName` in place of `part`. `entry.partName ?? entry.part` below
 *   reads either wire's field name identically; every other field the
 *   widget needs (`title`/`dataAmount`/`subjectId`) is spelled the same on
 *   both.
 */
export function parseExperiments(raw: unknown): ParsedExperiment[] | null {
  if (raw === null || raw === undefined) return null;
  if (!Array.isArray(raw)) return null;
  const out: ParsedExperiment[] = [];
  for (let i = 0; i < raw.length; i++) {
    const entry = raw[i];
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    const e = entry as Record<string, unknown>;
    const subjectId =
      typeof e.subjectId === "string" ? e.subjectId : `experiment-${i}`;
    const part =
      typeof e.partName === "string"
        ? e.partName
        : typeof e.part === "string"
          ? e.part
          : null;
    out.push({
      title: typeof e.title === "string" ? e.title : "(unnamed)",
      part,
      dataAmount: typeof e.dataAmount === "number" ? e.dataAmount : null,
      subjectId,
    });
  }
  return out;
}

export interface ExperimentBreakdownEntry {
  subjectId: string;
  biome: string;
  situation: string;
  expTitle: string;
  dataMits: number;
  /** subjectScienceCap - subjectScience; how much science is left in this subject. */
  remainingPotential: number;
}

/**
 * Parses `sci.experimentBreakdown` from the GonogoTelemetry plugin. Richer
 * shape than `sci.experiments`: includes biome / situation segments parsed
 * from the subject id and the remaining science potential. Used when
 * present; widget falls back to the existing `sci.experiments` view when
 * the plugin isn't installed.
 */
export function parseExperimentBreakdown(
  raw: unknown,
): ExperimentBreakdownEntry[] | null {
  if (raw === null || raw === undefined) return null;
  if (!Array.isArray(raw)) return null;
  const out: ExperimentBreakdownEntry[] = [];
  for (let i = 0; i < raw.length; i++) {
    const entry = raw[i];
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    const e = entry as Record<string, unknown>;
    out.push({
      subjectId:
        typeof e.subjectId === "string" ? e.subjectId : `breakdown-${i}`,
      biome: typeof e.biome === "string" ? e.biome : "",
      situation: typeof e.situation === "string" ? e.situation : "",
      expTitle: typeof e.expTitle === "string" ? e.expTitle : "(unnamed)",
      dataMits: typeof e.dataMits === "number" ? e.dataMits : 0,
      remainingPotential:
        typeof e.remainingPotential === "number" ? e.remainingPotential : 0,
    });
  }
  // Sort by remaining potential desc — subjects with the most science left
  // to extract come first; the operator focuses on what's worth recovering.
  out.sort((a, b) => b.remainingPotential - a.remainingPotential);
  return out;
}

const SITUATION_BADGE_MS = 10_000;
const SITUATION_DEBOUNCE_MS = 2_000;

function ScienceBenchComponent({
  w,
  h,
}: Readonly<ComponentProps<ScienceBenchConfig>>) {
  // Partial-dim: situation + sensors + aboard sections only mean
  // something while a vessel is flying; the career strip (funds /
  // science / rep) is meaningful in any scene. Dimming the whole
  // widget at SC would hide legit career numbers, so we wrap only
  // the flight-dependent half. `hasGameSignal` keeps the dim off
  // until the kc.scene WS warmup completes.
  const { inFlight, hasGameSignal } = useGameContext();
  const dimNonCareer = hasGameSignal && !inFlight;

  const body = useDataValue("data", "v.body");
  const situation = useDataValue("data", "v.situationString") as
    | string
    | undefined;
  const landedAt = useDataValue("data", "v.landedAt") as string | undefined;
  // Live biome from `ScienceUtil.GetExperimentBiome` — the same source the
  // game uses to attribute new experiments. Works in flight + space scenes
  // (e.g. "FlyingHigh", "Splashed - OceanWater"), unlike `v.landedAt` which
  // is only populated on the surface. Falls back to landedAt when blank.
  const liveBiome = useDataValue("data", "v.biome") as string | undefined;

  const tempRaw = useDataValue("data", "s.sensor.temp");
  const presRaw = useDataValue("data", "s.sensor.pres");
  const gravRaw = useDataValue("data", "s.sensor.grav");
  const accRaw = useDataValue("data", "s.sensor.acc");

  const sciCount = useDataValue("data", "sci.count");
  const sciDataAmount = useDataValue("data", "sci.dataAmount");
  const sciExperimentsRaw = useDataValue("data", "sci.experiments");
  const sciBreakdownRaw = useDataValue("data", "sci.experimentBreakdown");
  // M3 science/parts batch: sci.experiments is mapped onto science.experiments
  // (map-topic.ts) — the rest of the science reads above stay legacy-only.
  const experimentsStreamStatus = useDataStreamStatus(
    "data",
    "sci.experiments",
  );

  const careerMode = useDataValue("data", "career.mode") as string | undefined;
  const careerScience = useDataValue("data", "career.science");
  const careerFunds = useDataValue("data", "career.funds");
  const careerRep = useDataValue("data", "career.reputation");

  // Composite "where am I doing science" key — body / situation / biome.
  // Debounced to suppress momentary biome flickers during low passes; the
  // NEW badge only lights on a settled change. Prefer the live biome over
  // `landedAt` because biome covers in-flight bands too.
  const situationLocale = liveBiome ?? landedAt ?? "";
  const situationKey = `${body ?? ""}|${situation ?? ""}|${situationLocale}`;
  const stableKey = useDebouncedValue(situationKey, SITUATION_DEBOUNCE_MS);
  const [highlightUntil, setHighlightUntil] = useState(0);
  const lastSeenRef = useRef<string | null>(null);
  useEffect(() => {
    if (lastSeenRef.current === null) {
      lastSeenRef.current = stableKey;
      return;
    }
    if (stableKey !== lastSeenRef.current) {
      lastSeenRef.current = stableKey;
      setHighlightUntil(Date.now() + SITUATION_BADGE_MS);
    }
  }, [stableKey]);
  const [, forceTick] = useState(0);
  useEffect(() => {
    if (highlightUntil === 0) return;
    const remaining = highlightUntil - Date.now();
    if (remaining <= 0) {
      setHighlightUntil(0);
      return;
    }
    const id = setTimeout(() => forceTick((x) => x + 1), remaining);
    return () => clearTimeout(id);
  }, [highlightUntil]);
  const showNew = highlightUntil > Date.now();

  const sensors: Array<[SensorType, unknown]> = [
    ["temp", tempRaw],
    ["pres", presRaw],
    ["grav", gravRaw],
    ["acc", accRaw],
  ];

  const experiments = parseExperiments(sciExperimentsRaw);
  const breakdown = parseExperimentBreakdown(sciBreakdownRaw);
  const showCareer =
    typeof careerMode === "string" && careerMode.toUpperCase() !== "SANDBOX";

  // Selective rendering — situation pill always; supplementary sections
  // drop bottom-up as height shrinks.
  const cols = w ?? 8;
  const rows = h ?? 10;
  const showSensors = rows >= 5 && cols >= 4;
  const showAboard = rows >= 7 && cols >= 4;
  const showCareerStrip = showCareer && rows >= 9;

  return (
    <Panel>
      <TitleRow>
        <PanelTitle>SCIENCE</PanelTitle>
        <StreamStatusBadge status={experimentsStreamStatus} />
      </TitleRow>
      <DimmedOverlay
        show={dimNonCareer}
        message="Sensors require flight"
        hint="Career stats below stay current."
      >
        <SituationLine
          role="status"
          aria-live="polite"
          aria-label="Current situation for science"
        >
          <SituationText>
            {body && situation
              ? `${situation}${situationLocale ? ` — ${situationLocale}` : ""}`
              : "Awaiting situation telemetry"}
          </SituationText>
          {showNew && <NewBadge>NEW</NewBadge>}
        </SituationLine>

        <Body>
          {showSensors && (
            <Section>
              <SectionTitle>Sensors</SectionTitle>
              <SensorList>
                {sensors.map(([type, raw]) => (
                  <SensorRow key={type} type={type} raw={raw} />
                ))}
              </SensorList>
            </Section>
          )}

          {showAboard && (
            <Section>
              <SectionTitle>
                Aboard
                {typeof sciCount === "number" && (
                  <SectionMeta>
                    · {sciCount} record{sciCount === 1 ? "" : "s"}
                    {typeof sciDataAmount === "number" &&
                      ` · ${sciDataAmount.toFixed(1)} mits`}
                  </SectionMeta>
                )}
              </SectionTitle>
              {breakdown && breakdown.length > 0 ? (
                <BreakdownList breakdown={breakdown} />
              ) : (
                <ExperimentList experiments={experiments} sciCount={sciCount} />
              )}
            </Section>
          )}
        </Body>
      </DimmedOverlay>

      {showCareerStrip && (
        <CareerStrip>
          <CareerCell>
            <CareerLabel>SCI</CareerLabel>
            <CareerValue>{formatNumber(careerScience)}</CareerValue>
          </CareerCell>
          <CareerCell>
            <CareerLabel>FUNDS</CareerLabel>
            <CareerValue>{formatNumber(careerFunds)}</CareerValue>
          </CareerCell>
          <CareerCell>
            <CareerLabel>REP</CareerLabel>
            <CareerValue>{formatNumber(careerRep)}</CareerValue>
          </CareerCell>
        </CareerStrip>
      )}
    </Panel>
  );
}

// ── Subcomponents ─────────────────────────────────────────────────────────────

function SensorRow({ type, raw }: { type: SensorType; raw: unknown }) {
  const parsed = parseSensorReadings(raw);
  return (
    <SensorRowWrap>
      <SensorLabel>{SENSOR_LABELS[type]}</SensorLabel>
      <SensorValues>{renderSensorValues(parsed, type)}</SensorValues>
    </SensorRowWrap>
  );
}

interface AggregatedReading {
  partName: string;
  value: number;
}

/**
 * One chip per unique part name. Telemachus's `s.sensor.<type>` payload
 * has been observed emitting more entries than there are physical sensors
 * (a vessel with 3 thermometers can produce a list ~10× longer), so the
 * raw count is unreliable — we just average the readings within a part
 * and surface a single value. Different parts stay on separate rows so
 * genuine readings (e.g. a heat-shielded sensor vs an exposed one) aren't
 * folded together.
 */
function aggregateByPart(readings: SensorReading[]): AggregatedReading[] {
  const groups = new Map<string, number[]>();
  for (const r of readings) {
    const list = groups.get(r.partName);
    if (list) list.push(r.value);
    else groups.set(r.partName, [r.value]);
  }
  const out: AggregatedReading[] = [];
  for (const [partName, values] of groups) {
    // Telemachus emits 0 for disabled sensors; drop those so a half-dead
    // bench doesn't pull the average to zero. Fall back to the raw values
    // if every sensor in the group is disabled.
    const live = values.filter((v) => v !== 0);
    const samples = live.length > 0 ? live : values;
    const avg = samples.reduce((a, v) => a + v, 0) / samples.length;
    out.push({ partName, value: avg });
  }
  return out;
}

function renderSensorValues(
  parsed: SensorParseResult,
  type: SensorType,
): React.ReactNode {
  if (parsed === null) return <SensorMuted>—</SensorMuted>;
  if (parsed === "no sensors") return <SensorMuted>None installed</SensorMuted>;
  if (parsed.length === 0) return <SensorMuted>None installed</SensorMuted>;
  return aggregateByPart(parsed).map((agg) => (
    <SensorReadingChip key={agg.partName}>
      <ChipPart>{agg.partName}</ChipPart>
      <ChipValue>
        {agg.value.toFixed(2)} {SENSOR_UNITS[type]}
      </ChipValue>
    </SensorReadingChip>
  ));
}

function BreakdownList({
  breakdown,
}: {
  breakdown: ExperimentBreakdownEntry[];
}) {
  return (
    <ExperimentListWrap>
      {breakdown.map((b) => (
        <ExperimentRow key={b.subjectId}>
          <ExpSubject>
            {b.expTitle}
            {b.biome ? <BreakdownContext> · {b.biome}</BreakdownContext> : null}
          </ExpSubject>
          <ExpData>
            {b.dataMits.toFixed(1)} mits
            {b.remainingPotential > 0 ? (
              <BreakdownPotential>
                {" "}
                · {b.remainingPotential.toFixed(1)} left
              </BreakdownPotential>
            ) : null}
          </ExpData>
        </ExperimentRow>
      ))}
    </ExperimentListWrap>
  );
}

function ExperimentList({
  experiments,
  sciCount,
}: {
  experiments: ParsedExperiment[] | null;
  sciCount: unknown;
}) {
  if (experiments === null && typeof sciCount !== "number") {
    return <Muted>No science data aboard.</Muted>;
  }
  if (experiments === null) {
    return (
      <Muted>
        {sciCount === 0
          ? "No experiments aboard."
          : `${String(sciCount)} record(s) — details unavailable.`}
      </Muted>
    );
  }
  if (experiments.length === 0) return <Muted>No experiments aboard.</Muted>;
  return (
    <ExperimentListWrap>
      {experiments.map((e) => (
        <ExperimentRow key={e.subjectId}>
          <ExpSubject>{e.title}</ExpSubject>
          <ExpData>
            {e.dataAmount === null ? "—" : `${e.dataAmount.toFixed(1)} mits`}
          </ExpData>
        </ExperimentRow>
      ))}
    </ExperimentListWrap>
  );
}

function formatNumber(value: unknown): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "—";
  if (Math.abs(value) >= 1_000_000) return `${(value / 1_000_000).toFixed(2)}M`;
  if (Math.abs(value) >= 1_000) return `${(value / 1_000).toFixed(1)}k`;
  return value.toFixed(0);
}

function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(id);
  }, [value, delayMs]);
  return debounced;
}

// ── Styles ────────────────────────────────────────────────────────────────────

const TitleRow = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  min-width: 0;
`;

const SituationLine = styled(PanelSubtitle)`
  display: flex;
  align-items: center;
  gap: 8px;
`;

const SituationText = styled.span`
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

const NewBadge = styled.span`
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.1em;
  padding: 1px 5px;
  border-radius: 2px;
  background: var(--color-status-go-bg);
  color: var(--color-status-go-fg);
`;

const Body = styled(ScrollArea)`
  flex: 1;
  min-height: 0;

  [data-scroll-area-inner] {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
`;

const Section = styled.div`
  &:first-child {
    margin-top: 4px;
  }
`;

const SectionTitle = styled.div`
  font-size: var(--font-size-xs);
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--color-text-muted);
  margin-bottom: 4px;
`;

const SectionMeta = styled.span`
  color: var(--color-text-faint);
  margin-left: 4px;
  font-weight: 400;
  letter-spacing: 0.04em;
`;

const SensorList = styled.div`
  display: flex;
  flex-direction: column;
  gap: 4px;
`;

const SensorRowWrap = styled.div`
  display: grid;
  grid-template-columns: 90px 1fr;
  gap: 6px;
  align-items: baseline;
`;

const SensorLabel = styled.div`
  font-size: 11px;
  color: var(--color-text-muted);
`;

const SensorValues = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
`;

const SensorMuted = styled.span`
  font-size: 11px;
  color: var(--color-text-faint);
`;

const SensorReadingChip = styled.span`
  display: inline-flex;
  align-items: baseline;
  gap: 4px;
  padding: 1px 5px;
  background: var(--color-surface-panel);
  border-radius: 2px;
  font-size: 11px;
`;

const ChipPart = styled.span`
  color: var(--color-text-faint);
`;

const ChipValue = styled.span`
  color: var(--color-text-primary);
  font-weight: 600;
`;

const ExperimentListWrap = styled.ul`
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
`;

const ExperimentRow = styled.li`
  display: flex;
  justify-content: space-between;
  gap: 8px;
  font-size: 11px;
`;

const ExpSubject = styled.span`
  color: var(--color-text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex: 1;
  min-width: 0;
`;

const ExpData = styled.span`
  color: var(--color-accent-fg);
  font-variant-numeric: tabular-nums;
`;

const BreakdownContext = styled.span`
  color: var(--color-text-faint);
  font-weight: 400;
`;

const BreakdownPotential = styled.span`
  color: var(--color-text-muted);
`;

const Muted = styled.div`
  font-size: 11px;
  color: var(--color-text-faint);
`;

const CareerStrip = styled.div`
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 8px;
  margin-top: 12px;
  padding-top: 8px;
  border-top: 1px solid var(--color-surface-raised);
`;

const CareerCell = styled.div`
  display: flex;
  flex-direction: column;
  align-items: flex-start;
`;

const CareerLabel = styled.span`
  font-size: 10px;
  letter-spacing: 0.12em;
  color: var(--color-text-faint);
`;

const CareerValue = styled.span`
  font-size: 13px;
  font-weight: 600;
  color: var(--color-text-primary);
`;

// ── Registration ──────────────────────────────────────────────────────────────

registerComponent<ScienceBenchConfig>({
  id: "science-bench",
  name: "Science Bench",
  description:
    "Science officer station — current body / situation / biome with a NEW flash on transition, live readings from temp/pres/grav/acc sensors, an experiment-data inventory, and a career-mode strip for funds / reputation / science points.",
  tags: ["telemetry", "science"],
  defaultSize: { w: 8, h: 10 },
  minSize: { w: 4, h: 4 },
  component: ScienceBenchComponent,
  dataRequirements: [
    "v.body",
    "v.situationString",
    "v.landedAt",
    "v.biome",
    "s.sensor.temp",
    "s.sensor.pres",
    "s.sensor.grav",
    "s.sensor.acc",
    "sci.count",
    "sci.dataAmount",
    "sci.experiments",
    "sci.experimentBreakdown",
    "career.mode",
    "career.science",
    "career.funds",
    "career.reputation",
  ],
  defaultConfig: {},
  actions: [],
  pushable: true,
});

export { ScienceBenchComponent };
