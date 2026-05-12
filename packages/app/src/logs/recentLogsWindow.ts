import type { LogEntry } from "@gonogo/logger";

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
