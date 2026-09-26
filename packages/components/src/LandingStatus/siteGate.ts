/** Metres AGL below which an atmospheric descent is a landing rather than an entry. */
export const ATMOSPHERIC_SITE_GATE_M = 10_000;

/**
 * Whether a descent has a touchdown site worth describing: always in vacuum, and in atmosphere only below {@link ATMOSPHERIC_SITE_GATE_M}.
 * A plot's `compute` is pure, so a settling rate between frames has nowhere to live and the altitude gate is the whole test.
 */
export function siteWorthPlotting(
  hasAtmosphere: boolean,
  aglMeters: number | null,
): boolean {
  if (!hasAtmosphere) return true;
  return aglMeters != null && aglMeters < ATMOSPHERIC_SITE_GATE_M;
}
