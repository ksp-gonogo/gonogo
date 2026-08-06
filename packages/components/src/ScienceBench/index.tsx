import type { ComponentProps } from "@ksp-gonogo/core";
import {
  registerComponent,
  useGameContext,
  useTelemetry,
} from "@ksp-gonogo/core";
import { useStream, type VesselState } from "@ksp-gonogo/sitrep-client";
import { DimmedOverlay } from "@ksp-gonogo/ui";
import {
  NULL_DISPLAY,
  Panel,
  PanelSubtitle,
  ScrollArea,
  Section,
  SectionTitle,
  Value,
} from "@ksp-gonogo/ui-kit";
import type { CSSProperties } from "react";
import { useEffect, useRef, useState } from "react";
// Body below keeps styled-components: it styles ScrollArea's internal
// `[data-scroll-area-inner]` element (a child component's internals, which
// inline style can't reach and ScrollArea exposes no prop for). Documented.
// biome-ignore lint/style/noRestrictedImports: ScrollArea-internals selector, no inline/primitive equivalent (see above)
import styled from "styled-components";
import {
  magnitudeOf,
  magnitudeOr,
  type Quantityish,
} from "../shared/magnitude";

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
  // The accelerometer reads vessel.geeForce, already in gees, per KSP's own
  // ModuleEnviroSensor formatting (#autoLOC_7001413 = " g"). GRAV formats a
  // true acceleration (#autoLOC_237120 = "m/s^2") and stays as-is.
  acc: "g",
};

/** The mod's `SensorEntry.type` string (`Sitrep.Contract.SensorType` enum name, `TEMP`/`PRES`/`GRAV`/`ACC`) for each widget-facing sensor type. */
const WIRE_SENSOR_TYPE: Record<SensorType, string> = {
  temp: "TEMP",
  pres: "PRES",
  grav: "GRAV",
  acc: "ACC",
};

/**
 * Parses the `science.sensors` whole-topic read, a bare
 * `SensorEntry[]` or `null`/`undefined` while not yet loaded, into a plain
 * object array `readingFromObject`/`parseSensorReadings` can filter by
 * `type` and parse per sensor row. Returns `null` (not "no sensors") when
 * the topic hasn't resolved at all, so the per-type rows render as loading
 * instead of a false "no sensors" for every type.
 */
function parseSensorEntryList(
  raw: unknown,
): Array<Record<string, unknown>> | null {
  if (!Array.isArray(raw)) return null;
  return raw.filter(
    (e): e is Record<string, unknown> =>
      !!e && typeof e === "object" && !Array.isArray(e),
  );
}

