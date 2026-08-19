import type { ComponentProps } from "@ksp-gonogo/core";
import {
  registerComponent,
  useDataStreamStatus,
  useGameContext,
  useTelemetry,
} from "@ksp-gonogo/core";
import {
  type Reading,
  useStream,
  type VesselState,
} from "@ksp-gonogo/sitrep-client";
import { StreamStatusBadge, type TabDescriptor, Tabs } from "@ksp-gonogo/ui";
import { Inline, Panel, Text } from "@ksp-gonogo/ui-kit";
import { useState } from "react";
import { magnitudeOf, type Quantityish } from "../shared/magnitude";
import { AboardTab } from "./AboardTab";
import { ArchiveTab } from "./ArchiveTab";
import {
  fixed,
  groupArchiveByExperiment,
  parseArchive,
  parseExperimentBreakdown,
  parseExperiments,
} from "./parsers";

type ScienceDataConfig = Record<string, never>;

/**
 * The value a VERDICT may be drawn from: current, or modelled forward to the frame.
 * A stale reading gives nothing, because a judgement cannot be dated: the operator
 * reads a band or a pill as the situation NOW.
 */
function judgeable<T>(reading: Reading<T>): T | undefined {
  if (reading.state === "observed") return reading.value;
  if (reading.state === "reckonable") return reading.reckoned.value;
  return undefined;
}

/** Whether a reading went stale, as opposed to never having arrived. */
function notCurrent<T>(reading: Reading<T>): boolean {
  return reading.state === "stale";
}

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

function ScienceDataComponent({
  w,
}: Readonly<ComponentProps<ScienceDataConfig>>) {
  const [tab, setTab] = useState<"aboard" | "archive">("aboard");

  // Partial-gate rather than a hard `requires: ["flight"]`: the header SCI
  // readout stays meaningful at the Space Center (banked science persists
  // across vessels), and so does the Archive tab (career-wide TrueNow ground
  // truth). Only Aboard is vessel-scoped, and with nothing flying it has no
  // vessel to be about, so the tab itself turns off.
  const { inFlight, hasGameSignal, isCareerLike } = useGameContext();
  const noVessel = hasGameSignal && !inFlight;

  const vesselState = useStream<VesselState>("vessel.state");
  const body = vesselState?.parentBodyName ?? undefined;
  const situation = vesselState?.situationName ?? undefined;
  /**
   * The locale is the one reading here that drifts on its own. It names the
   * biome a sample would be taken from, and a vessel that is flying moves
   * between biomes with nobody touching anything, so a held locale states the
   * wrong provenance for the science on the line beside it. Withheld when it
   * stops being current, with `surfaceNotCurrent` carrying the reason through
   * to the situation line: an omitted locale is what a vessel with no biome
   * reading also shows, and the two must not read alike.
   */
  const surfaceReading = useTelemetry("vessel.surface");
  const surface = judgeable(surfaceReading);
  const surfaceNotCurrent = notCurrent(surfaceReading);
  const landedAt = surface?.landedAt;
  // Live biome from `ScienceUtil.GetExperimentBiome`, works in flight +
  // space scenes (e.g. "FlyingHigh", "Splashed - OceanWater"), unlike
  // `landedAt` which is only populated on the surface. Falls back to
  // landedAt when blank.
  const liveBiome = surface?.biome;
  const situationLocale = liveBiome ?? landedAt ?? "";

  /**
   * All three ledgers are facts. A record aboard appears when a crew runs an
   * experiment and leaves when they transmit or discard it, and the R&D archive
   * moves on recovery: events, every one, and no event reaches us down a link
   * that is not delivering. So the last ledger received is still the ledger,
   * and blanking it would report an empty vessel and a Sandbox save on a career
   * that is demonstrably carrying science.
   */
  const experimentsRaw = stillTrue(
    useTelemetry("science.experiments"),
    undefined,
  );
  const breakdownRaw = stillTrue(
    useTelemetry("science.experimentBreakdown"),
    undefined,
  );
  const archiveRaw = stillTrue(useTelemetry("science.archive"), undefined);
  const breakdownStreamStatus = useDataStreamStatus(
    "data",
    "science.experimentBreakdown",
  );

  const experiments = parseExperiments(experimentsRaw);
  const breakdown = parseExperimentBreakdown(breakdownRaw);
  const archive = parseArchive(archiveRaw);
  // No pre-aggregated fields on the wire, derive both from the same
  // already-parsed experiments array.
  const sciCount = experiments ? experiments.length : undefined;
  // Summed only when at least one entry actually carries a figure. A provider
  // whose model is not mits leaves `dataAmount` null on every entry (Kerbalism
  // stores megabytes and says so through `valueModel`), and summing those to a
  // confident "0.0 mits collected" states something false about a vessel that
  // may be carrying plenty. No figure means the line simply omits it.
  const collected = experiments?.filter((e) => e.dataAmount !== null) ?? [];
  const sciDataAmount = collected.length
    ? collected.reduce((sum, e) => sum + (e.dataAmount ?? 0), 0)
    : undefined;

  // Banked science is a balance, not a measurement: it moves when science is
  // transmitted, recovered or spent, and it cannot drift between those. This
  // widget only reports it, it arms nothing that spends it (TechTree does, and
  // reads the same field through `judgeable` for that reason), so the last
  // balance received is still the balance and the panel's stream badge beside
  // it already tells the operator how fresh the panel is.
  const careerScience = magnitudeOf(
    stillTrue(useTelemetry("career.status"), undefined)?.economy
      ?.science as Quantityish,
  );

  const archiveGroups = archive ? groupArchiveByExperiment(archive) : [];

  const cols = w ?? 8;
  const compact = cols < 5;

  const tabs: TabDescriptor[] = [
    {
      id: "aboard",
      label: "Aboard",
      // Off, not dimmed: a dimmed panel still invites a click and then
      // explains itself. With nothing flying there is no onboard ledger to
      // show, so the tab says so by being unselectable and Tabs lands the
      // operator on Archive, which does have something to say.
      disabled: noVessel,
      content: (
        <AboardTab
          body={body}
          situation={situation}
          situationLocale={situationLocale}
          localeNotCurrent={surfaceNotCurrent}
          breakdown={breakdown}
          experiments={experiments}
          sciCount={sciCount}
          sciDataAmount={sciDataAmount}
          compact={compact}
        />
      ),
    },
    {
      id: "archive",
      label: "Archive",
      // Never dimmed by dimNonFlight: this is career-wide TrueNow ground
      // truth, meaningful at the Space Center with nothing flying, unlike
      // Aboard's active-vessel onboard ledger.
      content: <ArchiveTab archive={archive} groups={archiveGroups} />,
    },
  ];

  return (
    <Panel
      panelTitle="SCIENCE DATA"
      panelAside={
        <Inline gap="sm">
          {isCareerLike && careerScience !== null && (
            <Text size="sm" title="Science banked">
              {fixed(careerScience, 0)} SCI
            </Text>
          )}
          <StreamStatusBadge status={breakdownStreamStatus} />
        </Inline>
      }
    >
      <Tabs
        tabs={tabs}
        // Kept in step with the disabled tab so this component's own state
        // never disagrees with the panel on screen. Tabs falls through on its
        // own too; this is what stops `tab` going stale behind it.
        activeId={noVessel && tab === "aboard" ? "archive" : tab}
        onChange={(id) => setTab(id as "aboard" | "archive")}
      />
    </Panel>
  );
}

