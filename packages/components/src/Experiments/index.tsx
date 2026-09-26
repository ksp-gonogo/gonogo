import type { ComponentProps, Contributed } from "@ksp-gonogo/core";
import {
  AugmentSlot,
  registerComponent,
  useContributions,
  useTelemetry,
} from "@ksp-gonogo/core";
import {
  readingOf,
  type StaleGrade,
  useCommand,
} from "@ksp-gonogo/sitrep-client";
import { stillTrue, value } from "@ksp-gonogo/sitrep-sdk";
import {
  Badge,
  Cluster,
  Divider,
  EmptyState,
  formatStreamStatus,
  Inline,
  Panel,
  RowName,
  Section,
  SectionTitle,
  Stack,
  severityFromStreamStatus,
  Text,
  Unit,
  usePanelDelay,
  useRowFilter,
} from "@ksp-gonogo/ui-kit";
import { Fragment } from "react";
import { heldGrade } from "../shared/heldGrade";
import { asQuantityish, magnitudeOf } from "../shared/magnitude";
import type { Instrument } from "./instrument";
import { ScienceExperimentRow } from "./ScienceExperimentRow";

type ExperimentsConfig = Record<string, never>;

export type { Instrument } from "./instrument";

/**
 * Slot context for `experiments.instrument`, the per-instrument-row slot. It
 * passes down the `Instrument` it sits beside so an augment can extend exactly
 * that row. A once-per-widget segment cannot express "once per instrument".
 */
export interface ExperimentsInstrumentSlotContext {
  /** The instrument the augmented row is rendering. */
  instrument: Instrument;
}

declare module "@ksp-gonogo/core" {
  interface SlotRegistry {
    "experiments.instrument": ExperimentsInstrumentSlotContext;
    // Mounted by `Panel`'s universal `actions` segment, not by this widget.
    "experiments.actions": Record<string, never>;
  }
}

// The sitrep-sdk copy of this merge lives in `mod/sitrep-sdk/src/api/slots.ts`.

/** Confirmed-none values for the science reads: present, and empty. */
const EMPTY_INSTRUMENTS = { instruments: [] as unknown[] };
const EMPTY_EXPERIMENTS = { experiments: [] as unknown[] };

/**
 * Two wire shapes land here, so each field reads through a fallback pair:
 * `partName`/`experimentId`/`dataIsCollectable` or `partTitle`/`expId`/`hasData`.
 * `partId` normalises to a string.
 */
