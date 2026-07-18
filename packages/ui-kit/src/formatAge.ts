/**
 * Formats an elapsed duration (milliseconds) as a compact age readout, e.g.
 * "<1s", "42s", "3m", "2h" — used for "last seen"/"last updated" style
 * badges where the surrounding chrome is small and every character counts.
 *
 * A twin implementation of the same semantics lives in
 * `@ksp-gonogo/core`'s `utils/format.ts` (the app's own widgets import it
 * from there). This copy exists so `@ksp-gonogo/ui-kit` — which must stay
 * free of any `@ksp-gonogo/core` dependency — can offer the same formatter
 * to third-party Uplink clients. See `formatAgeLong` for the verbose form.
 */
export function formatAge(ms: number): string {
  if (ms < 1000) return "<1s";
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m`;
  return `${Math.round(ms / 3_600_000)}h`;
}

/**
 * Verbose sibling of {@link formatAge}: spells out the unit ("min", "h",
 * "d") and adds a day tier, for contexts with room for a fuller readout.
 */
export function formatAgeLong(ms: number): string {
  if (ms < 1000) return "<1s";
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)} min`;
  if (ms < 86_400_000) return `${Math.round(ms / 3_600_000)} h`;
  return `${Math.round(ms / 86_400_000)} d`;
}
