import { execFileSync } from "node:child_process";
import { basename, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  isExemptPath,
  PRIVATE_REFERENCE_ANY,
} from "./private-references.patterns";
import { exitStatus } from "./ratchetBaseRef";

export interface PrivateReferenceScan {
  /** Matching lines per tracked file, exempt paths left out. */
  counts: Map<string, number>;
  /** Tracked files the scan was able to read, for the instrument check. */
  tracked: number;
}

function repoRoot(): string {
  return execFileSync("git", ["rev-parse", "--show-toplevel"], {
    cwd: dirname(fileURLToPath(import.meta.url)),
    encoding: "utf8",
  }).trim();
}

/**
 * Matching lines per file, from one `git grep` over the tracked tree. Binary
 * files are skipped by git; exit status 1 means no match anywhere.
 */
export function scanPrivateReferences(
  root: string = repoRoot(),
  pattern: string = PRIVATE_REFERENCE_ANY,
): PrivateReferenceScan {
  let out = "";
  try {
    out = execFileSync("git", ["grep", "-IcP", pattern, "--", "."], {
      cwd: root,
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
    });
  } catch (err) {
    if (exitStatus(err) !== 1) throw err;
  }
  const counts = new Map<string, number>();
  for (const line of out.split("\n")) {
    if (line === "") continue;
    const cut = line.lastIndexOf(":");
    const file = line.slice(0, cut);
    if (isExemptPath(file)) continue;
    counts.set(file, Number(line.slice(cut + 1)));
  }
  const tracked = execFileSync("git", ["ls-files"], {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  })
    .split("\n")
    .filter((f) => f !== "" && !isExemptPath(f)).length;
  return { counts, tracked };
}

/** Whether `git grep` finds `pattern` in one loose file, outside any repo index. */
export function patternSeesFile(file: string, pattern: string): boolean {
  try {
    execFileSync(
      "git",
      ["grep", "--no-index", "-qP", pattern, "--", basename(file)],
      { cwd: dirname(file), stdio: "ignore" },
    );
    return true;
  } catch {
    return false;
  }
}
