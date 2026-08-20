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

/** Their own job is to name the thing, so they cannot be held to it. */
const SELF = [
  "packages/core/src/vendor-name.allowlist.ts",
  "packages/core/src/vendor-name.test.ts",
];
/** History, deliberately kept: see the allowlist header. */
const EXEMPT_PREFIXES = ["CLAUDE.md", "local_docs/"];

function scan(): Map<string, number> {
  // `|| true`: git grep exits 1 when nothing matches, which is a legitimate
  // result here (it is what "finished" looks like) and not an error.
  const out = execFileSync(
    "sh",
    ["-c", "git grep -c -i telemachus -- . || true"],
    { cwd: REPO_ROOT, encoding: "utf-8", maxBuffer: 32 * 1024 * 1024 },
  );
  const counts = new Map<string, number>();
  for (const line of out.split("\n")) {
    if (!line.trim()) continue;
    const idx = line.lastIndexOf(":");
    const path = line.slice(0, idx);
    const n = Number(line.slice(idx + 1));
    if (!Number.isFinite(n)) continue;
    if (SELF.includes(path)) continue;
    if (EXEMPT_PREFIXES.some((p) => path === p || path.startsWith(p))) continue;
    counts.set(path, n);
  }
  return counts;
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
   * Asserted against a known-present mention rather than a bare count, so the
   * check fails if the pattern breaks even while the tree still has hundreds.
   */
  it("actually scanned the tree", () => {
    const found = scan();
    expect(found.size).toBeGreaterThan(50);
    // A file every version of this sweep leaves until last, because the legacy
    // key table is the vocabulary itself.
    expect([...found.keys()].some((p) => p.includes("map-topic"))).toBe(true);
  });

  it("the published SDK surface only ever shrinks", () => {
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
        "The published SDK surface's vendor-name count changed.",
        "",
        "mod/sitrep-sdk is what a third-party Uplink author reads, and they",
        "cannot install anything else we publish. A line here is worse than a",
        "line anywhere else in the tree, so this bucket must reach zero first",
        "and can never grow.",
        "",
        "If a number went DOWN, that is the sweep working: lower it here, or",
        "delete the entry when it hits zero.",
        "If a number went UP or a file is NEW, something re-introduced the name",
        "on a published surface. That has happened once already, when the stream",
        "spine moved here and carried 86 lines of doc comment with it.",
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
        "comment removed so far is in",
        "local_docs/design/telemachus-provenance.md.",
      ].join("\n"),
    ).toEqual([]);
  });

  /**
   * The seeded totals, asserted so the direction of travel is visible in the
   * test name rather than buried in a diff of two hundred numbers. Update both
   * when a slice lands; they can only fall.
   */
  it("stands at the seeded totals: 39 published, 407 elsewhere", () => {
    expect(SEEDED_SDK_TOTAL).toBeLessThanOrEqual(39);
    expect(SEEDED_APP_TOTAL).toBeLessThanOrEqual(407);
  });
});
