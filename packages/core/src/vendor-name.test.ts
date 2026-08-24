import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { APP_INTERNAL, SDK_SURFACE } from "./vendor-name.allowlist";

/**
 * The vendor-name ratchet. See `vendor-name.allowlist.ts` for what it guards and
 * why the counts are exact rather than a file list.
 *
 * The scan is `git grep -c -i`, which means it reads TRACKED files only and
 * counts LINES, not occurrences: two mentions on one line count once, which is
 * fine because the unit being ratcheted down is "a line someone has to read and
 * rewrite". Case-insensitive, because the name appears capitalised in prose and
 * lowercased in paths and identifiers.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, "..", "..", "..");

/**
 * Assembled from fragments so this file does not itself contain the string it
 * hunts. A gate that must spell its own needle can never report the tree clean,
 * and self-exempting the gate hides the one file nobody re-reads. Splitting the
 * literal costs a line of explanation and buys an honest zero.
 */
const NEEDLE = ["tele", "machus"].join("");

/**
 * History, deliberately kept: see the allowlist header.
 *
 * `.serena/` is a different case and is excluded for a different reason: it
 * holds TRACKED binary symbol caches (`*.pkl`) that a re-index rewrites, so
 * their match count moves on its own and would make this gate flaky. They are
 * derived from the source this already counts, so counting them is also double
 * counting. That they are tracked at all looks like an oversight worth fixing
 * separately, and excluding them here does not depend on that happening.
 */
const EXEMPT_PREFIXES = ["CLAUDE.md", "local_docs/", ".serena/"];

/**
 * `git grep -c -i <needle>`, parsed into path -> matching-line count.
 *
 * Raw, with the exemptions left to the caller. They are the ratchet's policy
 * rather than a property of the grep, and keeping them out of here is what
 * lets an exempt path serve as a positive control for the needle itself.
 */
function countLines(needle: string): Map<string, number> {
  // `|| true`: git grep exits 1 when nothing matches, which is a legitimate
  // result here (it is what "finished" looks like) and not an error.
  const out = execFileSync(
    "sh",
    ["-c", `git grep -c -i ${needle} -- . || true`],
    { cwd: REPO_ROOT, encoding: "utf-8", maxBuffer: 32 * 1024 * 1024 },
  );
  const counts = new Map<string, number>();
  for (const line of out.split("\n")) {
    if (!line.trim()) continue;
    const idx = line.lastIndexOf(":");
    const path = line.slice(0, idx);
    const n = Number(line.slice(idx + 1));
    if (!Number.isFinite(n)) continue;
    counts.set(path, n);
  }
  return counts;
}

const isExempt = (path: string) =>
  EXEMPT_PREFIXES.some((p) => path === p || path.startsWith(p));

/**
 * One scan, shared. Three assertions need the same answer and `git grep` over
 * the whole tree is the expensive part of this file, so scanning per-test
 * tripled the cost for no extra coverage.
 *
 * It also removes a flakiness vector rather than only wasting time. This box
 * runs six agents and sits near load 15, where the scan goes from ~0.4s to
 * ~1s; three of those against vitest's 5s default is a gate that can go red on
 * an untouched branch, and a gate that cries wolf gets disabled. The result is
 * deterministic, so caching it changes nothing about what is asserted.
 */
let cached: Map<string, number> | undefined;
function scan(): Map<string, number> {
  cached ??= new Map(
    [...countLines(NEEDLE)].filter(([path]) => !isExempt(path)),
  );
  return cached;
}

const isSdk = (p: string) => p.startsWith("mod/sitrep-sdk/");
const total = (r: Readonly<Record<string, number>>) =>
  Object.values(r).reduce((a, b) => a + b, 0);

const SEEDED_SDK_TOTAL = total(SDK_SURFACE);
const SEEDED_APP_TOTAL = total(APP_INTERNAL);

