import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  findImportMetaEnvViolations,
  hasScannedExtension,
  type ImportMetaEnvViolation,
} from "./import-meta-env.matcher";
import { exitStatus } from "./ratchetBaseRef";

/**
 * Ban on reading `import.meta.env` through anything other than the literal
 * Vite substitutes. Saga #525: `eb6b2f744` rewrote three literal
 * `import.meta.env` reads into `Reflect.get(import.meta, "env")` while
 * clearing them off the unknown-cast ratchet's debt list (`unknown-cast.test.ts`
 * in this same package), and Vite's static substitution never saw the rewritten
 * form. `VITE_PEER_*` and `VITE_SITREP_HOST` both read `undefined` in the dev
 * server and the bundle, silently, until a chromium e2e run caught the broker
 * falling back to the public PeerJS broker. Fixed in `0b556aa05` by spelling
 * `import.meta.env` back out (a type cast is fine, `(import.meta as X).env`
 * compiles to the literal dotted read once TypeScript erases the cast; a
 * runtime property lookup is not).
 *
 * The rule this enforces has no baseline to ratchet down, the same as
 * `styleguide-emdash.test.ts`'s em dash: the count outside a comment or string
 * must always be exactly zero. Unlike the em dash, there is no sanctioned
 * definition site to allow, so the floor is the file walk itself, not a count.
 *
 * Scans every git-tracked TS/TSX/JS file in the repo, `mod/` and `packages/`
 * alike, since the three original sites were one of each. Uses `git grep`
 * rather than a manual directory walk so it respects `.gitignore` without
 * having to enumerate every root by hand, the same reasoning as the em dash and
 * unknown-cast scans.
 */

function repoRoot(startDir: string): string {
  return execFileSync("git", ["rev-parse", "--show-toplevel"], {
    cwd: startDir,
    encoding: "utf8",
  }).trim();
}

/** A generated file is a source of truth's copy, not an offender in its own right. */
function isGenerated(f: string): boolean {
  return f.includes("/__generated__/") || f.startsWith("__generated__/");
}

/**
 * This scan's own two files, excluded from the tree it scans.
 *
 * Both legitimately contain every forbidden spelling: the matcher explains
 * them in doc comments and the self-test plants them as fixture strings. The
 * matcher strips comments and non-bracket string contents before matching
 * precisely so neither reads as an offender, but the bracket form is kept
 * readable inside a string on purpose (see `withoutCommentsAndStrings`'s own
 * comment), which means a planted `import.meta["env"]` fixture would
 * otherwise still be visible to this very test. Excluding the two files
 * outright is more robust than relying on that one exemption to keep holding
 * as the fixtures change; the proof that the ban is real lives in the
 * self-test below, not in this file passing its own scan.
 */
const SELF = new Set([
  "packages/core/src/import-meta-env.matcher.ts",
  "packages/core/src/import-meta-env.test.ts",
]);

/**
 * Every tracked or freshly-created TS/TSX/JS file that so much as mentions
 * `import.meta`, as a candidate list for the precise matcher to narrow.
 *
 * `--untracked` is load-bearing: without it a violation in a brand-new file is
 * invisible until the moment it is staged, and a local run before `git add`
 * reports success while not having looked at it. `.gitignore` is still
 * honoured, so build output stays out. `-F` is a fixed-string search: "does
 * this file contain the eleven characters `import.meta` at all" is a coarse
 * filter, the precise matcher does the real work per file.
 */
function candidateFiles(root: string): string[] {
  let out: string;
  try {
    out = execFileSync(
      "git",
      [
        "grep",
        "--untracked",
        "-Il",
        "-F",
        "import.meta",
        "--",
        "*.ts",
        "*.tsx",
        "*.js",
        "*.jsx",
      ],
      { cwd: root, encoding: "utf8", maxBuffer: 1024 * 1024 * 64 },
    );
  } catch (err) {
    if (exitStatus(err) === 1) return [];
    throw err;
  }
  return out
    .split("\n")
    .filter(Boolean)
    .filter((f) => !isGenerated(f))
    .filter((f) => !SELF.has(f))
    .filter(hasScannedExtension);
}

/** Every tracked or untracked TS/TSX/JS file, for the listing floor. */
function trackedFileCount(root: string): number {
  return execFileSync(
    "git",
    [
      "ls-files",
      "--cached",
      "--others",
      "--exclude-standard",
      "--",
      "*.ts",
      "*.tsx",
      "*.js",
      "*.jsx",
    ],
    { cwd: root, encoding: "utf8", maxBuffer: 1024 * 1024 * 64 },
  )
    .split("\n")
    .filter(Boolean).length;
}

interface FileViolation extends ImportMetaEnvViolation {
  file: string;
}

function scanRepo(root: string): {
  candidates: string[];
  violations: FileViolation[];
} {
  const candidates = candidateFiles(root);
  const violations: FileViolation[] = [];
  for (const file of candidates) {
    const source = readFileSync(join(root, file), "utf8");
    for (const v of findImportMetaEnvViolations(source)) {
      violations.push({ ...v, file });
    }
  }
  return { candidates, violations };
}

const root = repoRoot(dirname(fileURLToPath(import.meta.url)));

