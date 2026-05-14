import type {
  ActionDefinition,
  ComponentProps,
  ConfigComponentProps,
} from "@gonogo/core";
import { registerComponent, useActionInput } from "@gonogo/core";
import { usePartsLive, useTopology } from "@gonogo/data";
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
} from "@gonogo/ui";
import { useEffect, useMemo, useState } from "react";
import styled from "styled-components";

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

  // Per-part flow contributions for the selected resource. Excludes rows
  // with zero or absent flow — they're storage-only entries.
  const contributions = useMemo<Contribution[]>(() => {
    const out: Contribution[] = [];
    if (!topology) return out;
    for (const part of topology.parts) {
      const slice = liveByFlightId.get(part.flightId);
      const row = slice?.resources?.[resource];
      if (!row || typeof row.flow !== "number" || row.flow === 0) continue;
      out.push({
        flightId: part.flightId,
        partTitle: part.title ?? part.name,
        flow: row.flow,
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
          <CompactResource>{resource}</CompactResource>
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
      </SectionsScroll>
    </Panel>
  );
}

function ContributionRow({ contribution }: { contribution: Contribution }) {
  const { partTitle, flow, nominalFlow } = contribution;
  const isProducer = flow >= 0;
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
      <RowValue $sign={isProducer ? "pos" : "neg"}>
        {isProducer ? "+" : ""}
        {flow.toFixed(2)}
      </RowValue>
    </Row>
  );
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
  grid-template-columns: repeat(auto-fit, minmax(72px, 1fr));
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
  font-size: 14px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  color: ${({ $sign }) =>
    $sign === "pos"
      ? "var(--color-status-go-fg)"
      : $sign === "neg"
        ? "var(--color-status-warning-bg)"
        : "var(--color-text-primary)"};
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

const RowValue = styled.span<{ $sign: "pos" | "neg" }>`
  font-variant-numeric: tabular-nums;
  color: ${({ $sign }) =>
    $sign === "pos"
      ? "var(--color-status-go-fg)"
      : "var(--color-status-warning-bg)"};
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
  // dynamically.
  dataRequirements: ["v.topologySeq", "v.topology"],
  defaultConfig: { defaultResource: "ElectricCharge" },
  actions: powerSystemsActions,
  pushable: true,
  requires: ["flight"],
});

export { PowerSystemsComponent };
