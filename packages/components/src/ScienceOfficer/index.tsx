import type { ComponentProps } from "@ksp-gonogo/core";
import {
  AugmentSlot,
  getWidgetShape,
  registerComponent,
  useDataStreamStatus,
  useDataValue,
  useExecuteAction,
} from "@ksp-gonogo/core";
import { StreamStatusBadge } from "@ksp-gonogo/ui";
import {
  Badge,
  Cluster,
  formatNumber,
  Panel,
  PanelSubtitle,
  PanelTitle,
  ScienceExperimentRow,
  ScrollArea,
  Section,
  SectionTitle,
  Value,
} from "@ksp-gonogo/ui-kit";
import { Fragment } from "react";
import styled from "styled-components";

type ScienceOfficerConfig = Record<string, never>;

export interface Instrument {
  partId: string;
  partTitle: string;
  expId: string;
  deployed: boolean;
  hasData: boolean;
  rerunnable: boolean;
  inoperable: boolean;
}

/**
 * Slot context for `science-officer.sections` — the per-instrument-row slot.
 * The row slot passes down the `Instrument` it sits beside so an augment
 * (e.g. an on-vessel-lab Kerbalism experiment table, the locked alternate to
 * `deployed-science`) can render a per-instrument extension scoped to
 * exactly that instrument (a slot-parameterised augment).
 */
export interface ScienceOfficerInstrumentSlotContext {
  /** The instrument the augmented row is rendering. */
  instrument: Instrument;
}

/**
 * Slot context for `science-officer.badges` — the header escape-hatch slot next
 * to the title. Deliberately broad: it carries the whole instrument list
 * (`null` while awaiting telemetry, `[]` for a vessel with no instruments)
 * plus the total stored science so a header augment can summarise
 * vessel-wide science state without re-reading the topics itself.
 */
export interface ScienceOfficerSlotContext {
  /** Parsed instrument list, or `null` before telemetry arrives. */
  instruments: Instrument[] | null;
  /** Total stored science data across all instruments, in mits. */
  dataAmount: number;
}

// Declaration-merge the slot ids → props types into core's `SlotRegistry`.
// Co-located here so parallel slot work on other widgets never collides on
// a shared central file. This is what types
// `registerAugment({ augments: "science-officer.sections", ... })` and
// `<AugmentSlot name="science-officer.sections" props={...} />` against the
// widget's own context types rather than the loose `Record<string, unknown>`
// fallback an unmerged slot id would receive.
declare module "@ksp-gonogo/core" {
  interface SlotRegistry {
    "science-officer.sections": ScienceOfficerInstrumentSlotContext;
    "science-officer.badges": ScienceOfficerSlotContext;
  }
}

/**
 * Parses `sci.instruments`. Two wire shapes land here:
 *
 * - Legacy Telemachus/GonogoTelemetry: `{ partId: number, partTitle, expId,
 *   deployed, hasData, rerunnable, inoperable }`.
 * - New SDK `science.instruments` (mapped onto this same widget-facing key
 *   via `map-topic.ts`):
 *   `mod/Sitrep.Host/ScienceViewProvider.cs`'s `InstrumentEntry` — `{
 *   partId: string (part.flightID.ToString()), partName, experimentId,
 *   title, deployed, inoperable, rerunnable, resettable, dataIsCollectable
 *   }`. `partName`/`experimentId`/`dataIsCollectable` are the new wire's
 *   renames of `partTitle`/`expId`/`hasData`
 *   (`Gonogo.KSP.KspHost.BuildScienceInstruments`'s doc comment confirms
 *   `dataIsCollectable` is the "instrument currently holds collectable
 *   data" flag `hasData` always meant); `title` (the experiment's own
 *   title, distinct from the part's) has no legacy analogue this widget
 *   reads. `partId` normalizes to a string either way — every consumer
 *   below only ever interpolates it into a key or an action-command
 *   string, never does numeric comparison on it.
 */
export function parseInstruments(raw: unknown): Instrument[] | null {
  if (raw === null || raw === undefined) return null;
  if (!Array.isArray(raw)) return null;
  const out: Instrument[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    const e = entry as Record<string, unknown>;
    const partId =
      typeof e.partId === "string"
        ? e.partId
        : typeof e.partId === "number"
          ? String(e.partId)
          : null;
    if (partId === null) continue;
    const partTitle =
      typeof e.partName === "string"
        ? e.partName
        : typeof e.partTitle === "string"
          ? e.partTitle
          : "Unknown part";
    const expId =
      typeof e.experimentId === "string"
        ? e.experimentId
        : typeof e.expId === "string"
          ? e.expId
          : "";
    const hasData =
      typeof e.dataIsCollectable === "boolean"
        ? e.dataIsCollectable
        : e.hasData === true;
    out.push({
      partId,
      partTitle,
      expId,
      deployed: e.deployed === true,
      hasData,
      rerunnable: e.rerunnable === true,
      inoperable: e.inoperable === true,
    });
  }
  return out;
}

/**
 * Sums `dataAmount` across every entry of `sci.experiments`/
 * `science.experiments` — the same vessel-wide aggregate the old
 * `sci.dataAmount` Telemachus key carried, derived instead of read as a
 * separate pre-aggregated field (no such field exists on the new wire).
 */
