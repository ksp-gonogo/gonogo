import type { ComponentProps } from "@ksp-gonogo/core";
import {
  AugmentSlot,
  getWidgetShape,
  registerComponent,
  useTelemetry,
} from "@ksp-gonogo/core";
import { type Reading, useCommand } from "@ksp-gonogo/sitrep-client";
import { value } from "@ksp-gonogo/sitrep-sdk";
import {
  Badge,
  Cluster,
  Divider,
  EmptyState,
  Grid,
  Inline,
  Panel,
  RowName,
  ScienceExperimentRow,
  ScrollArea,
  Section,
  SectionTitle,
  Stack,
  Text,
  Unit,
  usePanelDelay,
  useRowFilter,
} from "@ksp-gonogo/ui-kit";
import { Fragment } from "react";
import { magnitudeOf, type Quantityish } from "../shared/magnitude";

type ExperimentsConfig = Record<string, never>;

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
 * Slot context for `experiments.instrument`: the per-instrument-row slot.
 * Named for the row it addresses, not for a segment: a once-per-widget
 * segment (`sections`, `actions`) cannot express "once per instrument", so
 * this stays a widget-authored slot and must not borrow a segment's name.
 * The row slot passes down the `Instrument` it sits beside so an augment
 * (e.g. an on-vessel-lab Kerbalism experiment table, the locked alternate to
 * `deployed-science`) can render a per-instrument extension scoped to
 * exactly that instrument (a slot-parameterised augment).
 */
export interface ExperimentsInstrumentSlotContext {
  /** The instrument the augmented row is rendering. */
  instrument: Instrument;
}

// `experiments.actions` is the framework's universal header segment, mounted by
// `Panel` for every widget, so this widget declares no props type for it: a
// universal segment is propless. It was `science-officer.badges` with a context
// carrying the instrument list and total science; the one binder ignored both
// (`_props`) and reads its own Topic instead, which is what an augment is for.

// Declaration-merge the slot ids → props types into core's `SlotRegistry`.
// Co-located here so parallel slot work on other widgets never collides on
// a shared central file. This is what types
// `registerAugment({ augments: "experiments.instrument", ... })` and
// `<AugmentSlot name="experiments.instrument" props={...} />` against the
// widget's own context types rather than the loose `Record<string, unknown>`
// fallback an unmerged slot id would receive.
declare module "@ksp-gonogo/core" {
  interface SlotRegistry {
    "experiments.instrument": ExperimentsInstrumentSlotContext;
    // Mounted by `Panel`'s universal `actions` segment, not by this widget.
    "experiments.actions": Record<string, never>;
  }
}

// The facade-sealed-client copy of this merge lives in `mod/sitrep-sdk/src/api/slots.ts` rather than as a second `declare module "@ksp-gonogo/sitrep-sdk"` block here; MapView's identical comment and that module's header both say why.

/** Confirmed-none tombstones for the three science reads: present, and empty. */
const EMPTY_INSTRUMENTS = { instruments: [] as unknown[] };
const EMPTY_EXPERIMENTS = { experiments: [] as unknown[] };

/**
 * The value of a FACT: something that stays true until an event changes it, and no
 * event can reach us down a link that is not delivering. `whenConfirmedNothing` is
 * what an `absent` tombstone means here, which is a different answer from `pending`
 * and must not collapse into it.
 */
function stillTrue<T, A>(
  reading: Reading<T>,
  whenConfirmedNothing: A,
): T | A | undefined {
  if (reading.state === "observed") return reading.value;
  if (reading.state === "stale") return reading.value;
  if (reading.state === "reckonable") return reading.value;
  if (reading.state === "absent") return whenConfirmedNothing;
  return undefined;
}

