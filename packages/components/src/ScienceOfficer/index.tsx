import type { ComponentProps } from "@gonogo/core";
import {
  getWidgetShape,
  registerComponent,
  useDataStreamStatus,
  useDataValue,
  useExecuteAction,
} from "@gonogo/core";
import {
  Panel,
  PanelSubtitle,
  PanelTitle,
  ScrollArea,
  Spinner,
  StreamStatusBadge,
} from "@gonogo/ui";
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

export interface LabStatus {
  partName: string;
  dataStored: number | null;
  dataStorage: number | null;
  storedScience: number | null;
  processingData: boolean;
  statusText: string | null;
  scientistCount: number | null;
  scienceRate: number | null;
  isOperational: boolean;
}

/**
 * Parses `science.lab` (M3 science/parts batch, `mod/Sitrep.Host/
 * ScienceViewProvider.cs`'s `BuildLab`) — a NEW capability, no legacy
 * Telemachus/GonogoTelemetry analogue existed for Mobile Processing Lab
 * status, so this is a straight whole-topic raw-array read (same
 * `parts.power`/`parts.robotics` "key == topic" precedent in
 * `map-topic.ts`), not a migration of an existing `sci.*` field. Each entry
 * is a lab part on the active vessel; an idle-but-operational lab (crewed,
 * no data loaded) is a normal, valid state — `dataStored`/`processingData`/
 * `scienceRate` all sitting at zero doesn't mean "no lab", it means "lab
 * with nothing to process yet".
 */
export function parseLab(raw: unknown): LabStatus[] | null {
  if (raw === null || raw === undefined) return null;
  if (!Array.isArray(raw)) return null;
  const out: LabStatus[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    const e = entry as Record<string, unknown>;
    out.push({
      partName: typeof e.partName === "string" ? e.partName : "Lab",
      dataStored: typeof e.dataStored === "number" ? e.dataStored : null,
      dataStorage: typeof e.dataStorage === "number" ? e.dataStorage : null,
      storedScience:
        typeof e.storedScience === "number" ? e.storedScience : null,
      processingData: e.processingData === true,
      statusText: typeof e.statusText === "string" ? e.statusText : null,
      scientistCount:
        typeof e.scientistCount === "number" ? e.scientistCount : null,
      scienceRate: typeof e.scienceRate === "number" ? e.scienceRate : null,
      isOperational: e.isOperational === true,
    });
  }
  return out;
}

