import type {
  BandKind,
  ReckoningBasis,
  SeriesRange,
  Value,
} from "@ksp-gonogo/sitrep-sdk";

/** What a model said about one instant of a window's reckoned tail. */
export interface WindowModelledInstant {
  basis: ReckoningBasis;
  band?: { lo: Value; hi: Value; kind: BandKind };
}

/**
 * What a window was built from, before its samples were reduced to magnitudes:
 * each sample's payload with its unit still on it, and what the model said for
 * each instant nobody measured. Index-aligned with the range's `t`.
 */
export interface SeriesWindowSource {
  payloads: readonly unknown[];
  /** Keyed by index into `t`; an index absent here was measured. */
  modelled: ReadonlyMap<number, WindowModelledInstant>;
}

const sources = new WeakMap<SeriesRange, SeriesWindowSource>();

export function rememberWindowSource(
  range: SeriesRange,
  source: SeriesWindowSource,
): void {
  sources.set(range, source);
}

/** The source of a range `useDataSeries` built, or `undefined` for any other. */
export function windowSourceOf(
  range: SeriesRange,
): SeriesWindowSource | undefined {
  return sources.get(range);
}
