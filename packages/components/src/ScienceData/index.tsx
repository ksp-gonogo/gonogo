import type { ComponentProps } from "@ksp-gonogo/core";
import {
  AugmentSlot,
  registerComponent,
  useDataStreamStatus,
  useGameContext,
  useTelemetry,
} from "@ksp-gonogo/core";
import { useStream, type VesselState } from "@ksp-gonogo/sitrep-client";
import { value } from "@ksp-gonogo/sitrep-sdk";
import {
  DimmedOverlay,
  StreamStatusBadge,
  type TabDescriptor,
  Tabs,
} from "@ksp-gonogo/ui";
import {
  Cluster,
  EmptyState,
  Inline,
  NULL_DISPLAY,
  Panel,
  Row,
  RowName,
  ScrollArea,
  Section,
  SectionTitle,
  Unit,
  Value,
} from "@ksp-gonogo/ui-kit";
import type { CSSProperties } from "react";
import { useState } from "react";
import {
  magnitudeOf,
  magnitudeOr,
  type Quantityish,
} from "../shared/magnitude";

type ScienceDataConfig = Record<string, never>;

/** Fixed-decimal readout with no locale grouping, so the visual gate stays deterministic. */
function fixed(value: number, decimals: number): string {
  return value.toFixed(decimals);
}

export interface ParsedExperiment {
  /** Human-readable experiment + biome label (e.g. "Crew report from KSC"). */
  title: string;
  /** Host part title (e.g. "Mystery Goo Container"). */
  part: string | null;
  /** Mits of data already collected. */
  dataAmount: number | null;
  /** Stable id we can key React lists on. */
  subjectId: string;
}

/**
 * Parses `science.experiments`. Two wire shapes land here:
 *
 * - Legacy Telemachus Reborn: `{ part, title, dataAmount,
 *   scienceValueBase, transmitBoost, subjectId }` (see
 *   ScienceCareerDataLinkHandler in the Telemachus fork).
 * - New SDK `science.experiments`: `{ partName, location, experimentId,
 *   subjectId, title, dataAmount, ... }`,
 *   `mod/Sitrep.Host/ScienceViewProvider.cs`'s superset of the legacy shape,
 *   `partName` in place of `part`. `entry.partName ?? entry.part` below
 *   reads either wire's field name identically; every other field the
 *   widget needs (`title`/`dataAmount`/`subjectId`) is spelled the same on
 *   both. `dataAmount` arrives unit-wrapped on the new wire, so it reads
 *   through `magnitudeOf`.
 */
export function parseExperiments(raw: unknown): ParsedExperiment[] | null {
  if (raw === null || raw === undefined) return null;
  if (!Array.isArray(raw)) return null;
  const out: ParsedExperiment[] = [];
  for (let i = 0; i < raw.length; i++) {
    const entry = raw[i];
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    const e = entry as Record<string, unknown>;
    const subjectId =
      typeof e.subjectId === "string" ? e.subjectId : `experiment-${i}`;
    const part =
      typeof e.partName === "string"
        ? e.partName
        : typeof e.part === "string"
          ? e.part
          : null;
    out.push({
      title: typeof e.title === "string" ? e.title : "(unnamed)",
      part,
      dataAmount: magnitudeOf(e.dataAmount as Quantityish),
      subjectId,
    });
  }
  return out;
}

export interface ExperimentBreakdownEntry {
  subjectId: string;
  biome: string;
  situation: string;
  expTitle: string;
  dataMits: number;
  /** subjectScienceCap - subjectScience; how much science is left in this subject. */
  remainingPotential: number;
}

/**
 * Parses `science.experimentBreakdown`
 * (`Sitrep.Host.ScienceViewProvider.BuildExperimentBreakdown`). Richer than
 * `science.experiments`: one row per DISTINCT subject id, with biome/situation
 * parsed off the subject id server-side and the ABSOLUTE remaining science
 * potential (`scienceCap - science`). Backs the Aboard tab, scoped to the
 * ACTIVE VESSEL's currently-stored `ScienceData` blobs. Falls back to the
 * plain `science.experiments` view when it's absent (a stream sample that
 * hasn't arrived yet). Contrast `parseArchive` below, which backs the
 * career-wide Archive tab instead.
 */
