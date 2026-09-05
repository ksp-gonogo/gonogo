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
import type { Reading } from "@ksp-gonogo/sitrep-client";
import { value } from "@ksp-gonogo/sitrep-sdk";
import { Sparkline, VisuallyHidden } from "@ksp-gonogo/ui";
import {
  ConfigForm,
  Field,
  FieldHint,
  FieldLabel,
  NULL_DISPLAY,
  Panel,
  RowName,
  ScrollArea,
  Section,
  SectionTitle,
  Select,
  speakQuantity,
  Text,
  Unit,
  useModalSaveBar,
  WidgetScopeProvider,
  WidgetSections,
} from "@ksp-gonogo/ui-kit";
import type { CSSProperties } from "react";
import { useEffect, useMemo, useState } from "react";
// SectionsScroll + PowerRow below keep styled-components: the first styles
// ScrollArea's internal `[data-scroll-area-inner]` element (a child component's
// internals, which inline style can't reach and ScrollArea exposes no prop
// for), the second is a passive row `:hover` highlight (no ui-kit primitive
// fits a non-selectable hover row; a JS per-row hover would add state + a
// re-render per mouse-move to a potentially long list). Both documented.
// biome-ignore lint/style/noRestrictedImports: ScrollArea-internals selector + passive row :hover, no inline/primitive equivalent (see above)
import styled from "styled-components";
import { magnitudeOf } from "../shared/magnitude";

/**
 * Sparkline window in seconds. Two minutes is enough to see a real
 * EC drain trend on a typical probe (sun-side → shadow transitions
 * land inside this window) without becoming a graph widget in
 * disguise.
 */
const SPARKLINE_WINDOW_SEC = 120;

interface PowerSystemsConfig {
  /**
   * Resource to focus on. Default ElectricCharge: the most common reason
   * to consult this widget. Cycling via the action input rolls through
   * whichever resources have live flow contributions.
   */
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
  /**
   * Whether `flow` is a measurement. A part can be listed on the strength of its
   * `nominalFlow` alone, and coercing its absent flow to zero made a panel
   * nobody has measured read exactly like a panel measured in shadow.
   */
  flowKnown: boolean;
  nominalFlow?: number;
}

// PowerSystems is this repo's worked example of the augment-slot pattern.
//
// `power-systems.sections`: a Table/section slot in the body, below the
// net-rate/producer-consumer readout. The canonical first filler is
// an EC-broker breakdown from a life-support backend that re-derives EC
// production and consumption itself, contributed as an augment that reads
// ONLY that Uplink's own Topics. Core never references it, the host composes
// whatever is registered.
//
// It carries the widget's current resource focus as slot props so an augment
// renders against the resource the operator is actually looking at,
// slot-parameterised augments; the parent's context passed down. No augment
// ships here yet: the slot renders nothing until one registers.

/**
 * What this widget is currently looking at, published for every augment bound
 * to any of its slots. Read with `useWidgetScope("power-systems")`.
 *
 * It was `power-systems.sections`'s slot props, which is what kept that slot
 * from being the universal `sections` segment: the resource is a SCOPE, not
 * something the section augment's own job needs handing to it, and a universal
 * segment is propless by construction.
 */
export interface PowerSystemsScope {
  /**
   * The resource the widget is currently focused on (the picker/action-cycle
   * selection). Lets an augment scope its breakdown/badge to the same resource
   * the operator is viewing rather than assuming ElectricCharge.
   */
  resource: string;
}

// Declaration-merge into core's registries, co-located here so parallel slot
// work on other widgets never collides on a shared central file.
declare module "@ksp-gonogo/core" {
  interface SlotRegistry {
    // Mounted by `Panel`'s universal `sections` segment rather than by this
    // widget. Declared so a binder types against the propless contract rather
    // than the loose fallback.
    "power-systems.sections": Record<string, never>;
  }

