/**
 * What counts as a private working reference in a tracked file, as one named
 * regular expression per kind. Each is written to match only the unambiguous spelling, since
 * a false hit on real code costs more than a miss: short hex colour values,
 * "Plan" as an English word and "ticket" in a domain sense must never match.
 *
 * Pieces are spelled so that this file is not a hit for its own patterns in a
 * reader's search, and the scan skips it by path as well.
 */
export const PRIVATE_REFERENCE_PATTERNS: Record<string, string> = {
  "tracker-name": String.raw`\bSa` + String.raw`ga\b`,
  "ticket-number": String.raw`\b[Tt]ick` + String.raw`et #?\d{2,4}\b`,
  "decision-number": String.raw`\b[Dd]ecis` + String.raw`ion \d+\b`,
  "plan-label":
    String.raw`\(Pl` +
    String.raw`an \d[a-z]?\)|\bPl` +
    String.raw`an \d[a-z]?'s\b`,
  "agent-id": String.raw`\bag` + String.raw`ent-\d+\b`,
  "slice-label": String.raw`\bP1b sl` + String.raw`ice\b`,
  "private-doc":
    String.raw`\.super` +
    String.raw`powers/|docs/super` +
    String.raw`powers/|local_docs/[\w./-]+\.md|\bproject_[a-z]+_[a-z_]+(\.md)?\b`,
  "private-lan-address":
    String.raw`\b(?:10\.\d{1,3}|192\.168|172\.(?:1[6-9]|2\d|3[01]))` +
    String.raw`\.\d{1,3}\.\d{1,3}\b`,
  "home-path":
    String.raw`/Us` +
    String.raw`ers/[a-z]|~/pers` +
    String.raw`onal|/home/de` +
    String.raw`ck\b|claude-` +
    String.raw`store`,
};

/** The patterns as one alternation, for a single `git grep` pass. */
export const PRIVATE_REFERENCE_ANY = Object.values(PRIVATE_REFERENCE_PATTERNS)
  .map((p) => `(?:${p})`)
  .join("|");

/**
 * Files whose subject is the private address ranges themselves (the relay's
 * peer-relay deny list and the network candidate classifier), so naming them is
 * the point.
 */
const PRIVATE_ADDRESS_SUBJECT_PATHS = new Set([
  "packages/relay/src/coturnManager.ts",
  "packages/relay/src/__tests__/coturnManager.test.ts",
  "packages/app/src/__tests__/ice-liveness.test.ts",
]);

/** A tracked path the scan never reads: this scan's own files, and generated output. */
export function isExemptPath(path: string): boolean {
  return (
    path === "pnpm-lock.yaml" ||
    path === "CLAUDE.md" ||
    path === ".mcp.json" ||
    path.endsWith(".snap") ||
    PRIVATE_ADDRESS_SUBJECT_PATHS.has(path) ||
    path.startsWith("packages/core/src/private-references.")
  );
}
