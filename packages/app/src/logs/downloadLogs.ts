import { logger } from "@gonogo/core";

/**
 * Download the in-memory log buffer as a JSON file. Shared between the
 * LogsManager modal and the station connection screen — the latter is
 * the only export path available when a station can't get past the
 * connect form (e.g. mobile field-test repro).
 */
export function downloadLogs(): void {
  const payload = logger.exportLogs();
  const blob = new Blob([payload], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `gonogo-logs-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
