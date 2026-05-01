export function formatAge(ms: number): string {
  if (ms < 1000) return "<1s";
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m`;
  return `${Math.round(ms / 3_600_000)}h`;
}

export function formatAgeLong(ms: number): string {
  if (ms < 1000) return "<1s";
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)} min`;
  if (ms < 86_400_000) return `${Math.round(ms / 3_600_000)} h`;
  return `${Math.round(ms / 86_400_000)} d`;
}

export function formatCompactNumber(
  value: number,
  decimals: number = 1,
): string {
  if (!Number.isFinite(value)) return "—";
  const abs = Math.abs(value);
  if (abs >= 1_000_000) {
    return `${stripTrailingZeros((value / 1_000_000).toFixed(decimals))}M`;
  }
  if (abs >= 1_000) {
    return `${stripTrailingZeros((value / 1_000).toFixed(decimals))}k`;
  }
  return String(value);
}

function stripTrailingZeros(s: string): string {
  return s.replace(/\.0+$/, "");
}
