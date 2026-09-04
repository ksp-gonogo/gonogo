/**
 * Types for `scan-tests.mjs`, which stays plain ESM because
 * `vitest.scans.config.ts` loads it while deciding what to run and cannot wait
 * for a build.
 */

/** Core test files that reach outside this package, repo-relative to it. */
export function scanTestFiles(): string[];

/** Vitest glob form, relative to packages/core. */
export function scanGlobs(): string[];

/** The reaches-out patterns, so a guard can ask whether each still matches. */
export function reachesOutPatterns(): RegExp[];

/** Pattern source -> why it is kept despite matching nothing. */
export const SPECULATIVE_PATTERNS: Record<string, string>;