export function parseExperimentBreakdown(
  raw: unknown,
): ExperimentBreakdownEntry[] | null {
  if (raw === null || raw === undefined) return null;
  if (!Array.isArray(raw)) return null;
  const out: ExperimentBreakdownEntry[] = [];
  for (let i = 0; i < raw.length; i++) {
    const entry = raw[i];
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    const e = entry as Record<string, unknown>;
    out.push({
      subjectId:
        typeof e.subjectId === "string" ? e.subjectId : `breakdown-${i}`,
      biome: typeof e.biome === "string" ? e.biome : "",
      situation: typeof e.situation === "string" ? e.situation : "",
      expTitle: typeof e.expTitle === "string" ? e.expTitle : "(unnamed)",
      dataMits: magnitudeOr(e.dataMits as Quantityish, 0),
      remainingPotential: magnitudeOr(e.remainingPotential as Quantityish, 0),
    });
  }
  // Sort by remaining potential desc: subjects with the most science left
  // to extract come first; the operator focuses on what's worth recovering.
  out.sort((a, b) => b.remainingPotential - a.remainingPotential);
  return out;
}

export interface ArchiveSubject {
  subjectId: string;
  /** Leading segment of the subject id, KSP's own `<expId>@…` convention. */
  experimentId: string;
  experimentTitle: string;
  body: string;
  situation: string;
  biome: string;
  title: string;
  /** Science banked for this subject so far. */
  science: number;
  /** Max science this subject can ever yield. */
  scienceCap: number;
  /** scienceCap - science; how much science is left in this subject. */
  remainingPotential: number;
  subjectValue: number;
}

/**
 * Parses `science.archive`
 * (`Sitrep.Host.ScienceViewProvider.BuildArchive`, walking
 * `ResearchAndDevelopment.GetSubjects()`). Every subject the player has
 * ever collected or recovered, across every mission and every body:
 * career-wide, not scoped to the active vessel (contrast
 * `parseExperimentBreakdown` above, which IS vessel-scoped).
 *
 * The wire distinguishes two absent-ish states and this parse preserves
 * both rather than collapsing them: `null`/`undefined` means the save has
 * no R&D instance to walk (Sandbox mode, there is no archive at all);
 * an empty array means a Career/Science save with an archive that's
 * simply empty so far. `ArchiveTab` renders a different message for each.
 * The science figures arrive unit-wrapped on the wire, so they read
 * through `magnitudeOr`.
 */
export function parseArchive(raw: unknown): ArchiveSubject[] | null {
  if (raw === null || raw === undefined) return null;
  if (!Array.isArray(raw)) return null;
  const out: ArchiveSubject[] = [];
  for (let i = 0; i < raw.length; i++) {
    const entry = raw[i];
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    const e = entry as Record<string, unknown>;
    out.push({
      subjectId: typeof e.subjectId === "string" ? e.subjectId : `archive-${i}`,
      experimentId: typeof e.experimentId === "string" ? e.experimentId : "",
      experimentTitle:
        typeof e.experimentTitle === "string" ? e.experimentTitle : "",
      body: typeof e.body === "string" ? e.body : "",
      situation: typeof e.situation === "string" ? e.situation : "",
      biome: typeof e.biome === "string" ? e.biome : "",
      title: typeof e.title === "string" ? e.title : "(unnamed)",
      science: magnitudeOr(e.science as Quantityish, 0),
      scienceCap: magnitudeOr(e.scienceCap as Quantityish, 0),
      remainingPotential: magnitudeOr(e.remainingPotential as Quantityish, 0),
      subjectValue: magnitudeOr(e.subjectValue as Quantityish, 0),
    });
  }
  return out;
}

export interface ArchiveExperimentGroup {
  expId: string;
  expTitle: string;
  rows: ArchiveSubject[];
}

export interface ArchiveBodyGroup {
  body: string;
  experiments: ArchiveExperimentGroup[];
}

/**
 * Groups the global archive by body, then by experiment. The archive
 * spans every body the player has ever visited, so body is the outer key
 * (unlike the old vessel-scoped grouping, which only ever saw one body at
 * a time). Experiment grouping prefers the real `experimentId` field the
 * mod parses server-side; falls back to the `<expId>@…` split off
 * `subjectId` only when that field is absent. Rows are sorted by
 * remaining potential desc WITHIN each body group (what's still worth
 * recovering there), and each experiment sub-group inherits that order.
 */
