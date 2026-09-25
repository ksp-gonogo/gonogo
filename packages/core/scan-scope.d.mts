/**
 * Types for `scan-scope.mjs`, plain ESM for the same reason as `scan-tests.mjs`:
 * `vitest.scans.config.ts` loads it while deciding what to run.
 */

export const SCOPE_ENV: "GONOGO_SCANS";
export const DEFAULT_BASE: string;

export type ScanScopeMode = "full" | "changed";

export function scanScopeMode(env?: NodeJS.ProcessEnv): ScanScopeMode;

export interface ChangedFiles {
  /** The ref the branch was measured from, as named. */
  ref: string;
  /** The merge-base commit with that ref. */
  base: string;
  /** Repo-relative paths, sorted, never empty. */
  files: string[];
}

export function changedFiles(
  env?: NodeJS.ProcessEnv,
  cwd?: string,
): ChangedFiles;

export function scanSources(scan: string): string[];

export function selectScans(
  allScans: readonly string[],
  changed: readonly string[],
): { run: string[]; skipped: string[] };