/**
 * Two wire shapes for the instrument list land here, so every field reads
 * through a fallback pair. `ScienceViewProvider`'s `InstrumentEntry` names them
 * `partName`, `experimentId` and `dataIsCollectable`; the older shape called the
 * same three `partTitle`, `expId` and `hasData`, and `dataIsCollectable` carries
 * the "instrument currently holds collectable data" meaning `hasData` always
 * had.
 *
 * `partId` arrives as a number in one shape and a string in the other and
 * normalises to a string, which is safe because every consumer below only ever
 * interpolates it into a key or a command string and never compares it
 * numerically.
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

// Sums `dataAmount` across every entry of `science.experiments`, deriving the vessel-wide aggregate rather than reading it, because the wire carries no pre-aggregated field.
export function sumExperimentDataAmount(raw: unknown): number {
  if (!Array.isArray(raw)) return 0;
  let total = 0;
  for (const entry of raw) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    const dataAmount = magnitudeOf(
      (entry as Record<string, unknown>).dataAmount as Quantityish,
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
  processingData: boolean;
  statusText: string | null;
  scientistCount: number | null;
  scienceRate: number | null;
  isOperational: boolean;
}

/**
 * Parses `science.lab`, built by `ScienceViewProvider.BuildLab`, as a
 * whole-topic raw-array read on the same "key is the topic" footing as
 * `parts.power` and `parts.robotics`.
 *
 * Each entry is a lab part on the active vessel, and an idle-but-operational lab
 * (crewed, nothing loaded) is a normal state: `dataStored`, `processingData` and
 * `scienceRate` all at zero means a lab with nothing to process yet, not the
 * absence of a lab.
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
      dataStored: magnitudeOf(e.dataStored as Quantityish),
      dataStorage: magnitudeOf(e.dataStorage as Quantityish),
      storedScience: magnitudeOf(e.storedScience as Quantityish),
      processingData: e.processingData === true,
      statusText: typeof e.statusText === "string" ? e.statusText : null,
      scientistCount: magnitudeOf(e.scientistCount as Quantityish),
      scienceRate: magnitudeOf(e.scienceRate as Quantityish),
      isOperational: e.isOperational === true,
    });
  }
  return out;
}

function ExperimentsComponent({
  w,
  h,
}: Readonly<ComponentProps<ExperimentsConfig>>) {
  // Deploy and transmit are dispatched to the craft and so are subject to signal delay, which is why both ride `useCommand`.
  /**
   * These three feed parsers typed `(raw: unknown)`, so the migration produced no
   * type error here at all: a `Reading` object went into `parseInstruments`, failed
   * its shape checks, and the widget rendered as though the vessel carried no
   * instruments. `tsc` cannot see this class, which is why it is called out here.
   *
   * All three are facts. An instrument list, a science archive and a lab's state
   * change when an event changes them, and a confirmed-none is an empty list rather
   * than a wait.
   */
  const instrumentsRaw = stillTrue(
    useTelemetry("science.instruments"),
    EMPTY_INSTRUMENTS,
  );
  // No pre-aggregated data field on the wire, so the vessel-wide total is
  // derived client-side from the same `science.experiments` Topic ScienceData
  // reads, on the same aggregate semantics.
  const experimentsRaw = stillTrue(
    useTelemetry("science.experiments"),
    EMPTY_EXPERIMENTS,
  );
  const instruments = parseInstruments(instrumentsRaw);
  const deployCmd = useCommand("science.experiment.deploy");
  const transmitCmd = useCommand("science.experiment.transmit");
  usePanelDelay(deployCmd);
  usePanelDelay(transmitCmd);
  const totalDataMits = sumExperimentDataAmount(experimentsRaw);

  /**
   * `science.lab` is read independently of the instrument list above, because
   * the Mobile Processing Lab is a different part from the crew-report, goo and
   * barometer instruments `science.instruments` tracks.
   *
   * Declared with the other reads so it sits above every early return: a hook
   * after a conditional return is a hooks-order bug waiting to happen.
   */
  const filter = useRowFilter({ placeholder: "Filter instruments…" });
  const labRaw = stillTrue(useTelemetry("science.lab"), undefined);
  const labs = parseLab(labRaw);

  const rows = h ?? 8;
  const cols = w ?? 6;
  const showSubtitle = rows >= 4;
  // At the narrowest tested width (min-3x4, cols === 3) the lab name column
  // has nothing left after the status badge claims its `flex-shrink: 0`
  // width, and the freed-up wrapped line pushes the meta row (scientist
  // count / data amount) past Panel's overflow:hidden bottom edge, clipping
  // it mid-glyph. Require the same cols >= 4 floor as the header badge above
  // rather than just a row count.
  const showLab = rows >= 4 && cols >= 4;
  // Wide-short: flow the instrument groups into columns so they use the width
  // instead of a single stranded column.
  const isLandscape = getWidgetShape(w, h).shape === "landscape";

  if (instruments === null) {
    return (
      <Panel panelTitle="EXPERIMENTS">
        {showSubtitle && <EmptyState>Awaiting instrument telemetry</EmptyState>}
        {showLab && <LabSection labs={labs} />}
      </Panel>
    );
  }

  if (instruments.length === 0) {
    return (
      <Panel panelTitle="EXPERIMENTS">
        {showSubtitle && <EmptyState>No instruments aboard</EmptyState>}
        {showLab && <LabSection labs={labs} />}
      </Panel>
    );
  }

  // Group by expId so a vessel with three thermometers shows them in
  // one cluster rather than scattered.
  // Filter before grouping so a group that loses every instrument disappears
  // with its heading, rather than leaving an empty section behind.
  const shown = instruments.filter((inst) =>
    filter.matches(`${inst.expId} ${inst.partTitle}`),
  );
  const grouped = groupByExpId(shown);

  const totals = summarise(instruments);

  const sectionNodes = grouped.map(({ expId, items }) => (
    <Section key={expId}>
      <SectionTitle>{expId || "(unknown)"}</SectionTitle>
      {/* `ScienceExperimentRow` is a kit `Row`, which renders an `<li>`, so
          the container has to be a real list or every instrument row is an
          orphaned list item. An augment registered into the per-instrument
          slot below renders as a sibling inside this `<ul>` and would need
          to be a list item itself; nothing registers there yet, and the axe
          sweep over this widget's fixtures is what would say so. */}
      <Stack gap="xs" as="ul" style={INSTRUMENT_LIST}>
        {items.map((inst) => (
          <Fragment key={inst.partId}>
            <ScienceExperimentRow
              instrument={inst}
              deployCmd={deployCmd}
              transmitCmd={transmitCmd}
            />
            {/* Per-instrument section slot: passes this instrument
                down so an on-vessel-lab augment can extend the row.
                Empty until an Uplink registers into it. Kept here in
                the widget rather than inside the kit row: the slot is
                a framework concern and the row stays
                data/framework-free. */}
            <AugmentSlot
              name="experiments.instrument"
              props={{ instrument: inst }}
            />
          </Fragment>
        ))}
      </Stack>
    </Section>
  ));

  return (
    /* The header escape-hatch slot is `Panel`'s universal `actions` segment,
       so there is nothing to render here: an augment composing next to the
       title binds `experiments.actions` and `Panel` places it. */
    <Panel panelTitle="EXPERIMENTS">
      {showSubtitle && (
        <Text tone="muted" size="xs" role="status" aria-live="polite">
          {totals.hasData}/{totals.total} with data · {totals.deployed} deployed
          {totals.inoperable > 0 ? ` · ${totals.inoperable} inoperable` : ""}
          {totalDataMits > 0 && (
            <Text spaced title="Total stored science data (mits)">
              · <Unit value={value("Mit", totalDataMits)} decimals={1} />
            </Text>
          )}
        </Text>
      )}
      {showLab && <LabSection labs={labs} />}
      <ScrollArea>
        {sectionNodes.length === 0 ? (
          <EmptyState>No instrument matches the filter.</EmptyState>
        ) : isLandscape ? (
          <Grid minColWidth="200px" gap="md">
            {sectionNodes}
          </Grid>
        ) : (
          <Stack gap="md">{sectionNodes}</Stack>
        )}
      </ScrollArea>
      {filter.control}
    </Panel>
  );
}

