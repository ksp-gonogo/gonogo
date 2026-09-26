import type {
  ActionDefinition,
  ComponentProps,
  ConfigComponentProps,
} from "@ksp-gonogo/core";
import {
  getWidgetShape,
  registerComponent,
  useActionInput,
  useTelemetry,
} from "@ksp-gonogo/core";
import { useDataSeries, usePartsLive, useTopology } from "@ksp-gonogo/data";
import { readingOf, type TopicReading } from "@ksp-gonogo/sitrep-client";
import { value } from "@ksp-gonogo/sitrep-sdk";
import { Sparkline, VisuallyHidden } from "@ksp-gonogo/ui";
import {
  Badge,
  ConfigForm,
  Field,
  FieldHint,
  FieldLabel,
  formatStreamStatus,
  NULL_DISPLAY,
  Panel,
  RowName,
  ScrollArea,
  Section,
  SectionTitle,
  Select,
  severityFromStreamStatus,
  speakQuantity,
  Text,
  Unit,
  useModalSaveBar,
  WidgetScopeProvider,
  WidgetSections,
} from "@ksp-gonogo/ui-kit";
import type { CSSProperties } from "react";
import { useEffect, useMemo, useState } from "react";
// SectionsScroll styles ScrollArea's inner element, which no prop reaches; PowerRow is a passive row :hover.
// biome-ignore lint/style/noRestrictedImports: ScrollArea-internals selector + passive row :hover, no inline/primitive equivalent (see above)
import styled from "styled-components";
import { heldGrade } from "../shared/heldGrade";
import { magnitudeOf } from "../shared/magnitude";

/** Sparkline window in seconds, long enough to show a sun-to-shadow EC drain. */
const SPARKLINE_WINDOW_SEC = 120;

interface PowerSystemsConfig {
  /** Resource to focus on, ElectricCharge by default. */
  defaultResource?: string;
}

const powerSystemsActions = [
  {
    id: "cycleResource",
    label: "Next resource",
    accepts: ["button"],
    description: "Cycle through resources that have live flow contributions.",
  },
] as const satisfies readonly ActionDefinition[];
type PowerSystemsActions = typeof powerSystemsActions;

interface Contribution {
  flightId: number;
  partTitle: string;
  /** Zero when nothing was reported; read `flowKnown` before believing it. */
  flow: number;
  /** Whether `flow` is a measurement: a part can be listed on its `nominalFlow` alone, and an unmeasured panel is not a panel in shadow. */
  flowKnown: boolean;
  nominalFlow?: number;
}

/** What this widget is currently looking at, published for every augment bound to its slots. Read with `useWidgetScope("power-systems")`. */
export interface PowerSystemsScope {
  /** The resource the operator has focused, so an augment need not assume ElectricCharge. */
  resource: string;
}

declare module "@ksp-gonogo/core" {
  interface SlotRegistry {
    // Mounted by `Panel`'s universal `sections` segment; declared so a binder types against the propless contract.
    "power-systems.sections": Record<string, never>;
  }

  interface WidgetScopeRegistry {
    "power-systems": PowerSystemsScope;
  }
}

