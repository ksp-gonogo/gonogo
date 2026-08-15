import {
  magnitudeOf,
  magnitudeOr,
  type Quantityish,
} from "../shared/magnitude";

/** Fixed-decimal readout with no locale grouping, so the visual gate stays deterministic. */
export function fixed(value: number, decimals: number): string {
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
