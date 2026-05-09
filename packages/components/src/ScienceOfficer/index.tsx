import type { ComponentProps } from "@gonogo/core";
import {
  registerComponent,
  useDataValue,
  useExecuteAction,
} from "@gonogo/core";
import { Panel, PanelSubtitle, PanelTitle, ScrollArea } from "@gonogo/ui";
import { useEffect, useState } from "react";
import styled from "styled-components";

type ScienceOfficerConfig = Record<string, never>;

export interface Instrument {
  partId: number;
  partTitle: string;
  expId: string;
  deployed: boolean;
  hasData: boolean;
  rerunnable: boolean;
  inoperable: boolean;
}

/**
 * Defensive parser for `sci.instruments` from the GonogoTelemetry
 * plugin. Drops malformed entries and coerces flightID to number.
 */
export function parseInstruments(raw: unknown): Instrument[] | null {
  if (raw === null || raw === undefined) return null;
  if (!Array.isArray(raw)) return null;
  const out: Instrument[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    const e = entry as Record<string, unknown>;
    const partId = typeof e.partId === "number" ? e.partId : null;
    if (partId === null) continue;
    out.push({
      partId,
      partTitle: typeof e.partTitle === "string" ? e.partTitle : "Unknown part",
      expId: typeof e.expId === "string" ? e.expId : "",
      deployed: e.deployed === true,
      hasData: e.hasData === true,
      rerunnable: e.rerunnable === true,
      inoperable: e.inoperable === true,
    });
  }
  return out;
}

function ScienceOfficerComponent({
  h,
}: Readonly<ComponentProps<ScienceOfficerConfig>>) {
  const instrumentsRaw = useDataValue("data", "sci.instruments");
  const instruments = parseInstruments(instrumentsRaw);
  const execute = useExecuteAction("data");

  const rows = h ?? 8;
  const showSubtitle = rows >= 4;

  if (instruments === null) {
    return (
      <Panel>
        <PanelTitle>SCIENCE OFFICER</PanelTitle>
        {showSubtitle && (
          <PanelSubtitle>Awaiting instrument telemetry</PanelSubtitle>
        )}
      </Panel>
    );
  }

  if (instruments.length === 0) {
    return (
      <Panel>
        <PanelTitle>SCIENCE OFFICER</PanelTitle>
        {showSubtitle && <PanelSubtitle>No instruments aboard</PanelSubtitle>}
      </Panel>
    );
  }

  // Group by expId so a vessel with three thermometers shows them in
  // one cluster rather than scattered.
  const grouped = groupByExpId(instruments);

  const totals = summarise(instruments);

  return (
    <Panel>
      <PanelTitle>SCIENCE OFFICER</PanelTitle>
      {showSubtitle && (
        <PanelSubtitle role="status" aria-live="polite">
          {totals.hasData}/{totals.total} with data · {totals.deployed} deployed
          {totals.inoperable > 0 ? ` · ${totals.inoperable} inoperable` : ""}
        </PanelSubtitle>
      )}
      <Body>
        {grouped.map(({ expId, items }) => (
          <Group key={expId}>
            <GroupLabel>{expId || "(unknown)"}</GroupLabel>
            <InstrumentList>
              {items.map((inst) => (
                <Row key={inst.partId}>
                  <RowName>{inst.partTitle}</RowName>
                  <Badges>
                    {inst.hasData && <Badge $kind="data">DATA</Badge>}
                    {inst.deployed && <Badge $kind="deployed">DEPLOYED</Badge>}
                    {!inst.rerunnable && (
                      <Badge $kind="oneshot">ONE-SHOT</Badge>
                    )}
                    {inst.inoperable && <Badge $kind="inop">INOPERABLE</Badge>}
                  </Badges>
                  <InstrumentActions instrument={inst} execute={execute} />
                </Row>
              ))}
            </InstrumentList>
          </Group>
        ))}
      </Body>
    </Panel>
  );
}

const ARM_TIMEOUT_MS = 4000;

function InstrumentActions({
  instrument,
  execute,
}: {
  instrument: Instrument;
  execute: (action: string) => Promise<void>;
}) {
  const [armed, setArmed] = useState(false);

  useEffect(() => {
    if (!armed) return;
    const id = setTimeout(() => setArmed(false), ARM_TIMEOUT_MS);
    return () => clearTimeout(id);
  }, [armed]);

  // Inoperable instruments can't deploy or transmit. Hide the controls
  // entirely rather than greying them out — the INOPERABLE badge already
  // tells the operator why nothing's available.
  if (instrument.inoperable) return null;

  return (
    <Actions>
      {!instrument.deployed && !instrument.hasData && (
        <ActionButton
          type="button"
          onClick={() => {
            void execute(`sci.deploy[${instrument.partId}]`);
          }}
        >
          Deploy
        </ActionButton>
      )}
      {instrument.hasData &&
        (armed ? (
          <ConfirmTransmitButton
            type="button"
            onClick={() => {
              setArmed(false);
              void execute(`sci.transmit[${instrument.partId}]`);
            }}
          >
            Confirm transmit
          </ConfirmTransmitButton>
        ) : (
          <ActionButton type="button" onClick={() => setArmed(true)}>
            Transmit
          </ActionButton>
        ))}
    </Actions>
  );
}

