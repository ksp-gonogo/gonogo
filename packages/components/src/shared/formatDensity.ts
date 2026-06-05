/**
 * Format atmospheric density in kg/m³. Stock Kerbin sea level is ~1.225 kg/m³;
 * the mesosphere thins to single-digit grams; high-altitude values drop into
 * 1e-6 territory. Pick a representation per magnitude so the readout stays
 * comparable across an entire descent.
 *
 * Accepts `undefined`/non-finite and renders "—" so callers that may not yet
 * have telemetry don't have to guard at the call site.
 */
export function formatDensity(d: number | undefined): string {
  if (d === undefined || !Number.isFinite(d)) return "—";
  const abs = Math.abs(d);
  if (abs >= 1) return `${d.toFixed(3)} kg/m³`;
  if (abs >= 1e-3) return `${(d * 1000).toFixed(2)} g/m³`;
  return `${d.toExponential(2)} kg/m³`;
}