/**
 * Mobile Processing Lab status, from `science.lab`. Renders nothing when
 * there's no lab data yet (`null`, still loading) or the vessel carries no
 * lab (`[]`): same "silent until real content" contract as the rest of the
 * widget, so a lab-less vessel's layout is unaffected.
 */
function LabSection({ labs }: { labs: LabStatus[] | null }) {
  if (labs === null || labs.length === 0) return null;
  return (
    <>
      <Stack gap="sm">
        {labs.map((lab, i) => (
          // A `science.lab` entry carries no stable id, unlike an instrument's `partId`. The list is never reordered within a render, so the index only has to disambiguate two labs that happen to share a `partName`.
          // biome-ignore lint/suspicious/noArrayIndexKey: no stable id on science.lab entries
          <Stack gap="xs" key={`${lab.partName}-${i}`}>
            <Cluster gap="md">
              <RowName>{lab.partName}</RowName>
              <Inline gap="sm">
                <Badge severity={lab.isOperational ? "nominal" : "critical"}>
                  {lab.isOperational ? "OPERATIONAL" : "OFFLINE"}
                </Badge>
                {lab.processingData && <Badge>PROCESSING</Badge>}
              </Inline>
            </Cluster>
            <Inline gap="md">
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
      <Divider space="sm" />
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
  pushable: true,
  requires: ["flight"],
});

export { ExperimentsComponent };
