import { asQuantityish, magnitudeOf, magnitudeOr } from "../shared/magnitude";

/** Fixed-decimal readout with no locale grouping, so the visual gate stays deterministic. */
export function fixed(value: number, decimals: number): string {
  return value.toFixed(decimals);
}

export interface ParsedExperiment {
  /** Human-readable experiment + biome label (e.g. "Crew report from KSC"). */
  title: string;
  /** Mits of data already collected. */
  dataAmount: number | null;
  /** Stable id we can key React lists on. */
  subjectId: string;
}

/** Parses `science.experiments`; `dataAmount` arrives unit-wrapped. */
export function parseExperiments(raw: unknown): ParsedExperiment[] | null {
  if (raw === null || raw === undefined) return null;
  if (!Array.isArray(raw)) return null;
  const entries: unknown[] = raw;
  const out: ParsedExperiment[] = [];
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    const e = entry as Record<string, unknown>;
    const subjectId =
      typeof e.subjectId === "string" ? e.subjectId : `experiment-${i}`;
    out.push({
      title: typeof e.title === "string" ? e.title : "(unnamed)",
      dataAmount: magnitudeOf(asQuantityish(e.dataAmount)),
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
 * Parses `science.experimentBreakdown`: one row per distinct subject stored aboard the active vessel, with the absolute remaining potential.
 * Sorted by remaining potential, most first.
 */
export function parseExperimentBreakdown(
  raw: unknown,
): ExperimentBreakdownEntry[] | null {
  if (raw === null || raw === undefined) return null;
  if (!Array.isArray(raw)) return null;
  const entries: unknown[] = raw;
  const out: ExperimentBreakdownEntry[] = [];
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    const e = entry as Record<string, unknown>;
    out.push({
      subjectId:
        typeof e.subjectId === "string" ? e.subjectId : `breakdown-${i}`,
      biome: typeof e.biome === "string" ? e.biome : "",
      situation: typeof e.situation === "string" ? e.situation : "",
      expTitle: typeof e.expTitle === "string" ? e.expTitle : "(unnamed)",
      dataMits: magnitudeOr(asQuantityish(e.dataMits), 0),
      remainingPotential: magnitudeOr(asQuantityish(e.remainingPotential), 0),
    });
  }
  out.sort((a, b) => b.remainingPotential - a.remainingPotential);
  return out;
}

export interface ArchiveSubject {
  subjectId: string;
  /** Leading segment of the subject id, KSP's own `<expId>@...` convention. */
  experimentId: string;
  experimentTitle: string;
  body: string;
  situation: string;
  biome: string;
  title: string;
  /** Science banked for this subject so far. */
  science: number;
  /** How much science is left in this subject. */
  remainingPotential: number;
}

/**
 * Parses `science.archive`, every subject the career has ever collected or recovered.
 * `null` means the save has no archive at all (Sandbox); an empty array means an archive with nothing in it yet.
 */
export function parseArchive(raw: unknown): ArchiveSubject[] | null {
  if (raw === null || raw === undefined) return null;
  if (!Array.isArray(raw)) return null;
  const entries: unknown[] = raw;
  const out: ArchiveSubject[] = [];
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
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
      science: magnitudeOr(asQuantityish(e.science), 0),
      remainingPotential: magnitudeOr(asQuantityish(e.remainingPotential), 0),
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
 * Groups the archive by body, then by experiment, falling back to the `<expId>@...` prefix of `subjectId` when `experimentId` is absent.
 * Rows within a body are sorted by remaining potential, most first.
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