  interface WidgetScopeRegistry {
    "power-systems": PowerSystemsScope;
  }
}

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

  // `parts.power` mixed-source enrichment. The
  // per-part Producers/Consumers/Idle breakdown above stays entirely on
  // `useTopology`/`usePartsLive` (both bypass the mapTopic shim by design,
  // both read `vessel.parts` directly, stream-native; `usePartsLive`'s
  // `resources` join rides the SAME payload's per-part `resources` map, no
  // separate subscription).
  // `parts.power.totalProductionEc` is a SEPARATE vessel-wide
  // measurement of the same quantity the itemized rows sum to.
  //
  // It must NEVER win over the topology-summed total. Letting it do so lets
  // PROD/NET (which drives a charge/consume read the operator relies on)
  // silently contradict the itemized Producers rows right below: a PROD of
  // +42.00 over a single +5.00 row. PROD/NET therefore ALWAYS derive from the
  // itemized total (`computedTotalProduced` below), so they cannot disagree
  // with the rows. When the streamed measurement meaningfully DISAGREES with
  // that total, it's surfaced
  // separately as an explicitly-labeled "MEASURED" reading (see the
  // `Totals` cells) instead of being silently dropped OR silently winning.
  /**
   * The MEASURED cell exists to disagree with the itemised total, so a held figure
   * would manufacture a disagreement out of two readings taken at different times
   * and report it as an instrument fault. Withheld once it stops being current,
   * which is the same thing this cell already does when it never arrives.
   */
  const streamPower = judgeable(useTelemetry("parts.power"));

  const defaultResource = config?.defaultResource ?? "ElectricCharge";
  const [resource, setResource] = useState(defaultResource);
  // Tracks whether the operator has made an explicit in-widget pick this
  // session. Once they have, the pick is sticky even if that resource's flow
  // transiently vanishes (e.g. an engine cuts off), the auto-jump below only
  // fires for a never-picked default. A config-default change resets it (a
  // fresh starting point re-enables the auto-jump helper).
  const [userPicked, setUserPicked] = useState(false);
  useEffect(() => {
    setResource(defaultResource);
    setUserPicked(false);
  }, [defaultResource]);

  // Resources that have a live `flow` contribution across the vessel.
  // Drives both the picker options and the action cycle.
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

  // Auto-pick a resource with data when the operator hasn't chosen one, if
  // the (default) pick has no contributions but others do, jump to the first
  // that does. Skipped once the operator has explicitly picked, so a
  // deliberate choice survives a transient flow dropout (engine cutoff) rather
  // than being silently reset out from under them.
  useEffect(() => {
    if (userPicked) return;
    if (resourcesWithFlow.length === 0) return;
    if (!resourcesWithFlow.includes(resource)) {
      setResource(resourcesWithFlow[0]);
    }
  }, [resourcesWithFlow, resource, userPicked]);

  // Picker options: the resources with live flow, PLUS the current pick even if
  // its flow has transiently vanished, so a deliberate pick stays visible and
  // selected in the dropdown instead of falling back to the browser's first
  // option.
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

  // Stable so an unchanged resource selection doesn't churn mounted augments.
  const scope = useMemo<PowerSystemsScope>(() => ({ resource }), [resource]);

  // Per-part flow contributions for the selected resource. Includes
  // zero-flow rows when the part exposes a nominalFlow, those are
  // "idle" deployables (stowed solar panel, shaded panel, etc.) that
  // would contribute power if the conditions were right. Storage-only
  // rows (no flow, no nominal) are still skipped.
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
  // Parts with a known nominal capacity but no current flow, stowed
  // solar panels, panels in shadow, etc. Rendered at low opacity so the
  // operator can distinguish "no panels installed" from "panels installed
  // but currently idle".
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
  // Single source of truth for PROD/NET: the itemized rows below, always,
  // see the doc comment on `streamPower` above.
  const totalProduced = producers.reduce((s, c) => s + c.flow, 0);
  const totalConsumed = consumers.reduce((s, c) => s + c.flow, 0);
  const net = totalProduced + totalConsumed;

  // The streamed measurement, surfaced separately (never substituted into
  // PROD/NET) only when it MEANINGFULLY disagrees with the itemized total,
  // agreement (the common/healthy case) shows nothing extra, keeping the
  // Totals row exactly as it always has been.
  const measuredTotalProduced =
    resource === "ElectricCharge"
      ? (magnitudeOf(streamPower?.totalProductionEc) ?? undefined)
      : undefined;
  const measuredDisagrees =
    measuredTotalProduced !== undefined &&
    Math.abs(measuredTotalProduced - totalProduced) > 0.01;

  // Storage totals across every part that stores this resource, fuel
  // tanks + EC batteries + monoprop tanks. Independent of flow rows.
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

  // Time-series of the vessel-wide resource level for the sparkline.
  // r.resource[<Name>] is the vessel-wide reservoir
  // (sum-of-parts) and is already buffered, so 120s of history is
  // available without extra subscriptions. Reading numeric values out
  // of the SeriesRange is the standard pattern.
  const seriesKey = `vessel.resources.resources.${resource}.current`;
  const series = useDataSeries("data", seriesKey, SPARKLINE_WINDOW_SEC);
  const sparkValues = useMemo(
    () =>
      series.v.filter(
        (v): v is number => typeof v === "number" && Number.isFinite(v),
      ),
    [series.v],
  );
  // Anchor the sparkline's Y range to the storage capacity so a half-
  // full battery reads as half-full at a glance, not "level is flat
  // relative to itself". Falls back to autoscale on the rare ticks
  // before max arrives.
  const sparkDomain = useMemo<[number, number] | undefined>(
    () => (storage.maxAmount > 0 ? [0, storage.maxAmount] : undefined),
    [storage.maxAmount],
  );

  // Selective rendering. Compact mode collapses to the net rate + the
  // resource name; pre-data state shows a single hint line.
  const cols = w ?? 8;
  const rows = h ?? 10;
  // Wide-short boxes (landscape-18x5) have plenty of *width* but too few
  // *rows* to clear the normal `rows >= 8` height gate, so the height gate
  // alone drops them into the near-empty compact path with ~80% of the width
  // dead. When the grid box is genuinely landscape we instead flow the three sections
  // side-by-side (see SectionsScroll/$landscape) so the full list fits in
  // the short height by spending the spare width. Portrait/square keep the
  // height-gated stacked layout untouched.
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
        /* Panel's own tiny-tile centring, where this hand-rolled the
           `flex: 1` + `justify-content: center` pair itself. Panel measures
           first and only centres while the content fits, which a local box
           cannot: overflowing content centred the plain way puts its first
           line out of scroll reach. */
        fitToSize
        sections={
          <Section gap="sm" style={COMPACT_BODY}>
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
          <>
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
          </>
        }
        sections={[
          <Section key="summary" full>
            {/* Discrete power-state announcement for assistive tech, the visible NET
              readout communicates surplus/deficit through colour + a ticking
              number; this narrates the state word and updates only when the state
              flips (kept out of the ticking value so it doesn't flood). */}
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
          /* The breakdown is the body of this widget: it takes the height the
             totals and the trend leave, which is what it did as the body's own
             flexing child. */
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
                      <ContributionRow key={c.flightId} contribution={c} />
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
                      <ContributionRow key={c.flightId} contribution={c} />
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
                      <ContributionRow key={c.flightId} contribution={c} />
                    ))}
                  </div>
                </Section>
              )}
              {/* Augment sections: e.g. an Uplink's EC-broker breakdown, composed
              below the stock producer/consumer/idle readout and INSIDE the same
              scroller, which is why the seam is placed here rather than left to
              `Panel`'s default end-of-body mount. */}
              <WidgetSections />
            </SectionsScroll>
          </Section>,
        ]}
      />
    </WidgetScopeProvider>
  );
}