export function groupArchiveByExperiment(
  entries: ArchiveSubject[],
): ArchiveBodyGroup[] {
  const bodyMap = new Map<string, ArchiveSubject[]>();
  for (const entry of entries) {
    const body = entry.body || "(unknown)";
    const list = bodyMap.get(body);
    if (list) list.push(entry);
    else bodyMap.set(body, [entry]);
  }

  return Array.from(bodyMap.entries()).map(([body, bodyEntries]) => {
    const sorted = [...bodyEntries].sort(
      (a, b) => b.remainingPotential - a.remainingPotential,
    );
    const expMap = new Map<string, ArchiveExperimentGroup>();
    for (const entry of sorted) {
      const expId =
        entry.experimentId || entry.subjectId.split("@")[0] || entry.title;
      const existing = expMap.get(expId);
      if (existing) existing.rows.push(entry);
      else
        expMap.set(expId, {
          expId,
          expTitle: entry.experimentTitle || expId,
          rows: [entry],
        });
    }
    return { body, experiments: Array.from(expMap.values()) };
  });
}

function ScienceDataComponent({
  w,
}: Readonly<ComponentProps<ScienceDataConfig>>) {
  const [tab, setTab] = useState<"aboard" | "archive">("aboard");

  // Aboard-tab / situation reads: partial-dim rather than hard-gate on
  // `requires: ["flight"]`, the header SCI readout below stays meaningful
  // at Space Center (banked science persists across vessels), and so does
  // the Archive tab (career-wide TrueNow ground truth). Only the
  // vessel-scoped Aboard tab goes dark; see where dimNonFlight is applied
  // below, scoped to Aboard's tab content only.
  const { inFlight, hasGameSignal, isCareerLike } = useGameContext();
  const dimNonFlight = hasGameSignal && !inFlight;

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
    "sci.experimentBreakdown",
  );

  const experiments = parseExperiments(experimentsRaw);
  const breakdown = parseExperimentBreakdown(breakdownRaw);
  const archive = parseArchive(archiveRaw);
  // No pre-aggregated fields on the wire, derive both from the same
  // already-parsed experiments array.
  const sciCount = experiments ? experiments.length : undefined;
  const sciDataAmount = experiments
    ? experiments.reduce((sum, e) => sum + (e.dataAmount ?? 0), 0)
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
      content: (
        <DimmedOverlay
          show={dimNonFlight}
          message="Requires flight"
          hint="Science banked above stays current."
        >
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
        </DimmedOverlay>
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
        activeId={tab}
        onChange={(id) => setTab(id as "aboard" | "archive")}
      />
    </Panel>
  );
}

// ── Aboard tab ───────────────────────────────────────────────────────────────

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

function AboardTab({
  body,
  situation,
  situationLocale,
  breakdown,
  experiments,
  sciCount,
  sciDataAmount,
  compact,
}: {
  body: string | undefined;
  situation: string | undefined;
  situationLocale: string;
  breakdown: ExperimentBreakdownEntry[] | null;
  experiments: ParsedExperiment[] | null;
  sciCount: number | undefined;
  sciDataAmount: number | undefined;
  compact: boolean;
}) {
  return (
    <div style={TAB_BODY}>
      <Value
        tone="muted"
        size="sm"
        role="status"
        aria-live="polite"
        aria-label="Current situation for science"
      >
        {body && situation
          ? `${body} · ${situation}${situationLocale ? ` · ${situationLocale}` : ""}`
          : "Awaiting situation telemetry"}
      </Value>
      {!compact && typeof sciCount === "number" && (
        <div style={META_LINE}>
          {sciCount} record{sciCount === 1 ? "" : "s"}
          {typeof sciDataAmount === "number" &&
            ` · ${fixed(sciDataAmount, 1)} mits collected`}
        </div>
      )}
      <ScrollArea>
        {breakdown && breakdown.length > 0 ? (
          <ul style={ROW_LIST}>
            {breakdown.map((b) => (
              // Each row is keyed by the subject's stable id, and carries
              // the `science-data.aboard-row` slot directly below its own
              // Row (a bound Kerbalism augment renders its File Manager
              // controls there; unbound, the slot renders nothing and this
              // list looks exactly as it always has).
              <li key={b.subjectId}>
                <Row as="div">
                  <RowName>
                    {b.expTitle}
                    {b.biome && <span style={MUTED}> · {b.biome}</span>}
                  </RowName>
                  <Inline gap="sm">
                    <Value size="xs">
                      <Unit value={value("Mit", b.dataMits)} />
                    </Value>
                    {b.remainingPotential > 0 && (
                      <Value size="xs" tone="muted">
                        <Unit value={value("science", b.remainingPotential)} />{" "}
                        left
                      </Value>
                    )}
                  </Inline>
                </Row>
                <AugmentSlot
                  name="science-data.aboard-row"
                  props={{ subjectId: b.subjectId }}
                />
              </li>
            ))}
          </ul>
        ) : experiments && experiments.length > 0 ? (
          <ul style={ROW_LIST}>
            {experiments.map((e) => (
              <Row key={e.subjectId}>
                <RowName>{e.title}</RowName>
                <Value size="xs">
                  {e.dataAmount === null
                    ? NULL_DISPLAY
                    : `${fixed(e.dataAmount, 1)} mits`}
                </Value>
              </Row>
            ))}
          </ul>
        ) : (
          <EmptyState>No science data aboard.</EmptyState>
        )}
      </ScrollArea>
    </div>
  );
}

