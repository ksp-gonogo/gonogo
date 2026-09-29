import type { ComponentProps } from "@ksp-gonogo/core";
import {
  defineTopicManifest,
  registerComponent,
  useGameContext,
  useTelemetry,
} from "@ksp-gonogo/core";
import {
  useStream,
  useStreamStatus,
  useTelemetryStoreOptional,
} from "@ksp-gonogo/sitrep-client";
import {
  enumNameOf,
  SITUATION_NAMES,
  type SituationName,
  stillTrue,
  type VesselIdentity,
} from "@ksp-gonogo/sitrep-sdk";
import { type TabDescriptor, Tabs } from "@ksp-gonogo/ui";
import { Panel, Section, Text } from "@ksp-gonogo/ui-kit";
import { useState } from "react";
import { asQuantityish, magnitudeOf } from "../shared/magnitude";
import { useBodyName } from "../shared/useBodyName";
import { AboardTab } from "./AboardTab";
import { ArchiveTab } from "./ArchiveTab";
import {
  fixed,
  groupArchiveByExperiment,
  parseArchive,
  parseExperimentBreakdown,
  parseExperiments,
} from "./parsers";

const topics = defineTopicManifest({
  channels: [
    "vessel.identity",
    "system.bodies",
    "vessel.surface",
    "science.experiments",
    "science.experimentBreakdown",
    "science.archive",
    "career.status",
  ],
  fields: [
    "vessel.identity.parentBodyIndex",
    "vessel.identity.situation",
    "vessel.surface.landedAt",
    "vessel.surface.biome",
    "science.experiments",
    "science.experimentBreakdown",
    "science.archive",
    "career.status.economy.science",
  ],
});

type ScienceDataConfig = Record<string, never>;

function ScienceDataComponent({
  w,
}: Readonly<ComponentProps<ScienceDataConfig>>) {
  const [tab, setTab] = useState<"aboard" | "archive">("aboard");

  // Banked science and the Archive are career-wide and stay meaningful at the Space Center; only Aboard is vessel-scoped.
  const { inFlight, hasGameSignal, isCareerLike } = useGameContext();
  const noVessel = hasGameSignal && !inFlight;

  const identity = stillTrue(
    useStream<VesselIdentity>("vessel.identity"),
    undefined,
  );
  const body = useBodyName(identity?.parentBodyIndex) ?? undefined;
  const situation = enumNameOf<SituationName>(
    SITUATION_NAMES,
    identity?.situation,
  );
  // A flying vessel drifts between biomes, so a held locale is withheld and flagged rather than shown as current.
  const surfaceReading = useTelemetry("vessel.surface");
  const surface =
    surfaceReading.state === "observed" ? surfaceReading.value : undefined;
  const surfaceHeld = surfaceReading.state === "held";
  const landedAt = surface?.landedAt;
  // `biome` is populated in flight and in space; `landedAt` only on the surface.
  const liveBiome = surface?.biome;
  const situationLocale = liveBiome ?? landedAt ?? "";

  // The ledgers change only on events, so the last one received is still the ledger.
  const experimentsRaw = stillTrue(
    useTelemetry("science.experiments"),
    undefined,
  );
  const breakdownRaw = stillTrue(
    useTelemetry("science.experimentBreakdown"),
    undefined,
  );
  const archiveRaw = stillTrue(useTelemetry("science.archive"), undefined);
  const breakdownStreamStatus = useStreamStatus(
    useTelemetryStoreOptional(),
    "science.experimentBreakdown",
  );

  const experiments = parseExperiments(experimentsRaw);
  const breakdown = parseExperimentBreakdown(breakdownRaw);
  const archive = parseArchive(archiveRaw);
  const sciCount = experiments ? experiments.length : undefined;
  // A non-mits provider leaves every `dataAmount` null, and that is no figure, not zero mits.
  const collected = experiments?.filter((e) => e.dataAmount !== null) ?? [];
  const sciDataAmount = collected.length
    ? collected.reduce((sum, e) => sum + (e.dataAmount ?? 0), 0)
    : undefined;

  // A balance moves only on events, and nothing here spends it, so the last one received is still shown.
  const careerScience = magnitudeOf(
    asQuantityish(
      stillTrue(useTelemetry("career.status"), undefined)?.economy?.science,
    ),
  );

  const archiveGroups = archive ? groupArchiveByExperiment(archive) : [];

  const cols = w ?? 8;
  const compact = cols < 6;

  const tabs: TabDescriptor[] = [
    {
      id: "aboard",
      label: "Aboard",
      disabled: noVessel,
      content: (
        <AboardTab
          body={body}
          situation={situation}
          situationLocale={situationLocale}
          localeHeld={surfaceHeld}
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
      content: <ArchiveTab archive={archive} groups={archiveGroups} />,
    },
  ];

  return (
    <Panel
      panelTitle="SCIENCE DATA"
      compactTitle={["SCI DATA", "SCI"]}
      panelStatus={breakdownStreamStatus}
      /* The balance sits in the body, not the aside, which folds away at narrow widths. */
      sections={
        <Section full>
          {isCareerLike && careerScience !== null && (
            <Text size="sm">{fixed(careerScience, 0)} SCI banked</Text>
          )}
          <Tabs
            tabs={tabs}
            activeId={noVessel && tab === "aboard" ? "archive" : tab}
            onChange={(id) => setTab(id as "aboard" | "archive")}
          />
        </Section>
      }
    />
  );
}

/**
 * Props passed to every `science-data.aboard-row` augment, one per subject, rendered below each Aboard breakdown row.
 * The augment reads its own data and joins by `subjectId`.
 */
export interface ScienceDataAboardRowContext {
  /** The subject this Aboard row represents; a subject can hold a file and a sample at once. */
  subjectId: string;
}

declare module "@ksp-gonogo/core" {
  interface SlotRegistry {
    "science-data.aboard-row": ScienceDataAboardRowContext;
  }
}

registerComponent<ScienceDataConfig>({
  id: "science-data",
  name: "Science Data",
  description:
    "Science ledger in two tabs: Aboard is the active vessel's onboard record (collected science per subject, remaining potential, and a 'you are here' situation line; requires flight). Archive is the whole career's R&D archive, every subject ever collected or recovered across every mission and body, grouped by body then experiment × situation × biome; it renders at the Space Center with nothing flying. Read-only on its own; an installed Uplink can enrich each Aboard row with File Manager controls (drive capacity, transmit/delete/flag/analyze/move-to-lab) through the science-data.aboard-row augment slot.",
  tags: ["telemetry", "science"],
  defaultSize: { w: 8, h: 10 },
  // Below five columns the Archive tab falls off the end of the strip.
  minSize: { w: 5, h: 4 },
  component: ScienceDataComponent,
  channels: topics.channels,
  fields: topics.fields,
  defaultConfig: {},
  actions: [],
  augmentSlots: ["science-data.aboard-row"],
  pushable: true,
});

export { ScienceDataComponent };