/**
 * Telemachus's `s.sensor.<type>` is documented loosely ("Sensor data by
 * type"). Defensive parser: accepts arrays of `{ partName, value }`-shaped
 * entries OR plain object maps OR a single number OR Telemachus's parallel
 * `[names, values]` tuple, and falls back to "no sensors" when nothing
 * resolves to a real reading.
 *
 * Returns `"no sensors"` to mean "vessel has no sensor of this type", the
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
    // shape for `s.sensor.<type>`: names in slot 0, values in slot 1, by
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
      // Telemachus's empty state is the literal name "No Sensors ..." paired
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
  // `magnitudeOf` on each: this reads a sensor entry from several possible
  // wire shapes, and the first-party one declares its unit, so the value
  // arrives wrapped while the legacy shapes stay bare.
  let value =
    magnitudeOf(e.value as Quantityish) ??
    magnitudeOf(e.reading as Quantityish) ??
    magnitudeOf(e.v as Quantityish);
  if (value === null && typeof e.readout === "string") {
    // science.sensors' `readout` is KSP's own human-readable
    // sensor string (`ModuleEnviroSensor.readoutInfo`, e.g. "293.1K",
    // "Off") rather than a raw number: pull the leading numeric value out
    // of it. A non-numeric readout (an inactive/disabled sensor) has no
    // match and the entry is dropped, same as Telemachus's old
    // disabled-sensor `0` handling elsewhere in this file.
    const match = e.readout.match(/-?\d+(?:\.\d+)?/);
    value = match ? Number(match[0]) : null;
  }
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
 * - New SDK `science.experiments` (mapped onto this
 *   same widget-facing key via `map-topic.ts`): `{ partName, location,
 *   experimentId, subjectId, title, dataAmount, ... }`:
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
      dataAmount: magnitudeOf(e.dataAmount as Quantityish),
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
 * Parses `sci.experimentBreakdown`: now mapped on the wire onto
 * `science.experimentBreakdown` (`Sitrep.Host.ScienceViewProvider.
 * BuildExperimentBreakdown`), same field names as the old GonogoTelemetry
 * shape this parser was originally written against. Richer than
 * `sci.experiments`: one row per DISTINCT subject id, with biome/situation
 * parsed off the subject id server-side and the ABSOLUTE remaining science
 * potential (`scienceCap - science`). Used when present; widget falls back
 * to the plain `sci.experiments` view when it's absent (legacy Telemachus
 * with no GonogoTelemetry plugin, or a stream sample that hasn't arrived
 * yet).
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
      dataMits: magnitudeOr(e.dataMits as Quantityish, 0),
      // The sort below reads this. Left as a `Value`, every entry scored 0
      // and the list held its wire order instead of ranking by what is
      // actually worth recovering.
      remainingPotential: magnitudeOr(e.remainingPotential as Quantityish, 0),
    });
  }
  // Sort by remaining potential desc: subjects with the most science left
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
  const { inFlight, hasGameSignal, careerMode } = useGameContext();
  const dimNonCareer = hasGameSignal && !inFlight;

  const vesselState = useStream<VesselState>("vessel.state");
  const body = vesselState?.parentBodyName ?? undefined;
  const situation = vesselState?.situationName ?? undefined;
  const surface = useTelemetry("vessel.surface");
  const landedAt = surface?.landedAt;
  // Live biome from `ScienceUtil.GetExperimentBiome`: the same source the
  // game uses to attribute new experiments. Works in flight + space scenes
  // (e.g. "FlyingHigh", "Splashed - OceanWater"), unlike `v.landedAt` which
  // is only populated on the surface. Falls back to landedAt when blank.
  const liveBiome = surface?.biome;

  // The whole sensor list (`science.sensors`, SensorEntry[]) is the single
  // source for every per-type reading: filtered client-side by `type`
  // (WIRE_SENSOR_TYPE below) instead of four per-type `s.sensor.<type>` reads,
  // which have no per-type field on the new wire.
  const sensorEntriesRaw = useTelemetry("science.sensors");
  const sensorEntries = parseSensorEntryList(sensorEntriesRaw);

  const sciExperimentsRaw = useTelemetry("science.experiments");
  const sciBreakdownRaw = useTelemetry("science.experimentBreakdown");

  // career.mode reads through useGameContext rather than a raw
  // telemetry read, the stream carries it as the mod's GameMode enum
  // ORDINAL (a number), not the legacy Telemachus string, and
  // useGameContext.careerMode already resolves both shapes to the same
  // display value.
  const careerEconomy = useTelemetry("career.status")?.economy;
  const careerScience = careerEconomy?.science;
  const careerFunds = careerEconomy?.funds;
  const careerRep = careerEconomy?.reputation;

  // Composite "where am I doing science" key, body / situation / biome.
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

  const sensors: Array<[SensorType, unknown]> = SENSOR_TYPES.map((type) => [
    type,
    // null (not an empty array) while the list hasn't resolved, the parser
    // renders that as loading rather than a false "no sensors".
    sensorEntries
      ? sensorEntries.filter(
          (e) =>
            typeof e.type === "string" &&
            e.type.toUpperCase() === WIRE_SENSOR_TYPE[type],
        )
      : null,
  ]);

  const experiments = parseExperiments(sciExperimentsRaw);
  const breakdown = parseExperimentBreakdown(sciBreakdownRaw);
  // sci.count/sci.dataAmount stay gapped on the wire (no
  // pre-aggregated field): derive both client-side from the same
  // already-migrated experiments array instead of a separate read.
  const sciCount = experiments ? experiments.length : undefined;
  const sciDataAmount = experiments
    ? experiments.reduce((sum, e) => sum + (e.dataAmount ?? 0), 0)
    : undefined;
  const showCareer = careerMode !== "Unknown" && careerMode !== "SANDBOX";

  // Selective rendering: situation pill always; supplementary sections
  // drop bottom-up as height shrinks.
  const cols = w ?? 8;
  const rows = h ?? 10;
  const showSensors = rows >= 5 && cols >= 4;
  const showAboard = rows >= 7 && cols >= 4;
  const showCareerStrip = showCareer && rows >= 9;

  return (
    <Panel panelTitle="SCIENCE">
      <DimmedOverlay
        show={dimNonCareer}
        message="Sensors require flight"
        hint="Career stats below stay current."
      >
        <PanelSubtitle
          style={SITUATION_LINE}
          role="status"
          aria-live="polite"
          aria-label="Current situation for science"
        >
          <span style={SITUATION_TEXT}>
            {body && situation
              ? `${situation}${situationLocale ? `: ${situationLocale}` : ""}`
              : "Awaiting situation telemetry"}
          </span>
          {showNew && <span style={NEW_BADGE}>NEW</span>}
        </PanelSubtitle>

        <Body>
          {showSensors && (
            // Always the first child of Body when shown, so it always takes the
            // former `:first-child` top margin.
            <Section style={TITLED_GROUP_FIRST}>
              <SectionTitle>Sensors</SectionTitle>
              <div style={SENSOR_LIST}>
                {sensors.map(([type, raw]) => (
                  <SensorRow key={type} type={type} raw={raw} />
                ))}
              </div>
            </Section>
          )}

          {showAboard && (
            // First child only when Sensors is hidden; takes the former
            // `:first-child` top margin exactly then.
            <Section style={showSensors ? undefined : TITLED_GROUP_FIRST}>
              <SectionTitle>
                Aboard
                {typeof sciCount === "number" && (
                  <span style={SECTION_META}>
                    · {sciCount} record{sciCount === 1 ? "" : "s"}
                    {typeof sciDataAmount === "number" &&
                      ` · ${sciDataAmount.toFixed(1)} mits`}
                  </span>
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
        <div style={CAREER_STRIP}>
          <div style={CAREER_CELL}>
            <span style={CAREER_LABEL}>SCI</span>
            <Value tone="default" weight="semibold" size="sm">
              {formatNumber(careerScience)}
            </Value>
          </div>
          <div style={CAREER_CELL}>
            <span style={CAREER_LABEL}>FUNDS</span>
            <Value tone="default" weight="semibold" size="sm">
              {formatNumber(careerFunds)}
            </Value>
          </div>
          <div style={CAREER_CELL}>
            <span style={CAREER_LABEL}>REP</span>
            <Value tone="default" weight="semibold" size="sm">
              {formatNumber(careerRep)}
            </Value>
          </div>
        </div>
      )}
    </Panel>
  );
}

// ── Subcomponents ─────────────────────────────────────────────────────────────

function SensorRow({ type, raw }: { type: SensorType; raw: unknown }) {
  const parsed = parseSensorReadings(raw);
  return (
    <div style={SENSOR_ROW_WRAP}>
      <div style={SENSOR_LABEL}>{SENSOR_LABELS[type]}</div>
      <div style={SENSOR_VALUES}>{renderSensorValues(parsed, type)}</div>
    </div>
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
 * raw count is unreliable, we just average the readings within a part
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
  if (parsed === null) return <span style={SENSOR_MUTED}>{NULL_DISPLAY}</span>;
  if (parsed === "no sensors")
    return <span style={SENSOR_MUTED}>None installed</span>;
  if (parsed.length === 0)
    return <span style={SENSOR_MUTED}>None installed</span>;
  return aggregateByPart(parsed).map((agg) => (
    <span key={agg.partName} style={SENSOR_READING_CHIP}>
      <span style={CHIP_PART}>{agg.partName}</span>
      <Value tone="default" weight="semibold">
        {agg.value.toFixed(2)} {SENSOR_UNITS[type]}
      </Value>
    </span>
  ));
}

function BreakdownList({
  breakdown,
}: {
  breakdown: ExperimentBreakdownEntry[];
}) {
  return (
    <ul style={EXPERIMENT_LIST_WRAP}>
      {breakdown.map((b) => (
        <li key={b.subjectId} style={EXPERIMENT_ROW}>
          <span style={EXP_SUBJECT}>
            {b.expTitle}
            {b.biome ? (
              <span style={BREAKDOWN_CONTEXT}> · {b.biome}</span>
            ) : null}
          </span>
          <Value tone="accent">
            {b.dataMits.toFixed(1)} mits
            {b.remainingPotential > 0 ? (
              <span style={BREAKDOWN_POTENTIAL}>
                {" "}
                · {b.remainingPotential.toFixed(1)} left
              </span>
            ) : null}
          </Value>
        </li>
      ))}
    </ul>
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
    return <div style={MUTED}>No science data aboard.</div>;
  }
  if (experiments === null) {
    return (
      <div style={MUTED}>
        {sciCount === 0
          ? "No experiments aboard."
          : `${String(sciCount)} record(s): details unavailable.`}
      </div>
    );
  }
  if (experiments.length === 0)
    return <div style={MUTED}>No experiments aboard.</div>;
  return (
    <ul style={EXPERIMENT_LIST_WRAP}>
      {experiments.map((e) => (
        <li key={e.subjectId} style={EXPERIMENT_ROW}>
          <span style={EXP_SUBJECT}>{e.title}</span>
          <Value tone="accent">
            {e.dataAmount === null
              ? NULL_DISPLAY
              : `${e.dataAmount.toFixed(1)} mits`}
          </Value>
        </li>
      ))}
    </ul>
  );
}

function formatNumber(value: unknown): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return NULL_DISPLAY;
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

// Structural inline styles (CSS-var tokens): a bespoke science station board,
// no reusable ui-kit primitive fits the layout, so it stays local. Toned/
// weighted numeric readouts render through ui-kit `Value`; the one kit piece it
// reuses (PanelSubtitle) takes only this widget's flex layout inline. Body keeps
// styled-components (see the import's biome-ignore).

// Subtitle typography, but a body element: the situation line lives inside the
// DimmedOverlay with the sensors it describes, so it dims with them rather than
// sitting in the pinned header. It therefore drops the horizontal inset
// PanelSubtitle carries as a header part, since Panel.Body already pays it.
const SITUATION_LINE: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "var(--space-8)",
  padding: 0,
};

const SITUATION_TEXT: CSSProperties = {
  flex: 1,
  minWidth: 0,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
};

// A filled "NEW" badge (go-bg background, go-fg text): stays on -bg tokens
// (it's a fill), so not a Value.
const NEW_BADGE: CSSProperties = {
  fontSize: "var(--font-size-2xs)",
  fontWeight: 700,
  letterSpacing: "0.1em",
  padding: "var(--space-hair) var(--space-6)",
  borderRadius: "var(--radius-xs)",
  background: "var(--color-status-go-bg)",
  color: "var(--color-status-go-fg)",
};

const Body = styled(ScrollArea)`
  flex: 1;
  min-height: 0;

  [data-scroll-area-inner] {
    display: flex;
    flex-direction: column;
    gap: var(--space-10);
  }
`;

// The former `TitledGroup` was only a `:first-child` top-spacing shim wrapping a
// SectionTitle + list. It becomes the kit's Section; the first-child margin is
// applied inline at the call site (Sensors is always first when shown; Aboard
// takes it only when Sensors is hidden).
const TITLED_GROUP_FIRST: CSSProperties = { marginTop: "var(--space-4)" };

const SECTION_META: CSSProperties = {
  color: "var(--color-text-faint)",
  marginLeft: "var(--space-4)",
  fontWeight: 400,
  letterSpacing: "0.04em",
};

const SENSOR_LIST: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "var(--space-4)",
};

const SENSOR_ROW_WRAP: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "90px 1fr",
  gap: "var(--space-6)",
  alignItems: "baseline",
};

const SENSOR_LABEL: CSSProperties = {
  // Off the type scale: this fills the fixed 90px track of SENSOR_ROW_WRAP's
  // grid with no overflow or ellipsis to fall back on, and --font-size-xs is
  // 12px on a coarse pointer.
  fontSize: "11px",
  color: "var(--color-text-muted)",
};

const SENSOR_VALUES: CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  gap: "var(--space-4)",
};

const SENSOR_MUTED: CSSProperties = {
  fontSize: "var(--font-size-xs)",
  color: "var(--color-text-faint)",
};

const SENSOR_READING_CHIP: CSSProperties = {
  display: "inline-flex",
  alignItems: "baseline",
  gap: "var(--space-4)",
  padding: "var(--space-hair) var(--space-6)",
  background: "var(--color-surface-panel)",
  borderRadius: "var(--radius-xs)",
  fontSize: "var(--font-size-xs)",
};

const CHIP_PART: CSSProperties = { color: "var(--color-text-faint)" };

const EXPERIMENT_LIST_WRAP: CSSProperties = {
  listStyle: "none",
  margin: 0,
  padding: 0,
  display: "flex",
  flexDirection: "column",
  gap: "var(--space-2)",
};

const EXPERIMENT_ROW: CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  gap: "var(--space-8)",
  fontSize: "var(--font-size-xs)",
};

const EXP_SUBJECT: CSSProperties = {
  color: "var(--color-text-primary)",
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
  flex: 1,
  minWidth: 0,
};

const BREAKDOWN_CONTEXT: CSSProperties = {
  color: "var(--color-text-faint)",
  fontWeight: 400,
};

const BREAKDOWN_POTENTIAL: CSSProperties = {
  color: "var(--color-text-muted)",
};

const MUTED: CSSProperties = {
  fontSize: "var(--font-size-xs)",
  color: "var(--color-text-faint)",
};

const CAREER_STRIP: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(3, 1fr)",
  gap: "var(--space-8)",
  marginTop: "var(--space-12)",
  paddingTop: "var(--space-8)",
  borderTop: "1px solid var(--color-surface-raised)",
};

const CAREER_CELL: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  alignItems: "flex-start",
};

const CAREER_LABEL: CSSProperties = {
  fontSize: "var(--font-size-2xs)",
  letterSpacing: "0.12em",
  color: "var(--color-text-faint)",
};

// ── Registration ──────────────────────────────────────────────────────────────

registerComponent<ScienceBenchConfig>({
  id: "science-bench",
  name: "Science Bench",
  description:
    "Science officer station: current body / situation / biome with a NEW flash on transition, live readings from temp/pres/grav/acc sensors, an experiment-data inventory, and a career-mode strip for funds / reputation / science points.",
  tags: ["telemetry", "science"],
  defaultSize: { w: 8, h: 10 },
  minSize: { w: 4, h: 4 },
  component: ScienceBenchComponent,
  dataRequirements: [
    "v.body",
    "v.situationString",
    "v.landedAt",
    "v.biome",
    "science.sensors",
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