describe("vendor name", () => {
  /**
   * The instrument check, before any assertion that could pass by finding
   * nothing. A scan that matches zero files reports a finished sweep, and a
   * broken pattern looks exactly like success. This repo has shipped that twice:
   * a `\b` that POSIX ERE does not support matched nothing on macOS for weeks,
   * and a `mod/*​/client/src` pathspec that does not cross `/` returned a
   * confident zero while 67 files were in violation.
   *
   * The debt itself can no longer serve as the positive control, because it is
   * down to two lines and is meant to reach zero. So the control is a DIFFERENT
   * needle run through the SAME scan. It is the project's own name rather than
   * a mod's: a mod token would put this file in violation of the uplink-boundary
   * gate, and it would also be a needle that could legitimately reach zero one
   * day. A zero here means the pipeline is broken (wrong cwd, no git, mangled
   * pathspec) rather than that the sweep finished.
   */
  it("actually scanned the tree", () => {
    expect(countLines("gonogo").size).toBeGreaterThan(50);
  });

  /**
   * The second instrument check, and a DIFFERENT KIND from the one above
   * rather than another of the same. That one proves the pipeline runs; this
   * one proves the needle is the word.
   *
   * Nothing else covers the gap between them, and the gap is not hypothetical.
   * `NEEDLE` is assembled from fragments so this file does not contain what it
   * hunts, and that assembly is hand-rolled, unread and unverified: change one
   * character in a fragment and the pipeline stays healthy, the tree scan comes
   * back empty, and every debt assertion below passes over nothing. Measured,
   * not reasoned: with a real violation planted in a tracked file and one
   * letter altered in a fragment, all four tests in this file passed.
   *
   * `CLAUDE.md` is the control because the project rule deliberately keeps the
   * name there, so it is a known-present instance no sweep will ever remove.
   * Being EXEMPT is what qualifies it: its match was never part of the debt, so
   * this assertion cannot go blind at the moment the debt reaches zero, which
   * is the failure the pipeline control was itself introduced to avoid.
   */
  it("the assembled needle actually matches the name", () => {
    expect(
      [...countLines(NEEDLE).keys()],
      [
        "The needle this gate hunts with no longer matches the name.",
        "",
        "It is assembled from fragments, and a typo in one of them cannot fail",
        "anywhere else: the scan simply returns nothing and the debt assertions",
        "pass over an empty tree. CLAUDE.md is the positive control because the",
        "project rule keeps the name there on purpose.",
        "",
        "If CLAUDE.md genuinely no longer carries the name, this control needs",
        "re-siting onto another known-present instance. Do not delete it.",
      ].join("\n"),
    ).toContain("CLAUDE.md");
  });

  it("the published SDK surface carries the name nowhere at all", () => {
    const found = new Map([...scan()].filter(([p]) => isSdk(p)));
    const drift: string[] = [];
    for (const [path, actual] of found) {
      const allowed = SDK_SURFACE[path];
      if (allowed === undefined) {
        drift.push(`NEW published-surface file: ${path} (${actual} lines)`);
      } else if (actual > allowed) {
        drift.push(`GREW: ${path} ${allowed} -> ${actual}`);
      } else if (actual < allowed) {
        drift.push(`FIXED, lower the number: ${path} ${allowed} -> ${actual}`);
      }
    }
    for (const path of Object.keys(SDK_SURFACE)) {
      if (!found.has(path)) drift.push(`CLEAN, delete the entry: ${path}`);
    }
    expect(
      drift,
      [
        "The published SDK surface names the retired telemetry source.",
        "",
        "mod/sitrep-sdk is what a third-party Uplink author reads, and they",
        "cannot install anything else we publish. A line here is worse than a",
        "line anywhere else in the tree, so this bucket must reach zero first",
        "and can never grow.",
        "",
        "This bucket is EMPTY and is a hard gate rather than a shrinking list:",
        "there is no acceptable number of vendor names on the package a",
        "third-party author installs, so there is no entry to add here. Rewrite",
        "the line to say what it means without the name, the way the rest of",
        "this surface already does.",
        "",
        "It has regressed once, when the stream spine moved here and carried 86",
        "lines of doc comment with it, which is why this is a gate and not a list.",
      ].join("\n"),
    ).toEqual([]);
  });

  it("the rest of the tree only ever shrinks", () => {
    const found = new Map([...scan()].filter(([p]) => !isSdk(p)));
    const drift: string[] = [];
    for (const [path, actual] of found) {
      const allowed = APP_INTERNAL[path];
      if (allowed === undefined) {
        drift.push(`NEW file: ${path} (${actual} lines)`);
      } else if (actual > allowed) {
        drift.push(`GREW: ${path} ${allowed} -> ${actual}`);
      } else if (actual < allowed) {
        drift.push(`FIXED, lower the number: ${path} ${allowed} -> ${actual}`);
      }
    }
    for (const path of Object.keys(APP_INTERNAL)) {
      if (!found.has(path)) drift.push(`CLEAN, delete the entry: ${path}`);
    }
    expect(
      drift,
      [
        "The vendor-name count changed outside the published SDK.",
        "",
        "Down is the goal: lower the number, or delete the entry at zero.",
        "Up means a sweep is being undone. Before deleting a comment, check",
        "whether it records a DISTINCTION rather than a rename: those get",
        "rewritten without the name, never dropped. The full text of every",
        "comment removed so far is under local_docs/design/.",
      ].join("\n"),
    ).toEqual([]);
  });

  /**
   * The seeded totals, asserted so the direction of travel is visible in the
   * test name rather than buried in a diff. Update both when a slice lands;
   * they can only fall.
   */
  it("stands at zero published, and 2 elsewhere", () => {
    expect(SEEDED_SDK_TOTAL).toBe(0);
    expect(SEEDED_APP_TOTAL).toBeLessThanOrEqual(2);
  });
});