// ── Archive tab ──────────────────────────────────────────────────────────────

function ArchiveTab({
  archive,
  groups,
}: {
  archive: ArchiveSubject[] | null;
  groups: ArchiveBodyGroup[];
}) {
  return (
    <div style={TAB_BODY}>
      <ScrollArea>
        {archive === null ? (
          <EmptyState>
            No R&D archive in this save, Sandbox mode banks no career science.
          </EmptyState>
        ) : archive.length === 0 ? (
          <EmptyState>No science collected yet this career.</EmptyState>
        ) : (
          groups.map((bodyGroup) => (
            <Section key={bodyGroup.body} style={BODY_GROUP}>
              <SectionTitle style={BODY_TITLE}>
                {bodyGroup.body || "(unknown)"}
              </SectionTitle>
              {bodyGroup.experiments.map((exp) => (
                <Section key={exp.expId} style={EXPERIMENT_SECTION}>
                  <SectionTitle>{exp.expTitle || "(unknown)"}</SectionTitle>
                  <ul style={ROW_LIST}>
                    {exp.rows.map((r) => (
                      <Row key={r.subjectId}>
                        <RowName>
                          {r.situation || NULL_DISPLAY}
                          {r.biome && <span style={MUTED}> · {r.biome}</span>}
                        </RowName>
                        <Inline gap="sm">
                          <Value size="xs">{fixed(r.science, 1)} SCI</Value>
                          <Value
                            size="xs"
                            tone={
                              r.remainingPotential > 0 ? "muted" : "default"
                            }
                          >
                            {r.remainingPotential > 0
                              ? `${fixed(r.remainingPotential, 1)} left`
                              : "complete"}
                          </Value>
                        </Inline>
                      </Row>
                    ))}
                  </ul>
                </Section>
              ))}
            </Section>
          ))
        )}
      </ScrollArea>
    </div>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

// Structural inline styles (CSS-var tokens): the tab-body flex shim and the
// archive's two-level body/experiment indent have no reusable ui-kit
// primitive, so they stay local. Toned/weighted readouts render through the
// kit's `Value`.

/**
 * Fills the tab panel's remaining height so the inner `ScrollArea` can
 * actually scroll, mirrors `Panel`'s own flex-column contract one level
 * down, since `Tabs` renders each tab's `content` inside a plain `flex:1`
 * panel with no further layout assumptions.
 */
const TAB_BODY: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "var(--space-8)",
  flex: 1,
  minHeight: 0,
};

const META_LINE: CSSProperties = {
  fontSize: "var(--font-size-xs)",
  color: "var(--color-text-faint)",
};

const MUTED: CSSProperties = {
  color: "var(--color-text-faint)",
  fontWeight: 400,
};

// Slightly looser gap than a bare `Section` gives the body/experiment
// hierarchy visible breathing room without a second bespoke primitive.
const BODY_GROUP: CSSProperties = { gap: "var(--space-6)" };

const BODY_TITLE: CSSProperties = {
  fontWeight: 600,
  color: "var(--color-text-primary)",
};

// Indents each experiment's Section beneath its body heading, the only
// visual cue (besides BODY_TITLE's weight) separating the two group levels.
const EXPERIMENT_SECTION: CSSProperties = { marginLeft: "var(--space-10)" };

// Resets `<ul>` browser chrome (list-style/margin/padding) and stacks the
// per-subject `Row`s with a tight gap, the same list shim ScienceBench used.
const ROW_LIST: CSSProperties = {
  listStyle: "none",
  margin: 0,
  padding: 0,
  display: "flex",
  flexDirection: "column",
  gap: "var(--space-2)",
};

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
  dataRequirements: [
    "v.body",
    "v.situationString",
    "v.landedAt",
    "v.biome",
    "sci.experiments",
    "sci.experimentBreakdown",
    "sci.archive",
    "career.mode",
    "career.science",
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
