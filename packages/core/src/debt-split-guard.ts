import { execFileSync } from "node:child_process";
import { transformSync } from "esbuild";
import {
  type RatchetBase,
  ratchetRepoRoot,
  sourceAtRatchetBase,
} from "./ratchetBaseRef";

/**
 * Guards a per-file debt list against a split that lowers the count and fixes
 * nothing.
 *
 * A scan that counts per FILE can read lower after a widget is cut into several
 * files: the debt is spread thinner, or it lands in a file the scan does not
 * reach, or the split severs a provenance chain the scan followed inside one
 * file. The per-file entry then drops and the next commit tightens it, which is
 * exactly what a real fix looks like.
 *
 * So the unit of account here is the WIDGET, not the file: the directory that
 * owns the file. A unit's total may fall, but not in a commit that also added a
 * file to that unit. Splitting and fixing are two commits.
 */

/** Matches `packages/<pkg>/src/<Dir>/...`: a widget, a hook family, a feature folder. */
const UNIT_DIR = /^(packages\/[^/]+\/src\/[^/]+)\//;

/** The widget directory that owns a file, or the file itself when it sits loose in `src`. */
export function debtUnitOf(file: string): string {
  return UNIT_DIR.exec(file)?.[1] ?? file;
}

export interface SplitFinding {
  unit: string;
  was: number;
  now: number;
  added: string[];
}

export interface SplitInput {
  baseDebt: Readonly<Record<string, number>>;
  nowDebt: Readonly<Record<string, number>>;
  /** Every tracked file at the base. */
  baseFiles: readonly string[];
  /** Every file in the working tree. */
  nowFiles: readonly string[];
}

function totalsByUnit(debt: Readonly<Record<string, number>>) {
  const out = new Map<string, number>();
  for (const [file, count] of Object.entries(debt)) {
    const unit = debtUnitOf(file);
    out.set(unit, (out.get(unit) ?? 0) + count);
  }
  return out;
}

/** Units whose total fell in the same change that added a file to them. */
export function splitLaunderingFindings(input: SplitInput): SplitFinding[] {
  const was = totalsByUnit(input.baseDebt);
  const now = totalsByUnit(input.nowDebt);
  const baseFiles = new Set(input.baseFiles);
  const findings: SplitFinding[] = [];
  for (const [unit, before] of was) {
    const after = now.get(unit) ?? 0;
    if (after >= before) continue;
    const added = input.nowFiles.filter(
      (file) => debtUnitOf(file) === unit && !baseFiles.has(file),
    );
    if (added.length > 0)
      findings.push({ unit, was: before, now: after, added });
  }
  return findings;
}

function git(args: string[]): string[] {
  return execFileSync("git", args, {
    cwd: ratchetRepoRoot(),
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    maxBuffer: 64 * 1024 * 1024,
  })
    .split("\n")
    .filter(Boolean);
}

/** Every file under the given directories at the base, and in the tree now (tracked or not). */
export function filesAtBaseAndNow(
  base: RatchetBase,
  dirs: readonly string[],
): { baseFiles: string[]; nowFiles: string[] } {
  if (dirs.length === 0) return { baseFiles: [], nowFiles: [] };
  const paths = ["--", ...dirs];
  return {
    baseFiles: git(["ls-tree", "-r", "--name-only", base.sha, ...paths]),
    nowFiles: git(["ls-files", "-co", "--exclude-standard", ...paths]),
  };
}

/** A named export read out of a module at the base, as a per-key count map. */
export function countsAtBase(
  base: RatchetBase,
  modulePath: string,
  exportName: string,
): Record<string, number> | undefined {
  const source = sourceAtRatchetBase(base, modulePath);
  if (source === null) return undefined;
  const js = transformSync(source, { loader: "ts", format: "cjs" }).code;
  const module_ = { exports: {} as Record<string, unknown> };
  new Function("module", "exports", js)(module_, module_.exports);
  const value = module_.exports[exportName];
  if (typeof value !== "object" || value === null) return undefined;
  const out: Record<string, number> = {};
  for (const [file, count] of Object.entries(value)) {
    if (typeof count !== "number") return undefined;
    out[file] = count;
  }
  return out;
}

/** The split findings for a list graded against the base, or none when the base has no such list. */
export function splitFindingsAgainstBase(
  base: RatchetBase,
  modulePath: string,
  exportName: string,
  nowDebt: Readonly<Record<string, number>>,
): SplitFinding[] {
  const baseDebt = countsAtBase(base, modulePath, exportName);
  if (!baseDebt) return [];
  const units = [
    ...new Set(
      [...Object.keys(baseDebt), ...Object.keys(nowDebt)]
        .map((file) => UNIT_DIR.exec(file)?.[1])
        .filter((unit): unit is string => unit !== undefined),
    ),
  ];
  return splitLaunderingFindings({
    baseDebt,
    nowDebt,
    ...filesAtBaseAndNow(base, units),
  });
}