function PowerSystemsComponent({
  config,
  w,
  h,
}: Readonly<ComponentProps<PowerSystemsConfig>>) {
  const topology = useTopology();
  const flightIds = useMemo(
    () => topology?.parts.map((p) => p.flightId) ?? [],
    [topology],
  );
  const liveByFlightId = usePartsLive(flightIds);

  /**
   * `parts.power.totalProductionEc` never feeds PROD/NET, which always sum the itemised rows; it is shown apart, as MEASURED, only when it disagrees.
   *
   * A held figure is withheld, since it would manufacture a disagreement out of two readings taken at different times.
   */
  const powerReading = useTelemetry("parts.power");
  const streamPower =
    powerReading.state === "observed" ? powerReading.value : undefined;
  /**
   * Every figure drawn comes off the one `vessel.parts` read, so its currency is marked once on the totals row, in the body because the header aside holds the resource picker.
   *
   * Held rates and levels are kept: a blank cell would read as a vessel with no load.
   */
  const partsReading = useTelemetry("vessel.parts");
  const partsHeld = heldGrade(partsReading);

  const defaultResource = config?.defaultResource ?? "ElectricCharge";
  const [resource, setResource] = useState(defaultResource);
  // An explicit pick is sticky through a transient flow dropout; only a never-picked default auto-jumps.
  const [userPicked, setUserPicked] = useState(false);
  useEffect(() => {
    setResource(defaultResource);
    setUserPicked(false);
  }, [defaultResource]);

  const resourcesWithFlow = useMemo(() => {
    const set = new Set<string>();
    for (const slice of liveByFlightId.values()) {
      if (!slice.resources) continue;
      for (const [name, row] of Object.entries(slice.resources)) {
        if (typeof row.flow === "number") set.add(name);
      }
    }
    return Array.from(set).sort();
  }, [liveByFlightId]);

  useEffect(() => {
    if (userPicked) return;
    if (resourcesWithFlow.length === 0) return;
    if (!resourcesWithFlow.includes(resource)) {
      setResource(resourcesWithFlow[0]);
    }
  }, [resourcesWithFlow, resource, userPicked]);

  // The current pick stays in the options even when its flow has vanished, so the select keeps showing it.
  const pickerResources = useMemo(
    () =>
      resourcesWithFlow.includes(resource)
        ? resourcesWithFlow
        : [...resourcesWithFlow, resource].sort(),
    [resourcesWithFlow, resource],
  );

  useActionInput<PowerSystemsActions>({
    cycleResource: (payload) => {
      if (payload.kind === "button" && payload.value !== true) return undefined;
      if (resourcesWithFlow.length === 0) return undefined;
      const idx = resourcesWithFlow.indexOf(resource);
      const next = resourcesWithFlow[(idx + 1) % resourcesWithFlow.length];
      setResource(next);
      setUserPicked(true);
      return { resource: next };
    },
  });

  const scope = useMemo<PowerSystemsScope>(() => ({ resource }), [resource]);

  // A zero-flow part with a nominalFlow is an idle deployable and is listed; storage-only parts are not.
  const contributions = useMemo<Contribution[]>(() => {
    const out: Contribution[] = [];
    if (!topology) return out;
    for (const part of topology.parts) {
      const slice = liveByFlightId.get(part.flightId);
      const row = slice?.resources?.[resource];
      if (!row) continue;
      const hasFlow = typeof row.flow === "number" && row.flow !== 0;
      const hasNominal =
        typeof row.nominalFlow === "number" && row.nominalFlow !== 0;
      if (!hasFlow && !hasNominal) continue;
      out.push({
        flightId: part.flightId,
        partTitle: part.title ?? part.name,
        flow: row.flow ?? 0,
        flowKnown: typeof row.flow === "number",
        nominalFlow: row.nominalFlow,
      });
    }
    return out;
  }, [topology, liveByFlightId, resource]);

  const producers = useMemo(
    () =>
      contributions.filter((c) => c.flow > 0).sort((a, b) => b.flow - a.flow),
    [contributions],
  );
  const consumers = useMemo(
    () =>
      contributions.filter((c) => c.flow < 0).sort((a, b) => a.flow - b.flow),
    [contributions],
  );
  const idle = useMemo(
    () =>
      contributions
        .filter(
          (c) =>
            c.flow === 0 &&
            typeof c.nominalFlow === "number" &&
            c.nominalFlow !== 0,
        )
        .sort(
          (a, b) => Math.abs(b.nominalFlow ?? 0) - Math.abs(a.nominalFlow ?? 0),
        ),
    [contributions],
  );
  const totalProduced = producers.reduce((s, c) => s + c.flow, 0);
  const totalConsumed = consumers.reduce((s, c) => s + c.flow, 0);
  const net = totalProduced + totalConsumed;

  const measuredTotalProduced =
    resource === "ElectricCharge"
      ? (magnitudeOf(streamPower?.totalProductionEc) ?? undefined)
      : undefined;
  const measuredDisagrees =
    measuredTotalProduced !== undefined &&
    Math.abs(measuredTotalProduced - totalProduced) > 0.01;

  const storage = useMemo(() => {
    let amt = 0;
    let max = 0;
    for (const slice of liveByFlightId.values()) {
      const row = slice.resources?.[resource];
      if (!row) continue;
      amt += row.amount;
      max += row.maxAmount;
    }
    return { amount: amt, maxAmount: max };
  }, [liveByFlightId, resource]);

  const seriesKey = `vessel.resources.resources.${resource}.current`;
  const series = useDataSeries("data", seriesKey, SPARKLINE_WINDOW_SEC);
  const sparkValues = useMemo(
    () =>
      series.v.filter(
        (v): v is number => typeof v === "number" && Number.isFinite(v),
      ),
    [series.v],
  );
  // Anchored to capacity so a half-full battery reads as half-full.
  const sparkDomain = useMemo<[number, number] | undefined>(
    () => (storage.maxAmount > 0 ? [0, storage.maxAmount] : undefined),
    [storage.maxAmount],
  );

  const cols = w ?? 8;
  const rows = h ?? 10;
  // A landscape box is too short for the height gate, so it lays the sections side by side instead of going compact.
  const { shape } = getWidgetShape(w, h);
  const isLandscape = shape === "landscape";
  const showFullList = cols >= 6 && (rows >= 8 || isLandscape);
  const showHeader = rows >= 4;

  if (!topology) {
    return (
      <Panel
        panelTitle="POWER SYSTEMS"
        compactTitle={["POWER"]}
        sections={
          <Section full>
            <div style={HINT}>Waiting for vessel topology...</div>
          </Section>
        }
      />
    );
  }

  if (resourcesWithFlow.length === 0) {
    return (
      <Panel
        panelTitle="POWER SYSTEMS"
        compactTitle={["POWER"]}
        sections={
          <Section full>
            {showHeader && (
              <div style={SECTION_EMPTY} role="status">
                No active flow on any resource
              </div>
            )}
            <div style={HINT}>
              Deploy a solar panel, run a generator, or fire an engine to see
              flow contributions here.
            </div>
          </Section>
        }
      />
    );
  }

  const netTone: "go" | "warn" | "neutral" =
    net > 1e-6 ? "go" : net < -1e-6 ? "warn" : "neutral";

  if (!showFullList) {
    return (
      <Panel
        panelTitle="POWER"
        fitToSize
        sections={
          <Section gap="related-dense" style={COMPACT_BODY}>
            <div style={COMPACT_RESOURCE}>{splitCamel(resource)}</div>
            <Text
              tone={
                netTone === "go"
                  ? "go"
                  : netTone === "warn"
                    ? "warn"
                    : "default"
              }
              style={COMPACT_NET}
            >
              {net >= 0 ? "+" : ""}
              {net.toFixed(2)}/s
            </Text>
          </Section>
        }
      />
    );
  }

  return (
    <WidgetScopeProvider widget="power-systems" scope={scope}>
      <Panel
        panelTitle="POWER SYSTEMS"
        compactTitle={["POWER"]}
        panelSections={false}
        panelAside={
          <Select
            style={RESOURCE_SELECT}
            value={resource}
            onChange={(e) => {
              setResource(e.target.value);
              setUserPicked(true);
            }}
            aria-label="Resource"
          >
            {pickerResources.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </Select>
        }
        sections={[
          <Section key="summary" full>
            {/* Announces the state word only, so the ticking NET value does not flood a screen reader. */}
            <VisuallyHidden role="status" aria-live="polite">
              {netTone === "go"
                ? "Power surplus"
                : netTone === "warn"
                  ? "Power deficit"
                  : "Power balanced"}
            </VisuallyHidden>

            {contributions.length === 0 && (
              <div style={SECTION_EMPTY} role="status">
                No active {splitCamel(resource)} flow right now.
              </div>
            )}

            <div style={TOTALS}>
              <div style={{ ...TOTALS_CELL, ...netCellStyle(netTone) }}>
                <span style={{ ...CELL_LABEL, color: cellLabelColor(netTone) }}>
                  NET
                </span>
                <Text size="sm" style={CELL_VALUE}>
                  {net >= 0 ? "+" : ""}
                  {net.toFixed(2)}/s
                </Text>
              </div>
              <div style={TOTALS_CELL}>
                <span style={CELL_LABEL}>PROD</span>
                <Text tone="go" size="sm" style={CELL_VALUE}>
                  {totalProduced > 0 ? "+" : ""}
                  {totalProduced.toFixed(2)}
                </Text>
              </div>
              {measuredDisagrees && (
                <div
                  style={{ ...TOTALS_CELL, ...MEASURED_CELL }}
                  title={`parts.power.totalProductionEc reports ${measuredTotalProduced?.toFixed(2)}, disagreeing with the ${totalProduced.toFixed(2)} the itemized Producers rows sum to. PROD/NET always reflect the itemized rows; this is the separate raw measurement.`}
                >
                  <span style={CELL_LABEL}>MEASURED</span>
                  <Text size="sm" style={CELL_VALUE}>
                    {measuredTotalProduced?.toFixed(2)}
                  </Text>
                </div>
              )}
              <div style={TOTALS_CELL}>
                <span style={CELL_LABEL}>CONS</span>
                <Text tone="warn" size="sm" style={CELL_VALUE}>
                  {totalConsumed.toFixed(2)}
                </Text>
              </div>
              {partsHeld !== undefined && (
                <div style={TOTALS_CELL}>
                  <span style={CELL_LABEL}>READ</span>
                  <Badge severity={severityFromStreamStatus(partsHeld)}>
                    {formatStreamStatus(partsHeld)}
                  </Badge>
                </div>
              )}
              {storage.maxAmount > 0 && (
                <div style={TOTALS_CELL}>
                  <span style={CELL_LABEL}>STORED</span>
                  <Text size="sm" style={STORED_VALUE}>
                    {formatUnits(storage.amount)} /{" "}
                    {formatUnits(storage.maxAmount)}
                  </Text>
                </div>
              )}
            </div>

            {storage.maxAmount > 0 && sparkValues.length >= 2 && (
              <div
                style={SPARKLINE_ROW}
                role="img"
                aria-label={`${splitCamel(resource)} level over the last ${speakQuantity(
                  value("s", SPARKLINE_WINDOW_SEC),
                )}`}
              >
                <span style={SPARKLINE_LABEL}>
                  Trend
                  <span style={SPARKLINE_SUB}>
                    · <Unit value={value("s", SPARKLINE_WINDOW_SEC)} />
                  </span>
                </span>
                <div style={SPARKLINE_SLOT}>
                  <Sparkline
                    values={sparkValues}
                    width={240}
                    height={36}
                    color={
                      netTone === "warn"
                        ? "var(--color-status-warning-bg)"
                        : netTone === "go"
                          ? "var(--color-status-go-fg)"
                          : "var(--color-text-primary)"
                    }
                    yDomain={sparkDomain}
                    ariaLabel={`${splitCamel(resource)} level trend`}
                  />
                </div>
              </div>
            )}
          </Section>,
          <Section key="breakdown" fill>
            <SectionsScroll $landscape={isLandscape}>
              <Section
                as="section"
                style={isLandscape ? PANEL_SECTION_LANDSCAPE : undefined}
              >
                <SectionTitle as="h3">
                  Producers
                  {producers.length > 0 && (
                    <span style={SECTION_COUNT}>· {producers.length}</span>
                  )}
                </SectionTitle>
                {producers.length === 0 ? (
                  <div style={SECTION_EMPTY}>Nothing producing.</div>
                ) : (
                  <div style={CONTRIB_LIST}>
                    {producers.map((c) => (
                      <ContributionRow
                        key={c.flightId}
                        contribution={c}
                        currency={partsReading}
                      />
                    ))}
                  </div>
                )}
              </Section>
              <Section
                as="section"
                style={isLandscape ? PANEL_SECTION_LANDSCAPE : undefined}
              >
                <SectionTitle as="h3">
                  Consumers
                  {consumers.length > 0 && (
                    <span style={SECTION_COUNT}>· {consumers.length}</span>
                  )}
                </SectionTitle>
                {consumers.length === 0 ? (
                  <div style={SECTION_EMPTY}>Nothing consuming.</div>
                ) : (
                  <div style={CONTRIB_LIST}>
                    {consumers.map((c) => (
                      <ContributionRow
                        key={c.flightId}
                        contribution={c}
                        currency={partsReading}
                      />
                    ))}
                  </div>
                )}
              </Section>
              {idle.length > 0 && (
                <Section
                  as="section"
                  style={isLandscape ? PANEL_SECTION_LANDSCAPE : undefined}
                >
                  <SectionTitle as="h3">
                    Idle
                    <span style={SECTION_COUNT}>· {idle.length}</span>
                  </SectionTitle>
                  <div style={IDLE_LIST}>
                    {idle.map((c) => (
                      <ContributionRow
                        key={c.flightId}
                        contribution={c}
                        currency={partsReading}
                      />
                    ))}
                  </div>
                </Section>
              )}
              {/* Augment sections mount inside the breakdown's scroller, not at Panel's default end-of-body seam. */}
              <WidgetSections />
            </SectionsScroll>
          </Section>,
        ]}
      />
    </WidgetScopeProvider>
  );
}

function ContributionRow({
  contribution,
  currency,
}: {
  contribution: Contribution;
  /** The `vessel.parts` read this row's numbers came off. */
  currency: TopicReading<unknown>;
}) {
  const { partTitle, flow, flowKnown, nominalFlow } = contribution;
  // A zero flow is neutral, not green: a shadowed panel is idle, not producing.
  const sign: "pos" | "neg" | "zero" =
    Math.abs(flow) < 1e-9 ? "zero" : flow > 0 ? "pos" : "neg";
  // No efficiency without a measured flow.
  const eff =
    flowKnown && typeof nominalFlow === "number" && Math.abs(nominalFlow) > 1e-9
      ? Math.abs(flow / nominalFlow)
      : null;
  return (
    <PowerRow>
      <RowName>{partTitle}</RowName>
      {eff !== null && (
        <span
          style={ROW_EFF}
          title={`${speakQuantity(value("%", eff * 100), { decimals: 0 })} of nominal`}
        >
          <Unit
            value={readingOf(currency, () => value("%", eff * 100))}
            decimals={0}
          />
        </span>
      )}
      <Text
        tone={sign === "pos" ? "go" : sign === "neg" ? "warn" : "faint"}
        title={flowKnown ? undefined : "No flow reading for this part"}
      >
        {flowKnown
          ? `${sign === "pos" ? "+" : ""}${flow.toFixed(2)}`
          : NULL_DISPLAY}
      </Text>
    </PowerRow>
  );
}

/** Spaces a camelCase resource id so its word breaks survive the uppercase transform. */
function splitCamel(s: string): string {
  return s.replace(/([a-z])([A-Z])/g, "$1 $2");
}

function formatUnits(v: number): string {
  if (!Number.isFinite(v)) return NULL_DISPLAY;
  if (Math.abs(v) >= 10_000) return `${(v / 1000).toFixed(1)}k`;
  if (Math.abs(v) >= 100) return v.toFixed(0);
  return v.toFixed(1);
}

function PowerSystemsConfigComponent({
  config,
  onSave,
}: Readonly<ConfigComponentProps<PowerSystemsConfig>>) {
  const [defaultResource, setDefaultResource] = useState(
    config?.defaultResource ?? "ElectricCharge",
  );

  const candidate = useMemo<PowerSystemsConfig>(
    () => ({ defaultResource: defaultResource.trim() || "ElectricCharge" }),
    [defaultResource],
  );

  useModalSaveBar({
    onSave: () => onSave(candidate),
    value: candidate,
    saved: config ?? {},
  });

  return (
    <ConfigForm>
      <Field>
        <FieldLabel htmlFor="ps-default-resource">Default resource</FieldLabel>
        <input
          id="ps-default-resource"
          type="text"
          value={defaultResource}
          onChange={(e) => setDefaultResource(e.target.value)}
        />
        <FieldHint>
          Resource the widget focuses on by default. The picker still lets you
          switch at runtime; this just sets the starting point.
        </FieldHint>
      </Field>
    </ConfigForm>
  );
}

const RESOURCE_SELECT: CSSProperties = {
  maxWidth: "50%",
  fontSize: "var(--font-size-value)",
  padding: "var(--inset-control)",
};

const TOTALS: CSSProperties = {
  display: "grid",
  // 64px fits all four cells on one row at 6x8.
  gridTemplateColumns: "repeat(auto-fit, minmax(64px, 1fr))",
  gap: "var(--gap-related)",
  marginTop: "var(--gap-related-comfortable)",
  marginBottom: "var(--gap-related-comfortable)",
};

const TOTALS_CELL: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "var(--gap-related)",
  padding: "var(--inset-surface)",
  background: "var(--color-surface-panel)",
  border: "1px solid var(--color-surface-raised)",
  borderRadius: "var(--radius-regular)",
};

