/** Tags of the entries a player sends on purpose: feedback and bug reports. */
export const REPORT_TAGS: ReadonlySet<string> = new Set([
  "feedback",
  "bug-report",
]);

export function isReportEvent(event: { tag?: unknown }): boolean {
  return typeof event.tag === "string" && REPORT_TAGS.has(event.tag);
}