export function parseInstruments(raw: unknown): Instrument[] | null {
  if (raw === null || raw === undefined) return null;
  if (!Array.isArray(raw)) return null;
  const out: Instrument[] = [];
  const entries: unknown[] = raw;
  for (const entry of entries) {
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

// The wire carries no vessel-wide data total, so it is summed here.
export function sumExperimentDataAmount(raw: unknown): number {
  if (!Array.isArray(raw)) return 0;
  let total = 0;
  const entries: unknown[] = raw;
  for (const entry of entries) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    const dataAmount = magnitudeOf(
      asQuantityish((entry as Record<string, unknown>).dataAmount),
    );
    if (dataAmount !== null) {
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
  /** Null when the provider could not read it; not the same as idle. */
  processingData: boolean | null;
  statusText: string | null;
  scientistCount: number | null;
  scienceRate: number | null;
  /** Null when the provider could not read it; OFFLINE is a diagnosis, not a failed read. */
  isOperational: boolean | null;
}

/** A wire bool with its absence kept as null. */
function asFlag(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

/**
 * Parses `science.lab`, one entry per lab part. A lab with everything at zero is
 * idle, not absent.
 */
export function parseLab(raw: unknown): LabStatus[] | null {
  if (raw === null || raw === undefined) return null;
  if (!Array.isArray(raw)) return null;
  const out: LabStatus[] = [];
  const entries: unknown[] = raw;
  for (const entry of entries) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    const e = entry as Record<string, unknown>;
    out.push({
      partName: typeof e.partName === "string" ? e.partName : "Lab",
      dataStored: magnitudeOf(asQuantityish(e.dataStored)),
      dataStorage: magnitudeOf(asQuantityish(e.dataStorage)),
      storedScience: magnitudeOf(asQuantityish(e.storedScience)),
      processingData: asFlag(e.processingData),
      statusText: typeof e.statusText === "string" ? e.statusText : null,
      scientistCount: magnitudeOf(asQuantityish(e.scientistCount)),
      scienceRate: magnitudeOf(asQuantityish(e.scienceRate)),
      isOperational: asFlag(e.isOperational),
    });
  }
  return out;
}

function ExperimentsComponent({
  w,
  h,
}: Readonly<ComponentProps<ExperimentsConfig>>) {
  // The parsers take `unknown`, so passing them a Reading instead of its value compiles and renders "no instruments".
  const instrumentsReading = useTelemetry("science.instruments");
  const instrumentsRaw = stillTrue(instrumentsReading, EMPTY_INSTRUMENTS);
  // A held list is kept and marked per row, and the row's controls go dead with it.
  const instrumentsHeld = heldGrade(instrumentsReading);
  const experimentsReading = useTelemetry("science.experiments");
  const experimentsRaw = stillTrue(experimentsReading, EMPTY_EXPERIMENTS);
  const instruments = parseInstruments(instrumentsRaw);
  const deployCmd = useCommand("science.experiment.deploy");
  const transmitCmd = useCommand("science.experiment.transmit");
  usePanelDelay(deployCmd);
  usePanelDelay(transmitCmd);
  const totalDataMits = sumExperimentDataAmount(experimentsRaw);

  const filter = useRowFilter({ placeholder: "Filter instruments..." });
  const labReading = useTelemetry("science.lab");
  const labRaw = stillTrue(labReading, undefined);
  const labs = parseLab(labRaw);
  const labHeld = heldGrade(labReading);

  const contributedInstruments = useContributions("experiments.instruments");

  const rows = h ?? 8;
  const cols = w ?? 6;
  const showSubtitle = rows >= 4;
  // Below four columns the lab's meta row wraps past the panel's bottom edge.
  const showLab = rows >= 4 && cols >= 4;

  const waiting = (message: string) => (
    <Panel
      panelTitle="EXPERIMENTS"
      compactTitle={["EXPTS"]}
      sections={[
        showSubtitle && (
          <Section key="empty">
            <EmptyState>{message}</EmptyState>
          </Section>
        ),
        showLab && (
          <Section key="lab">
            <LabSection labs={labs} heldGrade={labHeld} />
          </Section>
        ),
      ]}
    />
  );

  const contributed = ownContributed(contributedInstruments, instruments);

  // "Awaiting" and "none aboard" are claims about the whole vessel, contributed instruments included.
  if (instruments === null && contributed.length === 0)
    return waiting("Awaiting instrument telemetry");
  if ((instruments?.length ?? 0) === 0 && contributed.length === 0)
    return waiting("No instruments aboard");

  const matchesFilter = (inst: Instrument) =>
    filter.matches(`${inst.expId} ${inst.partTitle}`);

  // Filtered before grouping so a group that loses every instrument loses its heading too.
  const grouped = groupByExpId((instruments ?? []).filter(matchesFilter));
  const contributedGroups = groupContributed(contributed.filter(matchesFilter));

  // The vessel's totals, not the filter's, contributed instruments included.
  const totals = summarise([...(instruments ?? []), ...contributed]);

  const sectionNodes = grouped.map(({ expId, items }) => (
    <Section key={expId}>
      <SectionTitle>{expId || "(unknown)"}</SectionTitle>
      {/* A real list, because the row renders an `<li>`; an augment in the slot below must be a list item too. */}
      <Stack as="ul" style={INSTRUMENT_LIST}>
        {items.map((inst) => (
          <Fragment key={inst.partId}>
            <ScienceExperimentRow
              instrument={inst}
              deployCmd={deployCmd}
              transmitCmd={transmitCmd}
              heldGrade={instrumentsHeld}
            />
            <AugmentSlot
              name="experiments.instrument"
              props={{ instrument: inst }}
            />
          </Fragment>
        ))}
      </Stack>
    </Section>
  ));

  // Contributed rows sit in sections headed by their supplier, which is why they carry no stock commands.
  const contributedNodes = contributedGroups.map(({ ownerLabel, groups }) => (
    <Section
      key={`contributed-${ownerLabel}`}
      full
      gap="related-dense"
      title={ownerLabel}
    >
      {groups.map(({ expId, items }) => (
        <Stack key={expId}>
          <SectionTitle as="h5">{expId || "(unknown)"}</SectionTitle>
          <Stack as="ul" style={INSTRUMENT_LIST}>
            {items.map((inst) => (
              <ScienceExperimentRow key={inst.partId} instrument={inst} />
            ))}
          </Stack>
        </Stack>
      ))}
    </Section>
  ));

  return (
    <Panel
      panelTitle="EXPERIMENTS"
      compactTitle={["EXPTS"]}
      // The footer is pinned outside the scrolling body, so the filter stays in view.
      panelFooter={filter.control}
      sections={[
        showSubtitle && (
          <Section key="totals" full>
            <Text tone="muted" size="xs" role="status" aria-live="polite">
              {totals.hasData}/{totals.total} with data · {totals.deployed}{" "}
              deployed
              {totals.inoperable > 0
                ? ` · ${totals.inoperable} inoperable`
                : ""}
              {totalDataMits > 0 && (
                <Text spaced title="Total stored science data (mits)">
                  ·{" "}
                  <Unit
                    value={readingOf(experimentsReading, () =>
                      value("Mit", totalDataMits),
                    )}
                    decimals={1}
                  />
                </Text>
              )}
            </Text>
          </Section>
        ),
        showLab && (
          <Section key="lab" full>
            <LabSection labs={labs} heldGrade={labHeld} />
          </Section>
        ),
        sectionNodes.length === 0 && contributedNodes.length === 0 ? (
          <Section key="unmatched" full>
            <EmptyState>No instrument matches the filter.</EmptyState>
          </Section>
        ) : (
          sectionNodes
        ),
        contributedNodes,
      ]}
    />
  );
}

/** Mobile Processing Lab status. Renders nothing while loading or when the vessel carries no lab. */
function LabSection({
  labs,
  heldGrade: labGrade,
}: {
  labs: LabStatus[] | null;
  /** `science.lab` stopped arriving: every badge and count below is held. */
  heldGrade: StaleGrade | undefined;
}) {
  if (labs === null || labs.length === 0) return null;
  return (
    <>
      <Stack>
        {labs.map((lab, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: no stable id on science.lab entries
          <Stack key={`${lab.partName}-${i}`}>
            <Cluster>
              <RowName>{lab.partName}</RowName>
              <Inline>
                <Badge
                  severity={
                    lab.isOperational === null
                      ? "warning"
                      : lab.isOperational
                        ? "nominal"
                        : "critical"
                  }
                >
                  {lab.isOperational === null
                    ? "UNREAD"
                    : lab.isOperational
                      ? "OPERATIONAL"
                      : "OFFLINE"}
                </Badge>
                {lab.processingData === true && <Badge>PROCESSING</Badge>}
                {labGrade !== undefined && (
                  <Badge
                    severity={severityFromStreamStatus(labGrade)}
                    title={`${lab.partName}: lab state is no longer current`}
                  >
                    {formatStreamStatus(labGrade)}
                  </Badge>
                )}
              </Inline>
            </Cluster>
            <Inline>
              {lab.scientistCount !== null && (
                <Text tone="muted" size="xs">
                  {lab.scientistCount} scientist
                  {lab.scientistCount === 1 ? "" : "s"}
                </Text>
              )}
              {lab.dataStored !== null && lab.dataStorage !== null && (
                <Text tone="muted" size="xs">
                  {lab.dataStored.toFixed(0)}/{lab.dataStorage.toFixed(0)} data
                </Text>
              )}
            </Inline>
          </Stack>
        ))}
      </Stack>
      <Divider space="related-dense" />
    </>
  );
}

/** Strips the browser's list chrome so the `<ul>` is semantics only. */
const INSTRUMENT_LIST = { listStyle: "none", margin: 0, padding: 0 } as const;

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

/**
 * The contributed entries this widget draws: first per `partId` wins, and a
 * `partId` the stock list carries is dropped, since the stock row can be commanded.
 */
function ownContributed(
  entries: readonly Contributed<Instrument>[],
  stock: Instrument[] | null,
): Contributed<Instrument>[] {
  const seen = new Set((stock ?? []).map((inst) => inst.partId));
  const out: Contributed<Instrument>[] = [];
  for (const entry of entries) {
    if (seen.has(entry.partId)) continue;
    seen.add(entry.partId);
    out.push(entry);
  }
  return out;
}

interface ContributedInstrumentGroup {
  /** Who supplied these, for the section heading. */
  ownerLabel: string;
  groups: InstrumentGroup[];
}

/**
 * Contributed instruments by supplier, then by experiment, in first-seen order so
 * sections do not reshuffle. An ownerless contribution is labelled by its id.
 */
function groupContributed(
  entries: readonly Contributed<Instrument>[],
): ContributedInstrumentGroup[] {
  const byOwner = new Map<string, Contributed<Instrument>[]>();
  for (const entry of entries) {
    const label = entry.owner?.name ?? entry.contributionId;
    const list = byOwner.get(label);
    if (list) list.push(entry);
    else byOwner.set(label, [entry]);
  }
  return Array.from(byOwner.entries()).map(([ownerLabel, items]) => ({
    ownerLabel,
    groups: groupByExpId(items),
  }));
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

registerComponent<ExperimentsConfig>({
  id: "experiments",
  name: "Experiments",
  description:
    "All science instruments on the current vessel grouped by experiment, plus Mobile Processing Lab status. Shows which instruments have stored data, which have already been deployed, which are one-shot, and which are inoperable.",
  tags: ["telemetry", "science"],
  defaultSize: { w: 6, h: 7 },
  minSize: { w: 3, h: 4 },
  component: ExperimentsComponent,
  dataRequirements: [
    "science.instruments",
    "science.experiments",
    "science.lab",
  ],
  defaultConfig: {},
  actions: [],
  augmentSlots: ["experiments.instrument", "experiments.actions"],
  // Aggregation only runs for declared slots; an undeclared one silently reads empty.
  contributionSlots: ["experiments.instruments"],
  pushable: true,
  requires: ["flight"],
});

export { ExperimentsComponent };