export function sumExperimentDataAmount(raw: unknown): number {
  if (!Array.isArray(raw)) return 0;
  let total = 0;
  for (const entry of raw) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    const dataAmount = (entry as Record<string, unknown>).dataAmount;
    if (typeof dataAmount === "number" && Number.isFinite(dataAmount)) {
      total += dataAmount;
    }
  }
  return total;
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
 * Parses `science.lab` (`mod/Sitrep.Host/ScienceViewProvider.cs`'s
 * `BuildLab`) — a NEW capability, no legacy Telemachus/GonogoTelemetry
 * analogue existed for Mobile Processing Lab status, so this is a straight
 * whole-topic raw-array read (same `parts.power`/`parts.robotics`
 * "key == topic" precedent in `map-topic.ts`), not a migration of an
 * existing `sci.*` field. Each entry is a lab part on the active vessel; an
 * idle-but-operational lab (crewed, no data loaded) is a normal, valid
 * state — `dataStored`/`processingData`/`scienceRate` all sitting at zero
 * doesn't mean "no lab", it means "lab with nothing to process yet".
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
  // sci.instruments -> science.instruments is mapped (map-topic.ts) — this
  // existing useDataValue("data", "sci.instruments") call rides the stream
  // via the mapTopic shim with zero code change here; parseInstruments above
  // is what actually changed (accepts both wire shapes). sci.deploy[...]/
  // sci.transmit[...] (the spend commands) now have a command home too
  // (map-command.ts's science.experiment.deploy/transmit) and route through
  // the stream the same way — no code change needed here either, since
  // execute() already goes through the shim regardless of route.
  const instrumentsRaw = useDataValue("data", "sci.instruments");
  // sci.dataAmount stays gapped on the wire (no pre-aggregated field) —
  // derive the vessel-wide total client-side from the same already-migrated
  // sci.experiments read ScienceBench uses (sci.experiments ->
  // science.experiments, map-topic.ts), same aggregate semantics as the old
  // Telemachus key ("Total science data (mits)", telemachusMeta.ts).
  const experimentsRaw = useDataValue("data", "sci.experiments");
  const instruments = parseInstruments(instrumentsRaw);
  const execute = useExecuteAction("data");
  const totalDataMits = sumExperimentDataAmount(experimentsRaw);

  // science.lab is a NEW capability (no legacy sci.instruments equivalent —
  // the Mobile Processing Lab is a different part from the crew-report/goo/
  // barometer instruments sci.instruments tracks), read independently of
  // the instrument list above.
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
        <Cluster>
          <PanelTitle>SCIENCE LAB</PanelTitle>
          <StreamStatusBadge status={labStreamStatus} />
        </Cluster>
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
        <Cluster>
          <PanelTitle>SCIENCE LAB</PanelTitle>
          <StreamStatusBadge status={labStreamStatus} />
        </Cluster>
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
      <Cluster>
        <PanelTitle>SCIENCE LAB</PanelTitle>
        <StreamStatusBadge status={labStreamStatus} />
        {/* Header escape-hatch slot — a broad badge/summary augment
            composes next to the title. Empty (renders nothing) until an Uplink
            registers into it. */}
        <AugmentSlot
          name="science-officer.badges"
          props={{ instruments, dataAmount: totalDataMits }}
        />
      </Cluster>
      {showSubtitle && (
        <PanelSubtitle role="status" aria-live="polite">
          {totals.hasData}/{totals.total} with data · {totals.deployed} deployed
          {totals.inoperable > 0 ? ` · ${totals.inoperable} inoperable` : ""}
          {totalDataMits > 0 && (
            <Value spaced title="Total stored science data (mits)">
              · {formatNumber(totalDataMits, { decimals: 1 })} mits
            </Value>
          )}
        </PanelSubtitle>
      )}
      {showLab && <LabSection labs={labs} />}
      <Body $row={isLandscape}>
        {grouped.map(({ expId, items }) => (
          <Section key={expId}>
            <SectionTitle>{expId || "(unknown)"}</SectionTitle>
            <InstrumentList>
              {items.map((inst) => (
                <Fragment key={inst.partId}>
                  <ScienceExperimentRow
                    instrument={inst}
                    onDeploy={(partId) => void execute(`sci.deploy[${partId}]`)}
                    onTransmit={(partId) =>
                      void execute(`sci.transmit[${partId}]`)
                    }
                  />
                  {/* Per-instrument section slot — passes this instrument
                      down so an on-vessel-lab augment can extend the row.
                      Empty until an Uplink registers into it. Kept here in
                      the widget rather than inside the kit row: the slot is
                      a framework concern and the row stays
                      data/framework-free. */}
                  <AugmentSlot
                    name="science-officer.sections"
                    props={{ instrument: inst }}
                  />
                </Fragment>
              ))}
            </InstrumentList>
          </Section>
        ))}
      </Body>
    </Panel>
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
              <Badge tone={lab.isOperational ? "go" : "nogo"}>
                {lab.isOperational ? "OPERATIONAL" : "OFFLINE"}
              </Badge>
              {lab.processingData && <Badge tone="neutral">PROCESSING</Badge>}
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

// `InstrumentList` resets `<ul>` browser chrome (list-style/margin/padding)
// and stacks the per-instrument rows with the same 2px gap the kit's
// `Section` uses one level up — the kit has no `<ul>`-reset primitive yet
// (only the row itself is covered, not the list it sits in), so this stays
// local rather than risk the visual-gate diff of dropping list semantics
// altogether.
const InstrumentList = styled.ul`
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
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
  dataRequirements: ["sci.instruments", "sci.experiments", "science.lab"],
  defaultConfig: {},
  actions: [],
  augmentSlots: ["science-officer.sections", "science-officer.badges"],
  pushable: true,
  requires: ["flight"],
});

export { ScienceOfficerComponent };