describe("design-system: import.meta.env is read only through the literal Vite substitutes", () => {
  /**
   * The instrument check, before any assertion that can pass by finding
   * nothing. A wrong cwd, a renamed root, or a `git ls-files` that errors into
   * an empty string all look exactly like a clean repo otherwise. The floor is
   * far below the actual tracked count (2551 TS/TSX/JS files, 216 mentioning
   * `import.meta`, at the time this was written) so ordinary churn never trips
   * it and only a broken enumeration does.
   */
  it("actually scanned the source tree", () => {
    const total = trackedFileCount(root);
    const { candidates } = scanRepo(root);
    expect(
      total,
      `git ls-files found ${total} tracked/untracked TS/TSX/JS files. The walk lost its input.`,
    ).toBeGreaterThanOrEqual(1500);
    expect(
      candidates.length,
      `${candidates.length} files mention import.meta at all. The candidate filter lost its input.`,
    ).toBeGreaterThanOrEqual(100);
  });

  it("finds no non-literal read of import.meta.env in the tree", () => {
    const { violations } = scanRepo(root);
    if (violations.length > 0) {
      const sample = violations
        .slice(0, 15)
        .map((v) => `  ${v.file}:${v.line}  [${v.kind}]  ${v.text}`)
        .join("\n");
      throw new Error(
        [
          `Found ${violations.length} non-literal read(s) of import.meta.env.`,
          "",
          "Vite substitutes environment variables only where the source spells the",
          "literal text `import.meta.env` (a type cast around it is fine, TypeScript",
          "erases the cast before the bundler sees it; a runtime property lookup is",
          "not). Reflect.get, bracket indexing and destructuring all read `undefined`",
          "in both the dev server and the bundle, silently: Saga #525 broke",
          "VITE_PEER_* and VITE_SITREP_HOST this way. Spell the literal dotted read",
          "instead; see the fixed sites (`0b556aa05`) for the cast form when the",
          "package has no `ImportMetaEnv` augmentation in scope.",
          "",
          sample,
        ].join("\n"),
      );
    }
    expect(violations).toHaveLength(0);
  });

  /**
   * The instrument check for the matcher itself: the floor above stays green
   * if the matcher is edited into something that matches nothing, and the
   * offender assertion then reads as a repo that fixed itself overnight. Every
   * spelling named in the ticket is planted here as a literal, readable string,
   * not obfuscated, this file's own scan is not blind to it: the planted text
   * sits inside a string/template literal, and the matcher strips string
   * contents before matching for the same reason it strips comments (see the
   * "does not flag a documented mention" case below), so this file is not
   * itself a violation of the rule it tests.
   */
  describe("the matcher sees every forbidden spelling", () => {
    const cases: Array<[string, string, ImportMetaEnvViolation["kind"]]> = [
      [
        "Reflect.get(import.meta, ...)",
        'const env = Reflect.get(import.meta, "env");',
        "reflect-get",
      ],
      [
        "Reflect.get spread across lines",
        'const env = Reflect.get(\n  import.meta,\n  "env",\n);',
        "reflect-get",
      ],
      ['import.meta["env"]', 'const env = import.meta["env"];', "bracket"],
      [
        "import.meta['env'] (single-quoted)",
        "const env = import.meta['env'];",
        "bracket",
      ],
      [
        "destructuring const { env } = import.meta",
        "const { env } = import.meta;",
        "destructure",
      ],
      [
        "destructuring with a rename",
        "const { env: viteEnv } = import.meta;",
        "destructure",
      ],
    ];

    it.each(cases)("catches %s", (_name, snippet, kind) => {
      const found = findImportMetaEnvViolations(snippet);
      expect(
        found.map((v) => v.kind),
        `BLIND: the matcher did not see this planted spelling, so it cannot catch it in the tree either:\n${snippet}`,
      ).toContain(kind);
    });

    it("does not flag the literal form, cast or bare", () => {
      const clean = [
        "const host = import.meta.env.VITE_SITREP_HOST;",
        "const configured = (import.meta as ImportMeta & { env?: Record<string, unknown> }).env?.VITE_SITREP_HOST;",
      ].join("\n");
      expect(findImportMetaEnvViolations(clean)).toEqual([]);
    });

    /**
     * The false-positive half, and the reason comments and strings are
     * stripped before matching. The three sites this scan exists to protect
     * now each carry a comment quoting the banned form to explain why they
     * spell the literal out (see `packages/app/src/peer/peerOptions.ts`,
     * `packages/core/src/settings/gameHost.ts`,
     * `mod/sitrep-sdk/src/api/index.ts`); a scan blind to comment context would
     * fail on its own fix.
     */
    it("does not flag a documented mention inside a comment", () => {
      const documented = [
        "/* Spelled `import.meta.env` on purpose: Vite substitutes that exact",
        '   text, and a read it cannot see (`Reflect.get(import.meta, "env")`)',
        "   is undefined in both the dev server and the bundle. */",
        "const host = import.meta.env.VITE_SITREP_HOST;",
      ].join("\n");
      expect(findImportMetaEnvViolations(documented)).toEqual([]);
    });

    it("names the line each violation sits on", () => {
      const snippet = [
        "const a = 1;",
        "const b = 2;",
        'const env = Reflect.get(import.meta, "env");',
      ].join("\n");
      const found = findImportMetaEnvViolations(snippet);
      expect(found).toHaveLength(1);
      expect(found[0]?.line).toBe(3);
    });
  });
});