function ContributionRow({ contribution }: { contribution: Contribution }) {
  const { partTitle, flow, flowKnown, nominalFlow } = contribution;
  // Three-way sign: a shadowed solar panel produces nothing but is
  // not consuming either; rendering its `+0.00` in green misreads as
  // "actively producing". Neutral colour communicates "idle" honestly.
  const sign: "pos" | "neg" | "zero" =
    Math.abs(flow) < 1e-9 ? "zero" : flow > 0 ? "pos" : "neg";
  // No efficiency without a measurement: "0% of nominal" computed from a flow
  // that never arrived states a fraction nobody measured.
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
          <Unit value={value("%", eff * 100)} decimals={0} />
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

/** Resource ids are camelCase (`ElectricCharge`,
 *  `LiquidFuel`): the compact-mode CSS uppercases them to
 *  `ELECTRICCHARGE` with no visible word boundary. Inserting a space
 *  between a lowercase and the following uppercase preserves the
 *  word break under the uppercase transform. */
function splitCamel(s: string): string {
  return s.replace(/([a-z])([A-Z])/g, "$1 $2");
}

function formatUnits(v: number): string {
  if (!Number.isFinite(v)) return NULL_DISPLAY;
  if (Math.abs(v) >= 10_000) return `${(v / 1000).toFixed(1)}k`;
  if (Math.abs(v) >= 100) return v.toFixed(0);
  return v.toFixed(1);
}

// ── Config ────────────────────────────────────────────────────────────────────

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

// ── Styles ────────────────────────────────────────────────────────────────────

// Structural inline styles (CSS-var tokens): a bespoke totals/sparkline/section
// board, no reusable ui-kit primitive fits the layout, so it stays local. Toned
// numeric readouts render through ui-kit `Value` (tone -fg); cell backgrounds/
// borders stay on -bg tokens (correct). Two styled blocks remain (SectionsScroll,
// PowerRow), see the import's biome-ignore.

const RESOURCE_SELECT: CSSProperties = {
  maxWidth: "50%",
  fontSize: "var(--font-size-xs)",
  padding: "var(--space-2) var(--space-6)",
};

const TOTALS: CSSProperties = {
  display: "grid",
  // 64px lets four cells fit in one row at threshold-6×8 (was wrapping to 2×2
  // with the inner STORED value breaking inside). The narrower cell pairs with
  // the smaller CellValue font (13px + nowrap) so the "2900 / 4050"-shape value
  // stays on one line.
  gridTemplateColumns: "repeat(auto-fit, minmax(64px, 1fr))",
  gap: "var(--space-6)",
  marginTop: "var(--space-8)",
  marginBottom: "var(--space-8)",
};

const TOTALS_CELL: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "var(--space-2)",
  padding: "var(--space-4) var(--space-6)",
  background: "var(--color-surface-panel)",
  border: "1px solid var(--color-surface-raised)",
  borderRadius: "var(--radius-xs)",
};

