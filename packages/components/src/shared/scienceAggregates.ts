import { asQuantityish, magnitudeOr } from "./magnitude";

/**
 * Science aggregates derived from the `science.experiments` array, parsed
 * defensively: non-object entries are skipped and missing numbers count as 0,
 * never `NaN`.
 */

/** The subset of a `science.experiments` entry these aggregations read. */
interface RawExperiment {
  subjectId?: unknown;
  title?: unknown;
  dataAmount?: unknown;
  situation?: unknown;
  location?: unknown;
  scienceValueRatio?: unknown;
}

function asRecordArray(raw: unknown): Record<string, unknown>[] {
  if (!Array.isArray(raw)) return [];
  const out: Record<string, unknown>[] = [];
  const entries: unknown[] = raw;
  for (const entry of entries) {
    if (entry && typeof entry === "object" && !Array.isArray(entry)) {
      out.push(entry as Record<string, unknown>);
    }
  }
  return out;
}

function num(v: unknown): number {
  return magnitudeOr(asQuantityish(v), 0);
}

function str(v: unknown, fallback = ""): string {
  return typeof v === "string" ? v : fallback;
}

/** The two vessel-wide scalars derived from the stored-experiment list. */
export interface ScienceAggregate {
  /** Number of stored experiments aboard. */
  count: number;
  /** Total data amount across all stored experiments. */
  dataAmount: number;
}

/** `null` for a non-array, unlike an empty array, which is a real "no experiments aboard". */
export function scienceAggregate(raw: unknown): ScienceAggregate | null {
  if (raw === null || raw === undefined || !Array.isArray(raw)) return null;
  const entries = asRecordArray(raw);
  let dataAmount = 0;
  for (const e of entries) dataAmount += num((e as RawExperiment).dataAmount);
  return { count: entries.length, dataAmount };
}

/** One derived experiment-breakdown row (the shape ScienceData's breakdown view renders). */
export interface DerivedBreakdownEntry {
  subjectId: string;
  biome: string;
  situation: string;
  expTitle: string;
  /** Data amount in mits. */
  dataMits: number;
  /** Science still recoverable from the subject, as a 0-1 ratio, not an absolute amount. */
  remainingPotential: number;
}

/** Per-subject rows, most science left first; `null` for a non-array. */
export function deriveExperimentBreakdown(
  raw: unknown,
): DerivedBreakdownEntry[] | null {
  if (raw === null || raw === undefined || !Array.isArray(raw)) return null;
  const entries = asRecordArray(raw);
  const out: DerivedBreakdownEntry[] = entries.map((entry, i) => {
    const e = entry as RawExperiment;
    return {
      subjectId: str(e.subjectId, `experiment-${i}`),
      biome: str(e.location),
      situation: str(e.situation),
      expTitle: str(e.title, "(unnamed)"),
      dataMits: num(e.dataAmount),
      remainingPotential: num(e.scienceValueRatio),
    };
  });
  out.sort((a, b) => b.remainingPotential - a.remainingPotential);
  return out;
}