function netCellStyle(tone: "go" | "warn" | "neutral"): CSSProperties {
  const bg =
    tone === "go"
      ? "var(--color-status-go-bg)"
      : tone === "warn"
        ? "var(--color-status-warning-bg-muted)"
        : "var(--color-surface-panel)";
  const border =
    tone === "go"
      ? "var(--color-status-go-bg)"
      : tone === "warn"
        ? "var(--color-status-warning-bg)"
        : "var(--color-surface-raised)";
  return { background: bg, border: `1px solid ${border}` };
}

const MEASURED_CELL: CSSProperties = {
  border: "1px dashed var(--color-status-warning-bg)",
};

// On the NET cell's tinted background text-faint fails 4.5:1, so its label takes the tone's foreground (cellLabelColor).
const CELL_LABEL: CSSProperties = {
  fontSize: "var(--font-size-caption)",
  letterSpacing: "0.12em",
  textTransform: "uppercase",
  color: "var(--color-text-faint)",
};

function cellLabelColor(tone: "go" | "warn" | "neutral"): string {
  return tone === "go"
    ? "var(--color-status-go-fg)"
    : tone === "warn"
      ? "var(--color-status-warning-fg-muted)"
      : "var(--color-text-faint)";
}

const CELL_VALUE: CSSProperties = { fontWeight: 700, whiteSpace: "nowrap" };