interface InstrumentGroup {
  expId: string;
  items: Instrument[];
}

function groupByExpId(instruments: Instrument[]): InstrumentGroup[] {
  const map = new Map<string, Instrument[]>();
  for (const inst of instruments) {
    const list = map.get(inst.expId);
    if (list) list.push(inst);
    else map.set(inst.expId, [inst]);
  }
  return Array.from(map.entries()).map(([expId, items]) => ({ expId, items }));
}

function summarise(instruments: Instrument[]): {
  total: number;
  hasData: number;
  deployed: number;
  inoperable: number;
} {
  let hasData = 0;
  let deployed = 0;
  let inoperable = 0;
  for (const inst of instruments) {
    if (inst.hasData) hasData++;
    if (inst.deployed) deployed++;
    if (inst.inoperable) inoperable++;
  }
  return { total: instruments.length, hasData, deployed, inoperable };
}

// ── Styles ────────────────────────────────────────────────────────────────────

const Body = styled(ScrollArea)`
  flex: 1;
  min-height: 0;

  [data-scroll-area-inner] {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
`;

const Group = styled.div`
  display: flex;
  flex-direction: column;
  gap: 2px;
`;

const GroupLabel = styled.div`
  font-size: var(--font-size-xs);
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--color-text-muted);
`;

const InstrumentList = styled.ul`
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
`;

const Row = styled.li`
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  padding: 2px 0;
`;

const RowName = styled.span`
  color: var(--color-text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex: 1;
  min-width: 0;
`;

const Badges = styled.span`
  display: inline-flex;
  gap: 4px;
  flex-shrink: 0;
`;

const Actions = styled.span`
  display: inline-flex;
  gap: 4px;
  flex-shrink: 0;
  margin-left: 6px;
`;

const ActionButton = styled.button`
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.04em;
  padding: 2px 8px;
  border-radius: 2px;
  border: 1px solid var(--color-surface-raised);
  background: transparent;
  color: var(--color-text-muted);
  cursor: pointer;
  font-family: inherit;

  &:hover {
    color: var(--color-text-primary);
    border-color: var(--color-accent-fg);
  }
`;

const ConfirmTransmitButton = styled(ActionButton)`
  background: var(--color-status-go-bg);
  color: var(--color-status-go-fg);
  border-color: transparent;
  animation: transmitPulse 1s ease-in-out infinite;

  @media (prefers-reduced-motion: no-preference) {
    @keyframes transmitPulse {
      0%,
      100% {
        opacity: 1;
      }
      50% {
        opacity: 0.6;
      }
    }
  }
`;

const Badge = styled.span<{
  $kind: "data" | "deployed" | "oneshot" | "inop";
}>`
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 0.08em;
  padding: 1px 4px;
  border-radius: 2px;
  background: ${(p) =>
    p.$kind === "data"
      ? "var(--color-status-go-bg)"
      : p.$kind === "deployed"
        ? "var(--color-surface-raised)"
        : p.$kind === "oneshot"
          ? "var(--color-surface-raised)"
          : "var(--color-status-nogo-bg)"};
  color: ${(p) =>
    p.$kind === "data"
      ? "var(--color-status-go-fg)"
      : p.$kind === "inop"
        ? "var(--color-status-nogo-fg)"
        : "var(--color-text-muted)"};
`;

// ── Registration ──────────────────────────────────────────────────────────────

registerComponent<ScienceOfficerConfig>({
  id: "science-officer",
  name: "Science Officer",
  description:
    "Per-instrument science panel — every ModuleScienceExperiment on the active vessel grouped by experiment id, with badges for stored-data / deployed / one-shot / inoperable. Read-only Phase 2; Phase 4 will add deploy + transmit buttons.",
  tags: ["telemetry", "science"],
  defaultSize: { w: 6, h: 7 },
  minSize: { w: 3, h: 4 },
  component: ScienceOfficerComponent,
  dataRequirements: ["sci.instruments"],
  defaultConfig: {},
  actions: [],
  pushable: true,
  requires: ["flight"],
});

export { ScienceOfficerComponent };
