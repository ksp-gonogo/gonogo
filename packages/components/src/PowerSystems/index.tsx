import type {
  ActionDefinition,
  ComponentProps,
  ConfigComponentProps,
} from "@gonogo/core";
import { registerComponent, useActionInput } from "@gonogo/core";
import { useDataSeries, usePartsLive, useTopology } from "@gonogo/data";
import {
  ConfigForm,
  Field,
  FieldHint,
  FieldLabel,
  Panel,
  PanelSubtitle,
  PanelTitle,
  PrimaryButton,
  ScrollArea,
  Select,
  Sparkline,
} from "@gonogo/ui";
import { useEffect, useMemo, useState } from "react";
import styled from "styled-components";

/**
 * Sparkline window in seconds. Two minutes is enough to see a real
 * EC drain trend on a typical probe (sun-side → shadow transitions
 * land inside this window) without becoming a graph widget in
 * disguise.
 */
const SPARKLINE_WINDOW_SEC = 120;

interface PowerSystemsConfig {
  /**
   * Resource to focus on. Default ElectricCharge — the most common reason
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
  flow: number;
  nominalFlow?: number;
}

function PowerSystemsComponent({
  config,
  w,
  h,
}: Readonly<ComponentProps<PowerSystemsConfig>>) {
  const topology = useTopology("data");
  const flightIds = useMemo(
    () => topology?.parts.map((p) => p.flightId) ?? [],
    [topology],
  );
  const liveByFlightId = usePartsLive(flightIds);

  const defaultResource = config?.defaultResource ?? "ElectricCharge";
  const [resource, setResource] = useState(defaultResource);
  // Re-seed the selection when the config default changes (Save in the
  // config modal). The user's in-widget pick stays sticky during a session
  // until they explicitly change it, since `setResource` overrides this on
  // subsequent renders.
  useEffect(() => {
    setResource(defaultResource);
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

  // Make sure the selected resource is always one with data when it's
  // available — if the current pick has no contributions but others do,
  // jump to the first that does. (Common at vessel-swap.)
  useEffect(() => {
    if (resourcesWithFlow.length === 0) return;
    if (!resourcesWithFlow.includes(resource)) {
      setResource(resourcesWithFlow[0]);
    }
  }, [resourcesWithFlow, resource]);

  useActionInput<PowerSystemsActions>({
    cycleResource: (payload) => {
      if (payload.kind === "button" && payload.value !== true) return undefined;
      if (resourcesWithFlow.length === 0) return undefined;
      const idx = resourcesWithFlow.indexOf(resource);
      const next = resourcesWithFlow[(idx + 1) % resourcesWithFlow.length];
      setResource(next);
      return { resource: next };
    },
  });

  // Per-part flow contributions for the selected resource. Includes
  // zero-flow rows when the part exposes a nominalFlow — those are
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
  // Parts with a known nominal capacity but no current flow — stowed
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
  const totalProduced = producers.reduce((s, c) => s + c.flow, 0);
  const totalConsumed = consumers.reduce((s, c) => s + c.flow, 0);
  const net = totalProduced + totalConsumed;

  // Storage totals across every part that stores this resource — fuel
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
  // r.resource[<Name>] is the base-Telemachus vessel-wide reservoir
  // (sum-of-parts) and is already buffered, so 120s of history is
  // available without extra subscriptions. Reading numeric values out
  // of the SeriesRange is the standard pattern.
  const seriesKey = `r.resource[${resource}]`;
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
  const showFullList = cols >= 6 && rows >= 8;
  const showHeader = rows >= 4;

  if (!topology) {
    return (
      <Panel>
        <PanelTitle>POWER SYSTEMS</PanelTitle>
        <Hint>Waiting for vessel topology…</Hint>
      </Panel>
    );
  }

  if (resourcesWithFlow.length === 0) {
    return (
      <Panel>
        <PanelTitle>POWER SYSTEMS</PanelTitle>
        {showHeader && (
          <PanelSubtitle>No active flow on any resource</PanelSubtitle>
        )}
        <Hint>
          Deploy a solar panel, run a generator, or fire an engine to see flow
          contributions here.
        </Hint>
      </Panel>
    );
  }

  const netTone: "go" | "warn" | "neutral" =
    net > 1e-6 ? "go" : net < -1e-6 ? "warn" : "neutral";

  if (!showFullList) {
    return (
      <Panel>
        <PanelTitle>POWER</PanelTitle>
        <CompactBody>
          <CompactResource>{splitCamel(resource)}</CompactResource>
          <CompactNet $tone={netTone}>
            {net >= 0 ? "+" : ""}
            {net.toFixed(2)}/s
          </CompactNet>
        </CompactBody>
      </Panel>
    );
  }

  return (
    <Panel>
      <Header>
        <PanelTitle>POWER SYSTEMS</PanelTitle>
        <ResourceSelect
          value={resource}
          onChange={(e) => setResource(e.target.value)}
          aria-label="Resource"
        >
          {resourcesWithFlow.map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </ResourceSelect>
      </Header>

      <Totals>
        <NetCell $tone={netTone}>
          <CellLabel>NET</CellLabel>
          <CellValue>
            {net >= 0 ? "+" : ""}
            {net.toFixed(2)}/s
          </CellValue>
        </NetCell>
        <TotalsCell>
          <CellLabel>PROD</CellLabel>
          <CellValue $sign="pos">
            {totalProduced > 0 ? "+" : ""}
            {totalProduced.toFixed(2)}
          </CellValue>
        </TotalsCell>
        <TotalsCell>
          <CellLabel>CONS</CellLabel>
          <CellValue $sign="neg">{totalConsumed.toFixed(2)}</CellValue>
        </TotalsCell>
        {storage.maxAmount > 0 && (
          <TotalsCell>
            <CellLabel>STORED</CellLabel>
            <CellValue>
              {formatUnits(storage.amount)} / {formatUnits(storage.maxAmount)}
            </CellValue>
          </TotalsCell>
        )}
      </Totals>

      {storage.maxAmount > 0 && sparkValues.length >= 2 && (
        <SparklineRow
          role="img"
          aria-label={`${splitCamel(resource)} level over the last ${SPARKLINE_WINDOW_SEC}s`}
        >
          <SparklineLabel>
            Trend
            <SparklineSub>· {SPARKLINE_WINDOW_SEC}s</SparklineSub>
          </SparklineLabel>
          <SparklineSlot>
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
          </SparklineSlot>
        </SparklineRow>
      )}

      <SectionsScroll>
        <Section>
          <SectionTitle>
            Producers
            {producers.length > 0 && (
              <SectionCount>· {producers.length}</SectionCount>
            )}
          </SectionTitle>
          {producers.length === 0 ? (
            <SectionEmpty>Nothing producing.</SectionEmpty>
          ) : (
            <ContribList>
              {producers.map((c) => (
                <ContributionRow key={c.flightId} contribution={c} />
              ))}
            </ContribList>
          )}
        </Section>
        <Section>
          <SectionTitle>
            Consumers
            {consumers.length > 0 && (
              <SectionCount>· {consumers.length}</SectionCount>
            )}
          </SectionTitle>
          {consumers.length === 0 ? (
            <SectionEmpty>Nothing consuming.</SectionEmpty>
          ) : (
            <ContribList>
              {consumers.map((c) => (
                <ContributionRow key={c.flightId} contribution={c} />
              ))}
            </ContribList>
          )}
        </Section>
        {idle.length > 0 && (
          <Section>
            <SectionTitle>
              Idle
              <SectionCount>· {idle.length}</SectionCount>
            </SectionTitle>
            <IdleList>
              {idle.map((c) => (
                <ContributionRow key={c.flightId} contribution={c} />
              ))}
            </IdleList>
          </Section>
        )}
      </SectionsScroll>
    </Panel>
  );
}

function ContributionRow({ contribution }: { contribution: Contribution }) {
  const { partTitle, flow, nominalFlow } = contribution;
  // Three-way sign — a shadowed solar panel produces nothing but is
  // not consuming either; rendering its `+0.00` in green misreads as
  // "actively producing". Neutral colour communicates "idle" honestly.
  const sign: "pos" | "neg" | "zero" =
    Math.abs(flow) < 1e-9 ? "zero" : flow > 0 ? "pos" : "neg";
  const eff =
    typeof nominalFlow === "number" && Math.abs(nominalFlow) > 1e-9
      ? Math.abs(flow / nominalFlow)
      : null;
  return (
    <Row>
      <RowName>{partTitle}</RowName>
      {eff !== null && (
        <RowEff title={`${(eff * 100).toFixed(0)}% of nominal`}>
          {(eff * 100).toFixed(0)}%
        </RowEff>
      )}
      <RowValue $sign={sign}>
        {sign === "pos" ? "+" : ""}
        {flow.toFixed(2)}
      </RowValue>
    </Row>
  );
}

/** Telemachus resource ids are camelCase (`ElectricCharge`,
 *  `LiquidFuel`) — the compact-mode CSS uppercases them to
 *  `ELECTRICCHARGE` with no visible word boundary. Inserting a space
 *  between a lowercase and the following uppercase preserves the
 *  word break under the uppercase transform. */
function splitCamel(s: string): string {
  return s.replace(/([a-z])([A-Z])/g, "$1 $2");
}

function formatUnits(v: number): string {
  if (!Number.isFinite(v)) return "—";
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
      <PrimaryButton
        onClick={() =>
          onSave({
            defaultResource: defaultResource.trim() || "ElectricCharge",
          })
        }
      >
        Save
      </PrimaryButton>
    </ConfigForm>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const Header = styled.div`
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
`;

const ResourceSelect = styled(Select)`
  max-width: 50%;
  font-size: 11px;
  padding: 2px 6px;
`;

const Totals = styled.div`
  display: grid;
  /* 64px lets four cells fit in one row at threshold-6×8 (was wrapping
     to 2×2 with the inner STORED value breaking inside). The narrower
     cell pairs with the smaller CellValue font (13px + nowrap) so the
     "2900 / 4050"-shape value stays on one line. */
  grid-template-columns: repeat(auto-fit, minmax(64px, 1fr));
  gap: 6px;
  margin-top: 8px;
  margin-bottom: 8px;
`;

const TotalsCell = styled.div`
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 4px 6px;
  background: var(--color-surface-panel);
  border: 1px solid var(--color-surface-raised);
  border-radius: 2px;
`;

const NetCell = styled(TotalsCell)<{ $tone: "go" | "warn" | "neutral" }>`
  background: ${({ $tone }) =>
    $tone === "go"
      ? "var(--color-status-go-bg)"
      : $tone === "warn"
        ? "var(--color-status-warning-bg-muted)"
        : "var(--color-surface-panel)"};
  border-color: ${({ $tone }) =>
    $tone === "go"
      ? "var(--color-status-go-bg)"
      : $tone === "warn"
        ? "var(--color-status-warning-bg)"
        : "var(--color-surface-raised)"};
`;

const CellLabel = styled.span`
  font-size: 9px;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--color-text-faint);
`;

const CellValue = styled.span<{ $sign?: "pos" | "neg" }>`
  font-size: 13px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
  color: ${({ $sign }) =>
    $sign === "pos"
      ? "var(--color-status-go-fg)"
      : $sign === "neg"
        ? "var(--color-status-warning-bg)"
        : "var(--color-text-primary)"};
`;

const SparklineRow = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
  padding: 6px 8px;
  background: var(--color-surface-panel);
  border: 1px solid var(--color-surface-raised);
  border-radius: 2px;
`;

const SparklineLabel = styled.span`
  font-size: 9px;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--color-text-faint);
  display: inline-flex;
  align-items: baseline;
  gap: 4px;
  flex-shrink: 0;
`;

const SparklineSub = styled.span`
  color: var(--color-text-dim);
`;

const SparklineSlot = styled.div`
  flex: 1;
  min-width: 0;
  /* Sparkline renders a fixed 240×36 SVG. The slot lets it ride at
     its intrinsic size on the left; the unused space on wider widgets
     keeps the row from looking truncated without forcing a responsive
     SVG. The future "click to expand into Graph widget" affordance
     would naturally live here. */
  display: flex;
  align-items: center;
`;

const SectionsScroll = styled(ScrollArea)`
  flex: 1;
  [data-scroll-area-inner] {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
`;

const Section = styled.section`
  display: flex;
  flex-direction: column;
  gap: 2px;
`;

const SectionTitle = styled.h3`
  margin: 0;
  font-size: 10px;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--color-text-faint);
`;

const SectionCount = styled.span`
  margin-left: 4px;
  color: var(--color-text-muted);
`;

const SectionEmpty = styled.div`
  font-size: 11px;
  color: var(--color-text-faint);
  padding: 2px 0;
`;

const ContribList = styled.div`
  display: flex;
  flex-direction: column;
  gap: 1px;
`;

const IdleList = styled(ContribList)`
  opacity: 0.55;
`;

const Row = styled.div`
  display: grid;
  grid-template-columns: 1fr auto auto;
  gap: 6px;
  padding: 3px 6px;
  font-size: 11px;
  background: var(--color-surface-app);
  border-radius: 2px;
  &:hover {
    background: var(--color-surface-panel);
  }
`;

const RowName = styled.span`
  color: var(--color-text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

const RowEff = styled.span`
  font-size: 10px;
  color: var(--color-text-faint);
  font-variant-numeric: tabular-nums;
`;

const RowValue = styled.span<{ $sign: "pos" | "neg" | "zero" }>`
  font-variant-numeric: tabular-nums;
  color: ${({ $sign }) =>
    $sign === "pos"
      ? "var(--color-status-go-fg)"
      : $sign === "neg"
        ? "var(--color-status-warning-bg)"
        : "var(--color-text-faint)"};
`;

const Hint = styled.div`
  margin-top: 6px;
  font-size: 11px;
  color: var(--color-text-faint);
  line-height: 1.4;
`;

const CompactBody = styled.div`
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 4px;
  text-align: center;
`;

const CompactResource = styled.div`
  font-size: 10px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--color-text-faint);
`;

const CompactNet = styled.div<{ $tone: "go" | "warn" | "neutral" }>`
  font-size: 18px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  color: ${({ $tone }) =>
    $tone === "go"
      ? "var(--color-status-go-fg)"
      : $tone === "warn"
        ? "var(--color-status-warning-bg)"
        : "var(--color-text-primary)"};
`;

// ── Registration ──────────────────────────────────────────────────────────────

registerComponent<PowerSystemsConfig>({
  id: "power-systems",
  name: "Power Systems",
  description:
    "Producers vs consumers per resource. Aggregates `r.resourceFor[fid].flow` across every part on the vessel — solar panels, RTGs, generators, ISRU, drills, engines. Default resource is ElectricCharge; the picker switches to any other resource with live flow contributions. Net rate, total produced, total consumed, plus per-part efficiency where the module exposes a nominal cap.",
  tags: ["telemetry", "ship"],
  defaultSize: { w: 8, h: 12 },
  minSize: { w: 3, h: 3 },
  component: PowerSystemsComponent,
  configComponent: PowerSystemsConfigComponent,
  openConfigOnAdd: false,
  // Subscribes via useTopology + usePartsLive — same chain as ShipMap.
  // No explicit list of per-part keys here; the hook walks the topology
  // and opens r.resourceFor[fid] / therm.part[fid] subscriptions
  // dynamically. The sparkline reads r.resource[<defaultResource>]
  // from the base-Telemachus vessel-wide reservoir.
  dataRequirements: [
    "v.topologySeq",
    "v.topology",
    "r.resource[ElectricCharge]",
  ],
  defaultConfig: { defaultResource: "ElectricCharge" },
  actions: powerSystemsActions,
  pushable: true,
  requires: ["flight"],
});

export { PowerSystemsComponent };