// An "amount / max" pair may wrap inside its narrow cell, breaking at the separator.
const STORED_VALUE: CSSProperties = {
  fontWeight: 700,
  whiteSpace: "normal",
  lineHeight: "var(--line-height-tight)",
};

const SPARKLINE_ROW: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "var(--gap-related)",
  marginBottom: "var(--gap-related-comfortable)",
  padding: "var(--inset-surface)",
  background: "var(--color-surface-panel)",
  border: "1px solid var(--color-surface-raised)",
  borderRadius: "var(--radius-regular)",
};

const SPARKLINE_LABEL: CSSProperties = {
  fontSize: "var(--font-size-caption)",
  letterSpacing: "0.12em",
  textTransform: "uppercase",
  color: "var(--color-text-faint)",
  display: "inline-flex",
  alignItems: "baseline",
  gap: "var(--gap-related)",
  flexShrink: 0,
};

const SPARKLINE_SUB: CSSProperties = { color: "var(--color-text-dim)" };

const SPARKLINE_SLOT: CSSProperties = {
  flex: 1,
  minWidth: 0,
  display: "flex",
  alignItems: "center",
};

const SectionsScroll = styled(ScrollArea)<{ $landscape?: boolean }>`
  flex: 1;
  [data-scroll-area-inner] {
    display: flex;
    /* This element stays the ScrollArea's scroller in both layouts, so nothing a short height cannot hold goes out of reach. */
    flex-direction: ${({ $landscape }) => ($landscape ? "row" : "column")};
    gap: ${({ $landscape }) => ($landscape ? "var(--gap-section-compact)" : "var(--gap-related-comfortable)")};
    ${({ $landscape }) => ($landscape ? "align-items: stretch;" : "")}
  }
`;

