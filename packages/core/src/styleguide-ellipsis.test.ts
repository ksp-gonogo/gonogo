import { execFileSync } from "node:child_process";
import { dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Design-system guard: the single ellipsis character is banned everywhere in
 * the repo. Three periods are the house form, in prose and in rendered UI copy
 * alike, so a pending readout is "Loading widgets..." and an elision in a
 * comment is "(a, b, ...)". Twin of `styleguide-emdash.test.ts`, and it works
 * the same way; the difference is that there is no sanctioned definition site
 * to spare, so the allowed count is zero and there is no allowlist.
 *
 * This file never spells the character literally, using the backslash-u-2026
 * escape instead throughout (both in code and in these comments), so it can
 * never appear in its own scan results.
 *
 * Nothing is exempted. The em-dash twin spares `.snap` captures and the
 * `__generated__` tree because the one em dash it allows legitimately flows
 * into both; here neither carve-out is earned. A snapshot showing the
 * character means a widget renders it, which is the defect this guards even
 * when the string was assembled at runtime and the source scan cannot see it,
 * and the generated TypeScript is committed and reviewable, so a run of
 * `pnpm codegen` that reintroduces one should be loud rather than silent. What
 * does stay out is what `git grep -I` and `.gitignore` already drop: binaries,
 * `node_modules`, `dist/`, and the rendered visual baselines.
 *
 * Scans every git-tracked file in the repo, not just the usual
 * `packages/*\/src` roots, because the sweep this guards covers `mod/` (C#),
 * `docs/`, `scripts/`, and top-level config files too. Uses `git grep` rather
 * than a manual directory walk so it automatically respects `.gitignore` and
 * never has to enumerate every top-level file by hand; same rationale as the
 * git-based check in `uplink-boundary.test.ts`.
 */

const ELLIPSIS = "\u2026";

/**
 * A needle that exists in exactly one file in the repo: this one, as the
 * declaration below. It is searched through the same `filesContaining` call as
 * the real needle, so the second test proves the scan is looking at the tree
 * at all.
 *
 * The em-dash twin gets that assurance for free, because it asserts a positive
 * count in its one allowed file. A zero-allowlist gate has no such anchor: an
 * empty result is indistinguishable from a scan that ran in the wrong
 * directory, matched nothing through a quoting mistake, or was handed a `--`
 * pathspec that excluded the whole repo, and every one of those reads as
 * green. This repo has met that failure often enough to name it.
 *
 * Its presence is structural rather than maintained: the string is its own
 * only occurrence, so it cannot be deleted while the const still compiles, and
 * editing the value edits the thing being searched for. What the control
 * therefore tests is the SCAN, not the needle, which is the half that breaks.
 */
const SCAN_CONTROL = "ellipsis-scan-control-4f7a2c";

function repoRoot(startDir: string): string {
  return execFileSync("git", ["rev-parse", "--show-toplevel"], {
    cwd: startDir,
    encoding: "utf8",
  }).trim();
}

function filesContaining(root: string, needle: string): string[] {
  let out: string;
  try {
    // `--untracked` is load-bearing: `git grep` alone searches only TRACKED
    // files, so a violation introduced in a BRAND-NEW file is invisible to
    // this scan until the moment it is staged, and a local run before
    // `git add` reports success while not looking at it. It still honours
    // .gitignore, so build output stays out.
    out = execFileSync(
      "git",
      ["grep", "--untracked", "-Il", needle, "--", "."],
      {
        cwd: root,
        encoding: "utf8",
        maxBuffer: 1024 * 1024 * 64,
      },
    );
  } catch (err) {
    // git grep exits 1 when there are no matches at all anywhere.
    if ((err as { status?: number }).status === 1) return [];
    throw err;
  }
  return out.split("\n").filter(Boolean);
}

const here = fileURLToPath(import.meta.url);
const root = repoRoot(dirname(here));
const offenders = filesContaining(root, ELLIPSIS);

describe("design-system: ellipsis character", () => {
  it("appears in no file in the repo", () => {
    if (offenders.length > 0) {
      const sample = offenders
        .slice(0, 15)
        .map((f) => `  ${f}`)
        .join("\n");
      throw new Error(
        `Found the ellipsis character in ${offenders.length} file(s). Write three ` +
          "periods instead, in prose and in rendered UI copy alike. If the " +
          "character is genuinely part of a captured payload rather than our own " +
          "writing, say so here rather than rewriting the fixture. Offenders:\n" +
          sample,
      );
    }
    expect(offenders).toHaveLength(0);
  });

  it("scanned the repo, rather than matching nothing", () => {
    const control = filesContaining(root, SCAN_CONTROL);
    const self = relative(root, here);
    if (!control.includes(self)) {
      throw new Error(
        `The scan could not find its own control needle in ${self}, so the ` +
          "empty result above is not evidence of a clean tree: the same call " +
          "found nothing when pointed at a string that is definitely there. " +
          `Check the repo root it resolved (${root}) and the pathspec. ` +
          `Matched instead: ${control.length === 0 ? "nothing" : control.join(", ")}`,
      );
    }
    expect(control).toContain(self);
  });
});
