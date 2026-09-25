// Which scans a LOCAL run executes: all of them, or only the ones a branch's
// changes can reach.
//
// CI always runs every scan over the whole tree, and that is deliberate: files
// and changes nobody claimed turn up on occasion, and the whole-tree run is what
// makes someone own them. Locally the question is narrower ("did I break a
// scan?"), so `GONOGO_SCANS=changed` skips the scans whose domain holds none of
// the changed files. A scan that runs, runs unmodified: same enumeration, same
// instrument floors, same assertions as CI. Nothing inside a scan is narrowed,
// so no floor has to learn to tell "narrowed on purpose" from "blind".
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { SCAN_DOMAINS, SCANS_RUN_ON_ANY_CHANGE } from "./scan-domains.mjs";

const CORE = dirname(fileURLToPath(import.meta.url));
const REPO = join(CORE, "..", "..");

export const SCOPE_ENV = "GONOGO_SCANS";

/**
 * The ref a branch's changes are measured from, unless `GONOGO_SCANS_BASE`
 * names another. Separate from `RATCHET_BASE_REF` on purpose: that one is the
 * revision the shrink-only ratchets grade their debt lists against, and it
 * refuses to be the commit under test, which is exactly what a changed-only run
 * over uncommitted work wants to measure from.
 */
export const DEFAULT_BASE = "origin/staging";

/**
 * `"full"` unless `GONOGO_SCANS=changed`. Any other value is an error rather
 * than a quiet full run, so a typo cannot pass for the mode that was asked for.
 */
export function scanScopeMode(env = process.env) {
  const raw = env[SCOPE_ENV];
  if (raw === undefined || raw === "" || raw === "full") return "full";
  if (raw !== "changed") {
    throw new Error(
      `[scans] ${SCOPE_ENV}=${raw} is not a scope. Use "changed", or unset it for the full run.`,
    );
  }
  if (env.GITHUB_ACTIONS === "true") {
    throw new Error(
      `[scans] ${SCOPE_ENV}=changed on a GitHub Actions runner. CI runs every scan over the whole tree, by ruling (Saga #401); the changed mode is for local runs only.`,
    );
  }
  return "changed";
}

function git(args, cwd) {
  // No try/catch: a git failure must stop the run. A diff that errored into an
  // empty string would otherwise read as "nothing changed", and every scan
  // would be skipped as out of scope.
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function nulSeparated(out) {
  return out.split("\0").filter((f) => f.length > 0);
}

/**
 * Everything this branch touched: files that differ between the merge-base
 * with the base ref and the WORKING TREE (so committed, staged and unstaged
 * edits alike, deletions included, renames listed as both sides), plus
 * untracked files that are not ignored.
 *
 * Throws when the base cannot be resolved, when git fails, and when the set is
 * empty: a changed-only run with nothing changed has nothing to assert, and
 * reporting that as green is the false pass this whole mode must not produce.
 */
export function changedFiles(env = process.env, cwd = CORE) {
  const root = git(["rev-parse", "--show-toplevel"], cwd).trim();
  const ref = env.GONOGO_SCANS_BASE || DEFAULT_BASE;
  let tip;
  try {
    tip = git(
      ["rev-parse", "--verify", "--quiet", `${ref}^{commit}`],
      root,
    ).trim();
  } catch {
    tip = "";
  }
  if (!tip) {
    throw new Error(
      `[scans] the changed set cannot be computed: ${ref} does not resolve to a commit. Run \`git fetch origin staging\`, set GONOGO_SCANS_BASE=<commit>, or run the full scans.`,
    );
  }
  const base = git(["merge-base", "HEAD", tip], root).trim();
  if (!/^[0-9a-f]{40}$/.test(base)) {
    throw new Error(
      `[scans] git merge-base HEAD ${ref} returned ${JSON.stringify(base)}, not a commit.`,
    );
  }
  const diffed = nulSeparated(
    git(["diff", "--name-only", "--no-renames", "-z", base, "--"], root),
  );
  const untracked = nulSeparated(
    git(["ls-files", "-z", "--others", "--exclude-standard"], root),
  );
  const files = [...new Set([...diffed, ...untracked])].sort();
  if (files.length === 0) {
    throw new Error(
      `[scans] nothing differs from the merge-base with ${ref} (${base.slice(0, 9)}), so a changed-only run has nothing to check. Run the full scans instead.`,
    );
  }
  return { ref, base, files };
}

const RELATIVE_IMPORT_RE = /(?:from|import)\s*\(?\s*["'](\.{1,2}\/[^"']+)["']/g;
const RESOLVE_SUFFIXES = ["", ".ts", ".tsx", ".mjs", ".js", "/index.ts"];

/**
 * A scan's own sources: the test file and every module it reaches through
 * relative imports (its allowlist, its scan helper, the shared ratchet support,
 * a fixture server it grades). Repo-relative. Editing any of them changes what
 * the scan asserts, so each is part of the scan's domain without being declared.
 */
export function scanSources(scan) {
  const seen = new Set();
  const pending = [join(CORE, scan)];
  while (pending.length > 0) {
    const abs = pending.pop();
    if (seen.has(abs)) continue;
    seen.add(abs);
    const source = readFileSync(abs, "utf8");
    for (const match of source.matchAll(RELATIVE_IMPORT_RE)) {
      const target = RESOLVE_SUFFIXES.map((s) =>
        join(dirname(abs), match[1] + s),
      ).find(
        (p) =>
          p.startsWith(REPO) &&
          !p.includes("/node_modules/") &&
          existsSync(p) &&
          statSync(p).isFile(),
      );
      if (target) pending.push(target);
    }
  }
  const snapshot = join(
    CORE,
    dirname(scan),
    "__snapshots__",
    `${scan.split("/").pop()}.snap`,
  );
  if (existsSync(snapshot)) seen.add(snapshot);
  return [...seen].map((abs) => relative(REPO, abs));
}

/**
 * The scans to run for a changed set, and the ones skipped.
 *
 * A scan with no entry in SCAN_DOMAINS always runs, so a new scan is checked
 * locally from the day it lands and only an explicit, reviewed domain can take
 * one out of a local run. A change to the scan machinery itself runs them all.
 */
export function selectScans(allScans, changed) {
  const everything = changed.filter((f) =>
    SCANS_RUN_ON_ANY_CHANGE.some((re) => re.test(f)),
  );
  const changedSet = new Set(changed);
  const run = [];
  const skipped = [];
  for (const scan of allScans) {
    const domain = SCAN_DOMAINS[scan];
    const reason =
      everything.length > 0
        ? `scan machinery changed (${everything[0]})`
        : domain === undefined
          ? "no declared domain"
          : (changed.find((f) => domain.some((re) => re.test(f))) ??
            scanSources(scan).find((f) => changedSet.has(f)));
    if (reason) run.push(scan);
    else skipped.push(scan);
  }
  return { run, skipped };
}