// The NET cell's tinted background + border (stays on -bg tokens: a fill, not
// text). Merged over TOTALS_CELL at the call site.
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

// A distinctly-bordered cell for the streamed `parts.power.totalProductionEc`
// reading, shown ONLY when it disagrees with the itemized PROD total: a visible
// "these two numbers don't match" signal (dashed border, muted warning tint)
// rather than either silently overriding PROD/NET or silently vanishing.
const MEASURED_CELL: CSSProperties = {
  border: "1px dashed var(--color-status-warning-bg)",
};

// The default CELL_LABEL colour is text-faint; inside NetCell the label takes a
// tone-appropriate foreground instead (via cellLabelColor). --color-text-faint
// reads fine on the flat panel background every other CellLabel sits on, but
// against NetCell's tinted go/warn backgrounds it drops below the 4.5:1 AA floor
// for this size of text, so it matches NetCell's own foreground tokens.
const CELL_LABEL: CSSProperties = {
  fontSize: "var(--font-size-2xs)",
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

// `Text` supplies tone (-fg), size and tabular-nums; the weight + nowrap are
// this widget's. The neg/warn sign now renders on Text's warning-fg (was the
// -bg token): the intended -fg normalization.
const CELL_VALUE: CSSProperties = { fontWeight: 700, whiteSpace: "nowrap" };

// STORED can carry an "amount / max" pair (e.g. "2900 / 4050"). At the default
// 8×12 size all four Totals cells pack into one row, leaving each cell too
// narrow for the nowrap value; allow it to wrap within its cell (there is
// vertical room), the break only ever lands at the " / " separator.
const STORED_VALUE: CSSProperties = {
  fontWeight: 700,
  whiteSpace: "normal",
  lineHeight: "var(--line-height-tight)",
};

const SPARKLINE_ROW: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "var(--space-8)",
  marginBottom: "var(--space-8)",
  padding: "var(--space-6) var(--space-8)",
  background: "var(--color-surface-panel)",
  border: "1px solid var(--color-surface-raised)",
  borderRadius: "var(--radius-xs)",
};

const SPARKLINE_LABEL: CSSProperties = {
  fontSize: "var(--font-size-2xs)",
  letterSpacing: "0.12em",
  textTransform: "uppercase",
  color: "var(--color-text-faint)",
  display: "inline-flex",
  alignItems: "baseline",
  gap: "var(--space-4)",
  flexShrink: 0,
};

const SPARKLINE_SUB: CSSProperties = { color: "var(--color-text-dim)" };

// Sparkline renders a fixed 240×36 SVG. The slot lets it ride at its intrinsic
// size on the left; the unused space on wider widgets keeps the row from
// looking truncated without forcing a responsive SVG.
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
    /* Portrait/square: sections stack vertically and the whole area scrolls
       (unchanged). Landscape (wide-short): sections sit side-by-side as
       equal columns, each scrolling its own list, so the full producers /
       consumers / idle breakdown fits in the short height by using the
       spare width instead of dropping to the compact net-only readout. */
    flex-direction: ${({ $landscape }) => ($landscape ? "row" : "column")};
    gap: ${({ $landscape }) => ($landscape ? "var(--space-12)" : "var(--space-8)")};
    ${({ $landscape }) =>
      $landscape ? "align-items: stretch; overflow: hidden;" : ""}
  }