const PANEL_SECTION_LANDSCAPE: CSSProperties = {
  flex: "1 1 0",
  minWidth: 0,
  minHeight: 0,
};

const SECTION_COUNT: CSSProperties = {
  marginLeft: "var(--gap-trailing-figure)",
  color: "var(--color-text-muted)",
};

const SECTION_EMPTY: CSSProperties = {
  fontSize: "var(--font-size-compact)",
  color: "var(--color-text-faint)",
  padding: "var(--inset-row)",
};

const CONTRIB_LIST: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "var(--gap-line)",
};

const IDLE_LIST: CSSProperties = { ...CONTRIB_LIST, opacity: 0.55 };

const PowerRow = styled.div`
  display: grid;
  grid-template-columns: 1fr auto auto;
  gap: var(--gap-related);
  padding: var(--inset-surface);
  font-size: var(--font-size-compact);
  background: var(--color-surface-app);
  border-radius: var(--radius-regular);
  &:hover {
    background: var(--color-surface-panel);
  }
`;

const ROW_EFF: CSSProperties = {
  fontSize: "var(--font-size-compact)",
  color: "var(--color-text-faint)",
  fontVariantNumeric: "tabular-nums",
};

const HINT: CSSProperties = {
  marginTop: "var(--gap-related-compact)",
  fontSize: "var(--font-size-compact)",
  color: "var(--color-text-faint)",
  lineHeight: "var(--line-height-body)",
};