function ScienceOfficerComponent({
  w,
  h,
}: Readonly<ComponentProps<ScienceOfficerConfig>>) {
  const instrumentsRaw = useDataValue("data", "sci.instruments");
  const dataAmountRaw = useDataValue<number>("data", "sci.dataAmount");
  const instruments = parseInstruments(instrumentsRaw);
  const execute = useExecuteAction("data");
  const totalDataMits =
    typeof dataAmountRaw === "number" && Number.isFinite(dataAmountRaw)
      ? dataAmountRaw
      : 0;

  // M3 science/parts batch: science.lab is a NEW capability (no legacy
  // sci.instruments equivalent — the Mobile Processing Lab is a different
  // part from the crew-report/goo/barometer instruments sci.instruments
  // tracks), read independently of the instrument list above.
  const labRaw = useDataValue("data", "science.lab");
  const labs = parseLab(labRaw);
  const labStreamStatus = useDataStreamStatus("data", "science.lab");

  const rows = h ?? 8;
  const showSubtitle = rows >= 4;
  const showLab = rows >= 4;
  // Wide-short: flow the instrument groups into columns so they use the width
  // instead of a single stranded column.
  const isLandscape = getWidgetShape(w, h).shape === "landscape";

  if (instruments === null) {
    return (
      <Panel>
        <TitleRow>
          <PanelTitle>SCIENCE LAB</PanelTitle>
          <StreamStatusBadge status={labStreamStatus} />
        </TitleRow>
        {showSubtitle && (
          <PanelSubtitle>Awaiting instrument telemetry</PanelSubtitle>
        )}
        {showLab && <LabSection labs={labs} />}
      </Panel>
    );
  }

  if (instruments.length === 0) {
    return (
      <Panel>
        <TitleRow>
          <PanelTitle>SCIENCE LAB</PanelTitle>
          <StreamStatusBadge status={labStreamStatus} />
        </TitleRow>
        {showSubtitle && <PanelSubtitle>No instruments aboard</PanelSubtitle>}
        {showLab && <LabSection labs={labs} />}
      </Panel>
    );
  }

  // Group by expId so a vessel with three thermometers shows them in
  // one cluster rather than scattered.
  const grouped = groupByExpId(instruments);

  const totals = summarise(instruments);

  return (
    <Panel>
      <TitleRow>
        <PanelTitle>SCIENCE LAB</PanelTitle>
        <StreamStatusBadge status={labStreamStatus} />
      </TitleRow>
      {showSubtitle && (
        <PanelSubtitle role="status" aria-live="polite">
          {totals.hasData}/{totals.total} with data · {totals.deployed} deployed
          {totals.inoperable > 0 ? ` · ${totals.inoperable} inoperable` : ""}
          {totalDataMits > 0 && (
            <DataReadout title="Total stored science data (mits)">
              · {totalDataMits.toFixed(1)} mits
            </DataReadout>
          )}
        </PanelSubtitle>
      )}
      {showLab && <LabSection labs={labs} />}
      <Body $row={isLandscape}>
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
  const [pending, setPending] = useState<"deploy" | "transmit" | null>(null);

  useEffect(() => {
    if (!armed) return;
    const id = setTimeout(() => setArmed(false), ARM_TIMEOUT_MS);
    return () => clearTimeout(id);
  }, [armed]);

  // Clear the pending state once Telemachus reports the new instrument
  // state — `deployed`/`hasData` transitions are the success signal. Fall
  // back to a 5s safety timeout so an action that never lands doesn't
  // leave the button forever-busy.
  useEffect(() => {
    if (pending === null) return;
    if (pending === "deploy" && (instrument.deployed || instrument.hasData)) {
      setPending(null);
      return;
    }
    if (pending === "transmit" && !instrument.hasData) {
      setPending(null);
      return;
    }
    const id = setTimeout(() => setPending(null), 5_000);
    return () => clearTimeout(id);
  }, [pending, instrument.deployed, instrument.hasData]);

  // Inoperable instruments can't deploy or transmit. Hide the controls
  // entirely rather than greying them out — the INOPERABLE badge already
  // tells the operator why nothing's available.
  if (instrument.inoperable) return null;

  return (
    <Actions>
      {!instrument.deployed && !instrument.hasData && (
        <ActionButton
          type="button"
          disabled={pending === "deploy"}
          aria-busy={pending === "deploy"}
          onClick={() => {
            if (pending !== null) return;
            setPending("deploy");
            void execute(`sci.deploy[${instrument.partId}]`);
          }}
        >
          {pending === "deploy" ? (
            <>
              <Spinner size={10} /> Deploying…
            </>
          ) : (
            "Deploy"
          )}
        </ActionButton>
      )}
      {instrument.hasData &&
        (armed ? (
          <ConfirmTransmitButton
            type="button"
            disabled={pending === "transmit"}
            aria-busy={pending === "transmit"}
            onClick={() => {
              if (pending !== null) return;
              setArmed(false);
              setPending("transmit");
              void execute(`sci.transmit[${instrument.partId}]`);
            }}
          >
            {pending === "transmit" ? (
              <>
                <Spinner size={10} /> Transmitting…
              </>
            ) : (
              "Confirm transmit"
            )}
          </ConfirmTransmitButton>
        ) : (
          <ActionButton type="button" onClick={() => setArmed(true)}>
            Transmit
          </ActionButton>
        ))}
    </Actions>
  );
}

/**
 * Mobile Processing Lab status, from `science.lab`. Renders nothing when
 * there's no lab data yet (`null`, still loading) or the vessel carries no
 * lab (`[]`) — same "silent until real content" contract as the rest of the
 * widget, so a lab-less vessel's layout is unaffected.
 */
function LabSection({ labs }: { labs: LabStatus[] | null }) {
  if (labs === null || labs.length === 0) return null;
  return (
    <LabList>
      {labs.map((lab, i) => (
        // No stable id on a science.lab entry (unlike sci.instruments'
        // partId) — the list is never reordered within a render, so index
        // just disambiguates two labs that happen to share a partName.
        // biome-ignore lint/suspicious/noArrayIndexKey: no stable id on science.lab entries
        <LabRow key={`${lab.partName}-${i}`}>
          <LabHeader>
            <LabName>{lab.partName}</LabName>
            <LabBadges>
              <Badge $kind={lab.isOperational ? "data" : "inop"}>
                {lab.isOperational ? "OPERATIONAL" : "OFFLINE"}
              </Badge>
              {lab.processingData && <Badge $kind="deployed">PROCESSING</Badge>}
            </LabBadges>
          </LabHeader>
          <LabMeta>
            {lab.scientistCount !== null && (
              <span>
                {lab.scientistCount} scientist
                {lab.scientistCount === 1 ? "" : "s"}
              </span>
            )}
            {lab.dataStored !== null && lab.dataStorage !== null && (
              <span>
                {lab.dataStored.toFixed(0)}/{lab.dataStorage.toFixed(0)} data
              </span>
            )}
          </LabMeta>
        </LabRow>
      ))}
    </LabList>
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

const TitleRow = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  min-width: 0;
`;

const LabList = styled.div`
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-top: 4px;
  padding-bottom: 4px;
  border-bottom: 1px solid var(--color-surface-raised);
`;

const LabRow = styled.div`
  display: flex;
  flex-direction: column;
  gap: 2px;
`;

const LabHeader = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
`;

const LabName = styled.span`
  font-size: 12px;
  color: var(--color-text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex: 1;
  min-width: 0;
`;

const LabBadges = styled.span`
  display: inline-flex;
  gap: 4px;
  flex-shrink: 0;
`;

const LabMeta = styled.div`
  display: flex;
  gap: 8px;
  font-size: 11px;
  color: var(--color-text-muted);
  font-variant-numeric: tabular-nums;
`;

const Body = styled(ScrollArea)<{ $row?: boolean }>`
  flex: 1;
  min-height: 0;

  [data-scroll-area-inner] {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  /* Wide-short: groups flow into width-following columns. */
  ${(p) =>
    p.$row &&
    `[data-scroll-area-inner] {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
      align-content: start;
    }`}
`;

const Group = styled.div`
  display: flex;
  flex-direction: column;
  gap: 2px;
`;

const DataReadout = styled.span`
  color: var(--color-accent-fg);
  font-variant-numeric: tabular-nums;
  margin-left: 2px;
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
  display: inline-flex;
  align-items: center;
  gap: 4px;

  &:hover:not(:disabled) {
    color: var(--color-text-primary);
    border-color: var(--color-accent-fg);
  }

  &:disabled {
    cursor: not-allowed;
    opacity: 0.7;
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
  name: "Science Lab",
  description:
    "All science instruments on the current vessel grouped by experiment, plus Mobile Processing Lab status. Shows which instruments have stored data, which have already been deployed, which are one-shot, and which are inoperable.",
  tags: ["telemetry", "science"],
  defaultSize: { w: 6, h: 7 },
  minSize: { w: 3, h: 4 },
  component: ScienceOfficerComponent,
  dataRequirements: ["sci.instruments", "sci.dataAmount", "science.lab"],
  defaultConfig: {},
  actions: [],
  pushable: true,
  requires: ["flight"],
});

export { ScienceOfficerComponent };