`;

// The kit's Section is exactly the gap:2px column; $landscape is the only thing
// it does not cover, and it is genuinely this widget's layout mode. Applied via
// `<Section as="section" style={landscape ? PANEL_SECTION_LANDSCAPE ...}>`.
const PANEL_SECTION_LANDSCAPE: CSSProperties = {
  flex: "1 1 0",
  minWidth: 0,
  minHeight: 0,
};

const SECTION_COUNT: CSSProperties = {
  marginLeft: "var(--space-4)",
  color: "var(--color-text-muted)",
};

const SECTION_EMPTY: CSSProperties = {
  fontSize: "var(--font-size-xs)",
  color: "var(--color-text-faint)",
  padding: "var(--space-2) 0",
};

const CONTRIB_LIST: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "var(--space-hair)",
};

const IDLE_LIST: CSSProperties = { ...CONTRIB_LIST, opacity: 0.55 };

const PowerRow = styled.div`
  display: grid;
  grid-template-columns: 1fr auto auto;
  gap: var(--space-6);
  padding: var(--space-2) var(--space-6);
  font-size: var(--font-size-xs);
  background: var(--color-surface-app);
  border-radius: var(--radius-xs);
  &:hover {
    background: var(--color-surface-panel);
  }
`;

// Per-sign colour was styled; the row value now renders through `Value`
// (tone={go|warn|faint}), so RowValue is gone. RowEff stays a plain caption.
const ROW_EFF: CSSProperties = {
  fontSize: "var(--font-size-2xs)",
  color: "var(--color-text-faint)",
  fontVariantNumeric: "tabular-nums",
};

const HINT: CSSProperties = {
  marginTop: "var(--space-6)",
  fontSize: "var(--font-size-xs)",
  color: "var(--color-text-faint)",
  lineHeight: "var(--line-height-body)",
};

/**
 * What is left of the compact body once `Panel fitToSize` owns the fill and the
 * centring: the text alignment for a resource name long enough to wrap.
 */
const COMPACT_BODY: CSSProperties = {
  alignItems: "center",
  textAlign: "center",
};

const COMPACT_RESOURCE: CSSProperties = {
  fontSize: "var(--font-size-2xs)",
  letterSpacing: "0.08em",
  textTransform: "uppercase",
  color: "var(--color-text-faint)",
};

// Extra layout for the compact NET readout (rendered via `Value` for its tone):
// at the tiny (3×3) size the panel's inner width is ~80px and a value like
// "+49.50/s" has no natural break point, so max-width + ellipsis is the safety
// net against the panel's overflow:hidden clipping. The 16px stays literal (off
// the type scale on purpose): --font-size-lg is identical on desktop but 17px
// under @media (pointer: coarse), and the tier-1 Steam Deck is coarse, so the
// token would reintroduce the clipping bug on the one platform that matters
// most.
const COMPACT_NET: CSSProperties = {
  maxWidth: "100%",
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
  fontSize: "16px",
  fontWeight: 700,
};

// ── Registration ──────────────────────────────────────────────────────────────

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
  // Subscribes via useTopology + usePartsLive: same chain as ShipMap.
  // useTopology reads `vessel.parts` directly (stream-native, bypasses
  // mapTopic); usePartsLive derives per-part thermal, resources, and
  // module state off that SAME payload: no per-flightId subscriptions.
  // The sparkline reads the vessel-wide reservoir for whichever resource is
  // selected, off `vessel.resources`. The Topic is what it declares: the
  // reservoir is keyed BY RESOURCE NAME, so the field path underneath it names
  // a key the contract never does and only the Topic can be declared.
  dataRequirements: ["vessel.parts", "vessel.resources", "parts.power"],
  defaultConfig: { defaultResource: "ElectricCharge" },
  actions: powerSystemsActions,
  // Augment slot. `sections`: body table/section below the stock readout
  // (an EC-broker breakdown is the canonical filler). Renders nothing
  // until an Uplink registers.
  augmentSlots: ["power-systems.sections"],
  pushable: true,
  requires: ["flight"],
});

export { PowerSystemsComponent };
