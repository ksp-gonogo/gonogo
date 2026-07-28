import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Design-system guard: the em dash is banned everywhere in the repo
 * except its one sanctioned definition site, `NULL_DISPLAY` in
 * `@ksp-gonogo/ui-kit`'s `NullValue.tsx` (the "no data yet" UI token;
 * see that file's own header comment for the full rationale). Every
 * other occurrence is a mistake: prose should be rewritten with a
 * comma, colon, semicolon, or a sentence break; a rendered null
 * placeholder should import `NULL_DISPLAY`/`NullValue` instead of
 * writing the character again.
 *
 * Unlike the raw-hex ratchet (`styleguide.test.ts`), there is no
 * baseline to ratchet down here: the count outside the allowed file
 * must always be exactly zero, and the allowed file must contain
 * exactly one occurrence, the definition itself.
 *
 * This file never spells the character literally, using the
 * backslash-u-2014 escape instead throughout (both in code and in
 * these comments), so it can never appear in its own scan results.
 *
 * Scans every git-tracked file in the repo, not just the usual
 * `packages/*\/src` roots, because the sweep this guards covers `mod/`
 * (C#), `docs/`, `scripts/`, and top-level config files too. Uses `git
 * grep` rather than a manual directory walk so it automatically
 * respects `.gitignore` and never has to enumerate every top-level
 * file by hand; same rationale as the git-based check in
 * `uplink-boundary.test.ts`.
 */

const ALLOWED_FILE = "packages/ui-kit/src/NullValue.tsx";
const ALLOWED_COUNT = 1;

const EMDASH = "\u2014";

function repoRoot(startDir: string): string {
  return execFileSync("git", ["rev-parse", "--show-toplevel"], {
    cwd: startDir,
    encoding: "utf8",
  }).trim();
}

// Vitest/Jest snapshot files legitimately contain the raw character as a
// captured artifact of NULL_DISPLAY/NullValue rendering (the component
// renders the sanctioned token; the .snap file is a machine-regenerated
// capture of that already-ratcheted source, not hand-authored prose).
// Same reasoning as `styleguide.test.ts`'s ALLOWED_PATHS for files that
// are themselves a source of truth rather than an offender.
function isSnapshotFile(f: string): boolean {
  return f.endsWith(".snap");
}

function trackedFilesWithEmdash(root: string): string[] {
  let out: string;
  try {
    out = execFileSync("git", ["grep", "-Il", EMDASH, "--", "."], {
      cwd: root,
      encoding: "utf8",
      maxBuffer: 1024 * 1024 * 64,
    });
  } catch (err) {
    // git grep exits 1 when there are no matches at all anywhere.
    if ((err as { status?: number }).status === 1) return [];
    throw err;
  }
  return out
    .split("\n")
    .filter(Boolean)
    .filter(
      (f) => !f.includes("/__generated__/") && !f.startsWith("__generated__/"),
    )
    .filter((f) => !isSnapshotFile(f));
}

const root = repoRoot(dirname(fileURLToPath(import.meta.url)));
const filesWithEmdash = trackedFilesWithEmdash(root);

describe("design-system: em dash", () => {
  it("appears in no file outside the sanctioned null-display token", () => {
    const offenders = filesWithEmdash.filter((f) => f !== ALLOWED_FILE);
    if (offenders.length > 0) {
      const sample = offenders
        .slice(0, 15)
        .map((f) => `  ${f}`)
        .join("\n");
      throw new Error(
        `Found an em dash in ${offenders.length} file(s) outside the sanctioned ` +
          `definition site (${ALLOWED_FILE}). Rewrite prose with ordinary ` +
          "punctuation (comma/colon/semicolon/sentence break); route a rendered " +
          "null placeholder through NULL_DISPLAY/NullValue instead. Offenders:\n" +
          sample,
      );
    }
    expect(offenders).toHaveLength(0);
  });

  it("appears exactly once, in the sanctioned definition site", () => {
    if (!filesWithEmdash.includes(ALLOWED_FILE)) {
      throw new Error(
        `${ALLOWED_FILE} no longer contains an em dash. Update ALLOWED_FILE in ` +
          "this test if the token moved, or investigate if it was deleted.",
      );
    }
    const text = readFileSync(join(root, ALLOWED_FILE), "utf8");
    const count = text.split(EMDASH).length - 1;
    expect(count).toBe(ALLOWED_COUNT);
  });
});
