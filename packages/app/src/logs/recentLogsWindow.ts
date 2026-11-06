import type { LogEntry } from "@ksp-gonogo/logger";

export function recentLogsWindow(
  buffer: readonly LogEntry[],
  windowMinutes: number | null,
  now: number = Date.now(),
): readonly LogEntry[] {
  if (windowMinutes === null) return buffer;
  const cutoff = now - windowMinutes * 60_000;
  return buffer.filter((entry) => {
    const t = Date.parse(entry.timestamp);
    return Number.isFinite(t) && t >= cutoff;
  });
}

/**
 * Axiom truncates a field over 1 MB, and a report also carries a screenshot of
 * up to 500 KB, so the embedded logs stop well short of that.
 */
export const MAX_REPORT_LOG_BYTES = 400_000;

/** The newest entries of `entries` whose JSON fits in `maxBytes`, oldest first. */
export function capLogsByBytes(
  entries: readonly LogEntry[],
  maxBytes: number = MAX_REPORT_LOG_BYTES,
): readonly LogEntry[] {
  let used = 2;
  let start = entries.length;
  while (start > 0) {
    used += JSON.stringify(entries[start - 1]).length + 1;
    if (used > maxBytes) break;
    start--;
  }
  return start === 0 ? entries : entries.slice(start);
}