/** Text alignment for a compact resource name long enough to wrap; `Panel fitToSize` owns the centring. */
const COMPACT_BODY: CSSProperties = {
  alignItems: "center",
  textAlign: "center",
};

const COMPACT_RESOURCE: CSSProperties = {
  fontSize: "var(--font-size-caption)",
  letterSpacing: "0.08em",
  textTransform: "uppercase",
  color: "var(--color-text-faint)",
};

// A literal 16px because --font-size-lg grows to 17px on coarse pointers, which clips "+49.50/s" in a 3x3 tile.
const COMPACT_NET: CSSProperties = {
  maxWidth: "100%",
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
  fontSize: "16px",
  fontWeight: 700,
};

registerComponent<PowerSystemsConfig>({
  id: "power-systems",
  name: "Power Systems",
  description:
    "Producers vs consumers per resource. Aggregates live per-part resource flow across every part on the vessel, solar panels, RTGs, generators, ISRU, drills, engines. Default resource is ElectricCharge; the picker switches to any other resource with live flow contributions. Net rate, total produced, total consumed, plus per-part efficiency where the module exposes a nominal cap.",
  tags: ["telemetry", "ship"],
  defaultSize: { w: 8, h: 12 },
  minSize: { w: 3, h: 3 },
  component: PowerSystemsComponent,
  configComponent: PowerSystemsConfigComponent,
  openConfigOnAdd: false,
  // `vessel.resources` is declared as a whole Topic because its reservoir is keyed by resource name.
  dataRequirements: ["vessel.parts", "vessel.resources", "parts.power"],
  defaultConfig: { defaultResource: "ElectricCharge" },
  actions: powerSystemsActions,
  augmentSlots: ["power-systems.sections"],
  pushable: true,
  requires: ["flight"],
});

export { PowerSystemsComponent };
