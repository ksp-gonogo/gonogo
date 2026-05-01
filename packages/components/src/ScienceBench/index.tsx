import type { ComponentProps } from "@gonogo/core";
import { registerComponent, useDataValue } from "@gonogo/core";
import { Panel, PanelSubtitle, PanelTitle } from "@gonogo/ui";
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
 * entries OR plain object maps OR a single number, and falls back to a
 * raw-string render so an unfamiliar shape is still visible to the operator.
 */
interface SensorReading {
  partName: string;
  value: number;
}

export function parseSensorReadings(
  raw: unknown,
): SensorReading[] | string | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === "number" && Number.isFinite(raw)) {
    return [{ partName: "Sensor", value: raw }];
  }
  if (Array.isArray(raw)) {
    const out: SensorReading[] = [];
    for (const entry of raw) {
      const parsed = readingFromObject(entry);
      if (parsed) out.push(parsed);
    }
    return out.length > 0 ? out : asRawString(raw);
  }
  if (typeof raw === "object") {
    const out: SensorReading[] = [];
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
      if (typeof v === "number" && Number.isFinite(v)) {
        out.push({ partName: k, value: v });
      }
    }
    return out.length > 0 ? out : asRawString(raw);
  }
  return asRawString(raw);
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

function asRawString(raw: unknown): string {
  try {
    const s = JSON.stringify(raw);
    return s.length > 80 ? `${s.slice(0, 77)}…` : s;
  } catch {
    return "[unreadable]";
  }
}

interface ParsedExperiment {
  subject: string;
  data: number | null;
}

/**
 * `sci.experiments` is "Experiments with data (object)". Try a few common
 * shapes — array of `{ subject, data }`, object keyed by subject — and fall
 * back to count-only display if the shape is unfamiliar.
 */
export function parseExperiments(raw: unknown): ParsedExperiment[] | null {
  if (raw === null || raw === undefined) return null;
  if (Array.isArray(raw)) {
    const out: ParsedExperiment[] = [];
    for (const entry of raw) {
      if (entry && typeof entry === "object") {
        const e = entry as Record<string, unknown>;
        const subject =
          typeof e.subject === "string"
            ? e.subject
            : typeof e.title === "string"
              ? e.title
              : typeof e.id === "string"
                ? e.id
                : "(unnamed)";
        const data = typeof e.data === "number" ? e.data : null;
        out.push({ subject, data });
      }
    }
    return out;
  }
  if (typeof raw === "object") {
    const out: ParsedExperiment[] = [];
    for (const [subject, value] of Object.entries(
      raw as Record<string, unknown>,
    )) {
      const data =
        typeof value === "number"
          ? value
          : value &&
              typeof value === "object" &&
              "data" in (value as object) &&
              typeof (value as { data: unknown }).data === "number"
            ? (value as { data: number }).data
            : null;
      out.push({ subject, data });
    }
    return out;
  }
  return null;
}

const SITUATION_BADGE_MS = 10_000;
const SITUATION_DEBOUNCE_MS = 2_000;

function ScienceBenchComponent(
  _: Readonly<ComponentProps<ScienceBenchConfig>>,
) {
  const body = useDataValue("data", "v.body");
  const situation = useDataValue("data", "v.situationString") as
    | string
    | undefined;
  const landedAt = useDataValue("data", "v.landedAt") as string | undefined;

  const tempRaw = useDataValue("data", "s.sensor.temp");
  const presRaw = useDataValue("data", "s.sensor.pres");
  const gravRaw = useDataValue("data", "s.sensor.grav");
  const accRaw = useDataValue("data", "s.sensor.acc");

  const sciCount = useDataValue("data", "sci.count");
  const sciDataAmount = useDataValue("data", "sci.dataAmount");
  const sciExperimentsRaw = useDataValue("data", "sci.experiments");

  const careerMode = useDataValue("data", "career.mode") as string | undefined;
  const careerScience = useDataValue("data", "career.science");
  const careerFunds = useDataValue("data", "career.funds");
  const careerRep = useDataValue("data", "career.reputation");

  // Composite "where am I doing science" key — body / situation / biome.
  // Debounced to suppress momentary biome flickers during low passes; the
  // NEW badge only lights on a settled change.
  const situationKey = `${body ?? ""}|${situation ?? ""}|${landedAt ?? ""}`;
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
  const showCareer =
    typeof careerMode === "string" && careerMode.toUpperCase() !== "SANDBOX";

  return (
    <Panel>
      <PanelTitle>SCIENCE</PanelTitle>
      <SituationLine
        role="status"
        aria-live="polite"
        aria-label="Current situation for science"
      >
        <SituationText>
          {body && situation
            ? `${situation}${landedAt ? ` — ${landedAt}` : ""}`
            : "Awaiting situation telemetry"}
        </SituationText>
        {showNew && <NewBadge>NEW</NewBadge>}
      </SituationLine>

      <Section>
        <SectionTitle>Sensors</SectionTitle>
        <SensorList>
          {sensors.map(([type, raw]) => (
            <SensorRow key={type} type={type} raw={raw} />
          ))}
        </SensorList>
      </Section>

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
        <ExperimentList experiments={experiments} sciCount={sciCount} />
      </Section>

      {showCareer && (
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

function renderSensorValues(
  parsed: SensorReading[] | string | null,
  type: SensorType,
): React.ReactNode {
  if (parsed === null) return <SensorMuted>—</SensorMuted>;
  if (typeof parsed === "string") return <SensorMuted>{parsed}</SensorMuted>;
  if (parsed.length === 0) return <SensorMuted>no parts</SensorMuted>;
  // Two readings can share a partName (e.g. duplicate sensor parts). Pair
  // the name with the value to keep keys stable across renders without
  // resorting to the array index.
  return parsed.map((reading) => (
    <SensorReadingChip key={`${reading.partName}:${reading.value}`}>
      <ChipPart>{reading.partName}</ChipPart>
      <ChipValue>
        {reading.value.toFixed(2)} {SENSOR_UNITS[type]}
      </ChipValue>
    </SensorReadingChip>
  ));
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
        <ExperimentRow key={e.subject}>
          <ExpSubject>{e.subject}</ExpSubject>
          <ExpData>
            {e.data === null ? "—" : `${e.data.toFixed(1)} mits`}
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

const Section = styled.div`
  margin-top: 10px;
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
  minSize: { w: 5, h: 5 },
  component: ScienceBenchComponent,
  dataRequirements: [
    "v.body",
    "v.situationString",
    "v.landedAt",
    "s.sensor.temp",
    "s.sensor.pres",
    "s.sensor.grav",
    "s.sensor.acc",
    "sci.count",
    "sci.dataAmount",
    "sci.experiments",
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