// ---------------------------------------------------------------------------
// The `science-data.aboard-row` slot contract
//
// A per-subject section slot, directly below each Aboard breakdown row: the
// generic home for a File Manager-style enrichment (files/samples, drive
// capacity, transmit/delete/flag controls). This widget carries no drive
// concept itself, Kerbalism is the only model that has one; a stock save
// leaves the slot unbound and the row renders exactly as it does today. The
// `subjectId` is identity only, matching `crew-status.survival`'s per-row
// keying: the filling augment reads its own data (`science.experiments`)
// and joins by this id rather than being handed the row's fields directly.
// ---------------------------------------------------------------------------

/** Props passed to every `science-data.aboard-row` augment, one per subject. */
export interface ScienceDataAboardRowContext {
  /** The subject this Aboard row represents. A Kerbalism augment joins its
   *  own `science.experiments` read against this id to find the file and/or
   *  sample backing it (a subject can hold both at once). */
  subjectId: string;
}

declare module "@ksp-gonogo/core" {
  interface SlotRegistry {
    "science-data.aboard-row": ScienceDataAboardRowContext;
  }
}

// ── Registration ──────────────────────────────────────────────────────────────

registerComponent<ScienceDataConfig>({
  id: "science-data",
  name: "Science Data",
  description:
    "Science ledger in two tabs: Aboard is the active vessel's onboard record (collected science per subject, remaining potential, and a 'you are here' situation line; requires flight). Archive is the whole career's R&D archive, every subject ever collected or recovered across every mission and body, grouped by body then experiment × situation × biome; it renders at the Space Center with nothing flying. Read-only on its own; the Kerbalism Uplink enriches each Aboard row with File Manager controls (drive capacity, transmit/delete/flag/analyze/move-to-lab) through the science-data.aboard-row augment slot.",
  tags: ["telemetry", "science"],
  defaultSize: { w: 8, h: 10 },
  minSize: { w: 4, h: 4 },
  component: ScienceDataComponent,
  // `career.mode` is gone rather than translated: it appeared only in this
  // list, never in the component. The widget branches on `hasGameSignal` /
  // `inFlight`, not on the career mode.
  dataRequirements: [
    "vessel.state.parentBodyName",
    "vessel.state.situationName",
    "vessel.surface.landedAt",
    "vessel.surface.biome",
    "science.experiments",
    "science.experimentBreakdown",
    "science.archive",
    "career.status.economy.science",
  ],
  defaultConfig: {},
  // Both tabs are read-only on the base widget itself, no dispatchable
  // action of its own (deploy/transmit live on Experiments; File Manager
  // controls are the Kerbalism augment noted above, dispatched from within
  // the slot rather than through this widget's own action list).
  actions: [],
  augmentSlots: ["science-data.aboard-row"],
  pushable: true,
});

export { ScienceDataComponent };
