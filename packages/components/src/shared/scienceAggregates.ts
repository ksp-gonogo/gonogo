/**
 * Client-side science aggregation off the `science.experiments` array.
 * The raw per-experiment array is a clean home on the new wire
 * (`ScienceViewProvider`'s `ExperimentEntry[]` — mirrored here defensively as
 * `unknown`), so the two legacy pre-aggregated scalars ScienceBench/
 * ScienceOfficer read (`sci.count` / `sci.dataAmount`) and the
 * GonogoTelemetry-only `sci.experimentBreakdown` enrichment are all derivable
 * client-side from that ONE array — no separate mod field. This shared helper
 * is the single source of that derivation so both widgets drop the legacy
 * reads.
 *
 * Every function parses defensively (same discipline as ScienceBench's own
 * `parseExperiments`): non-arrays / non-object entries are skipped, missing
 * numeric fields contribute 0, never `NaN`.
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
  for (const entry of raw) {
    if (entry && typeof entry === "object" && !Array.isArray(entry)) {
      out.push(entry as Record<string, unknown>);
    }
  }
  return out;
}

function num(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

function str(v: unknown, fallback = ""): string {
  return typeof v === "string" ? v : fallback;
}

/** The two scalar aggregates the old `sci.count` / `sci.dataAmount` carried. */
export interface ScienceAggregate {
  /** Number of stored experiments aboard (old `sci.count`). */
  count: number;
  /** Total data amount across all stored experiments (old `sci.dataAmount`). */
  dataAmount: number;
}

/**
 * Sum the experiment count + total data amount from a `science.experiments`
 * array — the client-side replacement for the two legacy scalar reads. Returns
 * `null` when `raw` isn't an array at all (nothing to sum — the caller falls
 * back / renders empty), distinct from an empty array (`{ count: 0,
 * dataAmount: 0 }`, a real "no experiments aboard").
 */
export function scienceAggregate(raw: unknown): ScienceAggregate | null {
  if (raw === null || raw === undefined || !Array.isArray(raw)) return null;
  const entries = asRecordArray(raw);
  let dataAmount = 0;
  for (const e of entries) dataAmount += num((e as RawExperiment).dataAmount);
  return { count: entries.length, dataAmount };
}

/** One derived experiment-breakdown row (the shape ScienceBench's breakdown view renders). */
export interface DerivedBreakdownEntry {
  subjectId: string;
  biome: string;
  situation: string;
  expTitle: string;
  /** Data amount (mits) for this experiment — old breakdown `dataMits`. */
  dataMits: number;
  /**
   * How much science is still recoverable from this subject, as a 0..1 ratio
   * (`scienceValueRatio` off the wire). The old GonogoTelemetry breakdown
   * carried an ABSOLUTE `remainingPotential` (subjectScienceCap −
   * subjectScience); the new wire exposes only the ratio, so this is that
   * ratio — enough to sort "most science left first", which is all the
   * breakdown view used it for.
   */
  remainingPotential: number;
}

/**
 * Derive the per-subject breakdown client-side from the `science.experiments`
 * array, dropping the precomputed `sci.experimentBreakdown` enrichment in
 * favour of deriving it from the raw inputs. `biome` comes from each entry's
 * `location`, `situation` from `situation`, `remainingPotential` from
 * `scienceValueRatio`. Sorted by `remainingPotential` descending (subjects
 * with the most science left to extract first), matching the old breakdown's
 * ordering. `null` when `raw` isn't an array.
 */
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
