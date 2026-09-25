import { changedFiles, scanScopeMode } from "../scan-scope.mjs";

/**
 * Which files a scan's per-file assertions cover on this run.
 *
 * In the full run (CI, and any run without `GONOGO_SCANS=changed`) that is every
 * file the scan enumerates. In the changed run it is only the files this branch
 * touched, and the rule for a scan using it is fixed: ENUMERATE the whole tree
 * exactly as before and keep every floor on the enumeration, then read and
 * assert on the covered files only. The floor still proves the scan looked in
 * the right place; the reads it skips are what the changed run saves, because
 * opening a file is the dominant cost of a scan on the fleet's machine.
 *
 * A floor that counts what the scan FOUND (files carrying a stack, callers of a
 * seam) cannot hold over a subset, so it applies in the full run only, and the
 * scan says so in its census line rather than passing quietly.
 */
export interface ScanScope {
  readonly mode: "full" | "changed";
  /** Repo-relative paths this branch touched. Empty in the full run. */
  readonly changed: readonly string[];
  /** Whether per-file assertions apply to `rel`, a repo-relative path. */
  covers(rel: string): boolean;
  /** For a census line: which scope this number was measured under. */
  readonly label: string;
}

let memo: ScanScope | undefined;

export function scanScope(): ScanScope {
  if (memo) return memo;
  if (scanScopeMode() === "full") {
    memo = {
      mode: "full",
      changed: [],
      covers: () => true,
      label: "full tree",
    };
    return memo;
  }
  const { ref, base, files } = changedFiles();
  const set = new Set(files);
  memo = {
    mode: "changed",
    changed: files,
    covers: (rel) => set.has(rel),
    label: `CHANGED ONLY: ${files.length} file(s) since merge-base with ${ref} (${base.slice(0, 9)})`,
  };
  return memo;
}

/**
 * Of a scan's compiler roots (package directories, each with its own
 * tsconfig), the ones whose program must be built on this run.
 *
 * Every root in the full run. In the changed run, the roots holding a changed
 * file, or every root when the workspace's shared TypeScript or dependency
 * config changed. A root that only CONSUMES a changed package is not rebuilt:
 * it sees that package through its built `dist`, so the ripple of a type change
 * reaches it only after a build, and the full run in CI is what grades it.
 */
export function rootsInScope(roots: readonly string[]): string[] {
  const scope = scanScope();
  if (scope.mode === "full") return [...roots];
  if (scope.changed.some((f) => WORKSPACE_WIDE.test(f))) return [...roots];
  return roots.filter((root) =>
    scope.changed.some((f) => f.startsWith(`${root}/`)),
  );
}

/** Root-level files whose change reaches every package's compilation. */
const WORKSPACE_WIDE =
  /^(tsconfig[^/]*\.json|package\.json|pnpm-lock\.yaml|pnpm-workspace\.yaml)$/;
