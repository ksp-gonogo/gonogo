import type { ComponentProps } from "@ksp-gonogo/core";
import {
  AugmentSlot,
  registerComponent,
  useContributions,
  useTelemetry,
} from "@ksp-gonogo/core";
import {
  readingOf,
  useCommand,
  useTransmissions,
} from "@ksp-gonogo/sitrep-client";
import {
  type ScienceTransmission,
  stillTrue,
  value,
} from "@ksp-gonogo/sitrep-sdk";
import {
  EmptyState,
  Panel,
  Section,
  Stack,
  Text,
  Tooltip,
  Unit,
  useRailEntry,
  useRowFilter,
} from "@ksp-gonogo/ui-kit";
import { Fragment } from "react";
import { heldGrade } from "../shared/heldGrade";
import {
  byExperiment,
  groupContributed,
  ownContributed,
  summarise,
} from "./grouping";
import type { Instrument } from "./instrument";
import { LabSection } from "./LabSection";
import {
  EMPTY_EXPERIMENTS,
  EMPTY_INSTRUMENTS,
  parseInstruments,
  parseLab,
  sumExperimentDataAmount,
} from "./parse";
import { ScienceExperimentRow } from "./ScienceExperimentRow";

export type { ExperimentsInstrumentSlotContext } from "@ksp-gonogo/sitrep-sdk";

type ExperimentsConfig = Record<string, never>;

export type { Instrument } from "./instrument";
export {
  type LabStatus,
  parseInstruments,
  parseLab,
  sumExperimentDataAmount,
} from "./parse";

// The sitrep-sdk copy of this merge lives in `mod/sitrep-sdk/src/api/slots.ts`.

/** Strips the browser's list chrome so the `<ul>` is semantics only. */
const INSTRUMENT_LIST = { listStyle: "none", margin: 0, padding: 0 } as const;

function ExperimentsComponent({
  w,
  h,
}: Readonly<ComponentProps<ExperimentsConfig>>) {
  // The parsers take `unknown`, so passing them a Reading instead of its value compiles and renders "no instruments".
  const instrumentsReading = useTelemetry("science.instruments");
  const instrumentsRaw = stillTrue(instrumentsReading, EMPTY_INSTRUMENTS);
  // A held list is kept and marked per row; the controls stay live and each command checks its instrument.
  const instrumentsHeld = heldGrade(instrumentsReading);
  const experimentsReading = useTelemetry("science.experiments");
  const experimentsRaw = stillTrue(experimentsReading, EMPTY_EXPERIMENTS);
  const instruments = parseInstruments(instrumentsRaw);
  const deployCmd = useCommand("science.experiment.deploy");
  const transmitCmd = useCommand("science.experiment.transmit");
  const transmissions = useTransmissions();
  useRailEntry(transmissions);
  // The result has left the craft once its last packet has, and lands one light-time later.
  const onTransmitted = (t: ScienceTransmission) =>
    transmissions.expect({
      label: t.title || t.subjectId,
      subject: t.subjectId,
      sentAt: t.startedAt.plus(t.streamSeconds),
    });
  const totalDataMits = sumExperimentDataAmount(experimentsRaw);

  const filter = useRowFilter({ placeholder: "Filter instruments..." });
  const labReading = useTelemetry("science.lab");
  const labRaw = stillTrue(labReading, undefined);
  const allLabs = parseLab(labRaw);
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
            <LabSection labs={allLabs} heldGrade={labHeld} />
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

  // The lab is searched by its part name like any instrument, so the filter covers every row below it.
  const labs =
    allLabs?.filter((lab) => filter.matches(lab.partName)) ?? allLabs;

  const matchesFilter = (inst: Instrument) =>
    filter.matches(`${inst.expId} ${inst.partTitle}`);

  // Each card names its experiment: a heading per experiment held one card apiece on a typical vessel.
  const listed = byExperiment((instruments ?? []).filter(matchesFilter));
  const contributedGroups = groupContributed(contributed.filter(matchesFilter));

  // The vessel's totals, not the filter's, contributed instruments included.
  const totals = summarise([...(instruments ?? []), ...contributed]);

  const sectionNodes =
    listed.length === 0 ? null : (
      <Section key="instruments" full>
        {/* A real list, because the row renders an `<li>`; an augment in the slot below must be a list item too. */}
        <Stack as="ul" style={INSTRUMENT_LIST}>
          {listed.map((inst) => (
            <Fragment key={inst.partId}>
              <ScienceExperimentRow
                instrument={inst}
                deployCmd={deployCmd}
                transmitCmd={transmitCmd}
                onTransmitted={onTransmitted}
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
    );

  // Contributed rows sit in sections headed by their supplier, which is why they carry no stock commands.
  const contributedNodes = contributedGroups.map(({ ownerLabel, items }) => (
    <Section
      key={`contributed-${ownerLabel}`}
      full
      gap="related-dense"
      title={ownerLabel}
    >
      <Stack as="ul" style={INSTRUMENT_LIST}>
        {items.map((inst) => (
          <ScienceExperimentRow
            key={inst.partId}
            instrument={inst}
            heldGrade={heldGrade(inst.reading)}
          />
        ))}
      </Stack>
    </Section>
  ));

  return (
    <Panel
      panelTitle="EXPERIMENTS"
      compactTitle={["EXPTS"]}
      panelFilter={filter}
      sections={[
        showSubtitle && (
          <Section key="totals" full>
            <Text level="muted" size="xs" role="status" aria-live="polite">
              {totals.hasData}/{totals.total} with data · {totals.deployed}{" "}
              deployed
              {totals.inoperable > 0
                ? ` · ${totals.inoperable} inoperable`
                : ""}
              {totalDataMits > 0 && (
                <Tooltip text="Total stored science data (mits)" focusable>
                  <Text spaced>
                    ·{" "}
                    <Unit
                      value={readingOf(experimentsReading, () =>
                        value("Mit", totalDataMits),
                      )}
                      decimals={1}
                    />
                  </Text>
                </Tooltip>
              )}
            </Text>
          </Section>
        ),
        showLab && (
          <Section key="lab" full>
            <LabSection labs={labs} heldGrade={labHeld} />
          </Section>
        ),
        sectionNodes === null && contributedNodes.length === 0 ? (
          <Section key="unmatched" full>
            <EmptyState>No instrument matches the filter</EmptyState>
          </Section>
        ) : (
          sectionNodes
        ),
        contributedNodes,
      ]}
    />
  );
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
