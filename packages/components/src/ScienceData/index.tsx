import type { ComponentProps } from "@ksp-gonogo/core";
import {
  registerComponent,
  useDataStreamStatus,
  useGameContext,
  useTelemetry,
} from "@ksp-gonogo/core";
import { useStream, type VesselState } from "@ksp-gonogo/sitrep-client";
import { StreamStatusBadge, type TabDescriptor, Tabs } from "@ksp-gonogo/ui";
import { Inline, Panel, Value } from "@ksp-gonogo/ui-kit";
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
  const surface = useTelemetry("vessel.surface");
  const landedAt = surface?.landedAt;
  // Live biome from `ScienceUtil.GetExperimentBiome`, works in flight +
  // space scenes (e.g. "FlyingHigh", "Splashed - OceanWater"), unlike
  // `landedAt` which is only populated on the surface. Falls back to
  // landedAt when blank.
  const liveBiome = surface?.biome;
  const situationLocale = liveBiome ?? landedAt ?? "";

  const experimentsRaw = useTelemetry("science.experiments");
  const breakdownRaw = useTelemetry("science.experimentBreakdown");
  const archiveRaw = useTelemetry("science.archive");
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

  const careerScience = magnitudeOf(
    useTelemetry("career.status")?.economy?.science as Quantityish,
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
            <Value size="sm" title="Science banked">
              {fixed(careerScience, 0)} SCI
            </Value>
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
