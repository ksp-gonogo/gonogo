// @vitest-environment node
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { SCAN_DOMAINS, SCANS_RUN_ON_ANY_CHANGE } from "../scan-domains.mjs";
import {
  changedFiles,
  scanScopeMode,
  scanSources,
  selectScans,
} from "../scan-scope.mjs";
import { scanTestFiles } from "../scan-tests.mjs";

/**
 * The changed-only local run (`pnpm scans`) skips scans and narrows others, so
 * every way it could narrow by accident is graded here, and this file runs in
 * both scopes: it has no domain, so no change can skip it.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, "..", "..", "..");

describe("which scope a run is in", () => {
  it("is the full run unless changed is asked for by name", () => {
    expect(scanScopeMode({})).toBe("full");
    expect(scanScopeMode({ GONOGO_SCANS: "" })).toBe("full");
    expect(scanScopeMode({ GONOGO_SCANS: "full" })).toBe("full");
    expect(scanScopeMode({ GONOGO_SCANS: "changed" })).toBe("changed");
  });

  it("refuses a value it does not know, rather than quietly running either", () => {
    expect(() => scanScopeMode({ GONOGO_SCANS: "chagned" })).toThrow(
      /not a scope/,
    );
  });

  it("refuses the changed run on a CI runner", () => {
    expect(() =>
      scanScopeMode({ GONOGO_SCANS: "changed", GITHUB_ACTIONS: "true" }),
    ).toThrow(/CI runs every scan/);
  });
});

describe("the changed set", () => {
  /**
   * A throwaway repo with `base` as the branch point and HEAD one commit on,
   * handed to `use` and removed in the same test rather than in a hook: an
   * `afterAll` that deletes a git directory is the classic cleanup-hook timeout
   * on this machine. An empty template keeps `.git` to a handful of files.
   */
  function withScratchRepo(use: (dir: string) => void): void {
    const dir = mkdtempSync(join(tmpdir(), "scan-scope-"));
    try {
      const git = (...args: string[]) =>
        execFileSync("git", args, { cwd: dir, stdio: "pipe" });
      git("init", "-q", "--template=", "-b", "main");
      git("config", "user.email", "scan@example.invalid");
      git("config", "user.name", "scan");
      git("config", "commit.gpgsign", "false");
      for (const f of ["kept.ts", "edited.ts", "deleted.ts", "committed.ts"]) {
        writeFileSync(join(dir, f), `export const ${f.split(".")[0]} = 1;\n`);
      }
      git("add", ".");
      git("commit", "-q", "-m", "base");
      git("tag", "base");
      writeFileSync(join(dir, "committed.ts"), "export const committed = 2;\n");
      git("commit", "-q", "-am", "on the branch");
      use(dir);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  it("holds committed, unstaged, deleted and untracked changes, and nothing else", () => {
    withScratchRepo((dir) => {
      writeFileSync(join(dir, "edited.ts"), "export const edited = 2;\n");
      rmSync(join(dir, "deleted.ts"));
      mkdirSync(join(dir, "fresh"));
      writeFileSync(join(dir, "fresh", "new.ts"), "export {};\n");
      writeFileSync(join(dir, ".gitignore"), "ignored.ts\n");
      writeFileSync(join(dir, "ignored.ts"), "export {};\n");

      const set = changedFiles({ GONOGO_SCANS_BASE: "base" }, dir);
      expect(set.ref).toBe("base");
      expect(set.files).toEqual([
        ".gitignore",
        "committed.ts",
        "deleted.ts",
        "edited.ts",
        "fresh/new.ts",
      ]);
    });
  });

  it("fails loudly when the base cannot be resolved, or nothing changed", () => {
    withScratchRepo((dir) => {
      expect(() =>
        changedFiles({ GONOGO_SCANS_BASE: "no-such-ref" }, dir),
      ).toThrow(/cannot be computed: no-such-ref does not resolve/);
      // Measured from itself, the branch has changed nothing, and a run with
      // nothing to judge must not report that as a pass.
      expect(() => changedFiles({ GONOGO_SCANS_BASE: "HEAD" }, dir)).toThrow(
        /nothing differs/,
      );
    });
  });

  it("fails loudly outside a git checkout", () => {
    const dir = mkdtempSync(join(tmpdir(), "scan-scope-nogit-"));
    try {
      expect(() => changedFiles({ GONOGO_SCANS_BASE: "HEAD" }, dir)).toThrow();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("which scans a changed set runs", () => {
  const all = scanTestFiles();
  const declared = Object.keys(SCAN_DOMAINS);
  const undeclared = all.filter((scan) => !(scan in SCAN_DOMAINS));

  it("names only scans that exist, so a renamed scan cannot keep a dead domain", () => {
    expect(declared.filter((scan) => !all.includes(scan))).toEqual([]);
    expect(declared.length).toBeGreaterThan(10);
    expect(undeclared.length).toBeGreaterThan(10);
  });

  it("always runs a scan with no declared domain", () => {
    const { run } = selectScans(all, ["nothing-reads-this.txt"]);
    expect(run).toEqual(undeclared);
  });

  it("runs a declared scan whose domain holds a changed file, and skips it otherwise", () => {
    const scan = "src/ci-mandatory-steps.test.ts";
    expect(selectScans([scan], [".github/workflows/ci.yml"]).run).toEqual([
      scan,
    ]);
    expect(
      selectScans([scan], ["packages/components/src/Twr/index.tsx"]).skipped,
    ).toEqual([scan]);
  });

  it("runs a declared scan when its own source or allowlist changed", () => {
    const scan = "src/styleguide-command-delay-single-source.test.ts";
    expect(scanSources(scan)).toContain(
      "packages/core/src/styleguide-command-delay-single-source.test.ts",
    );
    expect(selectScans([scan], [`packages/core/${scan}`]).run).toEqual([scan]);
    const helper = scanSources("src/replay-fixture-conformance.test.ts").find(
      (f) => f.startsWith("tests/"),
    );
    expect(
      helper,
      "a relative import outside core is still a source",
    ).toBeDefined();
  });

  it("runs everything when the scan machinery or the workspace ground changed", () => {
    for (const file of [
      "packages/core/scan-scope.mjs",
      "packages/core/scan-domains.mjs",
      "packages/core/vitest.scans.config.ts",
      "packages/core/src/scanScope.ts",
      "pnpm-lock.yaml",
      "tsconfig.base.json",
      "packages/app/.gitignore",
    ]) {
      expect(
        SCANS_RUN_ON_ANY_CHANGE.some((re) => re.test(file)),
        file,
      ).toBe(true);
      expect(selectScans(all, [file]).skipped, file).toEqual([]);
    }
  });
});

/**
 * Every repo path a declared scan spells out, in its own sources or in a script
 * it loads, must sit inside its domain. A domain is a claim about where a scan
 * looks; this reads where the scan says it looks and holds the two together, so
 * a scan that starts reading somewhere new fails here in CI instead of going
 * quietly unchecked in every local run.
 */
describe("each declared domain holds the paths its scan names", () => {
  const PATH_LITERAL =
    /["'`]((?:mod|packages|scripts|docs|tests|\.github)\/[^"'`\s$]*|asyncapi\.yaml|pnpm-lock\.yaml|tsconfig\.base\.json)["'`]/g;
  const SCRIPT_IMPORT = /(?:from|import)\s*\(?\s*["'](\.{1,2}\/[^"']+)["']/g;

  /** A literal as a path a changed file could have: globs filled, dirs given a child. */
  const probe = (literal: string): string => {
    const filled = literal
      .replace(/[.,:;]+$/, "")
      .replace(/\*\*?/g, "x")
      .replace(/\/+$/, "");
    const last = filled.split("/").pop() ?? "";
    return /\.[A-Za-z0-9]+$/.test(last) ? filled : `${filled}/x.ts`;
  };

  /** A script's own relative imports, transitively, repo-relative. */
  const scriptClosure = (
    rel: string,
    seen = new Set<string>(),
  ): Set<string> => {
    if (seen.has(rel) || !existsSync(join(REPO_ROOT, rel))) return seen;
    seen.add(rel);
    const text = readFileSync(join(REPO_ROOT, rel), "utf8");
    for (const m of text.matchAll(SCRIPT_IMPORT)) {
      scriptClosure(join(dirname(rel), m[1] ?? ""), seen);
    }
    return seen;
  };

  const WORKSPACE_IMPORT =
    /^import\b[^;]*?\bfrom\s*["'](@ksp-gonogo\/[a-z0-9-]+)/gm;

  /** Workspace package name to its directory, from every manifest in the tree. */
  const packageDirs = new Map<string, string>();
  for (const dir of execFileSync(
    "git",
    [
      "ls-files",
      "packages/*/package.json",
      "mod/*/package.json",
      "mod/*/client/package.json",
    ],
    { cwd: REPO_ROOT, encoding: "utf8" },
  )
    .split("\n")
    .filter(Boolean)
    .map(dirname)) {
    const name = JSON.parse(
      readFileSync(join(REPO_ROOT, dir, "package.json"), "utf8"),
    ).name;
    if (typeof name === "string") packageDirs.set(name, dir);
  }

  function strays(scan: string, domain: readonly RegExp[]): string[] {
    const sources = scanSources(scan);
    const covered = (rel: string) =>
      sources.includes(rel) ||
      domain.some((re) => re.test(rel)) ||
      SCANS_RUN_ON_ANY_CHANGE.some((re) => re.test(rel));
    const out = new Set<string>();
    for (const source of sources) {
      // Comments name paths in passing; only code says where the scan reads.
      const text = readFileSync(join(REPO_ROOT, source), "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
      // A workspace package the scan imports is code it runs, so its sources
      // are part of what the scan's verdict depends on.
      for (const m of text.matchAll(WORKSPACE_IMPORT)) {
        const dir = packageDirs.get(m[1] ?? "");
        if (dir === undefined) out.add(`${m[1]} (imported, no such package)`);
        else if (!covered(`${dir}/src/x.ts`)) out.add(`${m[1]} (imported)`);
      }
      for (const m of text.matchAll(PATH_LITERAL)) {
        const literal = m[1] ?? "";
        const rel = probe(literal);
        if (!covered(rel)) out.add(literal);
        if (/^scripts\/.*\.m?js$/.test(literal)) {
          for (const dep of scriptClosure(literal)) {
            if (!covered(dep)) out.add(`${dep} (loaded by ${literal})`);
          }
        }
      }
    }
    return [...out].sort();
  }

  it("finds the paths a scan names, so an empty result means something", () => {
    // Planted: a domain of nothing must leave every named path a stray.
    const named = strays("src/ci-mandatory-steps.test.ts", []);
    expect(named).toContain(".github/workflows/ci.yml");
    const loaded = strays("src/wire-payload-reachability.test.ts", [
      /^mod\//,
      /^scripts\/wire-payload-coverage/,
      /^scripts\/uplink-matrix/,
    ]);
    expect(
      loaded,
      "a helper the loaded script imports is part of what the scan reads",
    ).toContain(
      "scripts/asyncapi/sources.mjs (loaded by scripts/wire-payload-coverage.mjs)",
    );
    expect(packageDirs.get("@ksp-gonogo/sitrep-sdk")).toBe("mod/sitrep-sdk");
    expect(
      strays("src/uplink-topic-segments.test.ts", [/^mod\/(?!sitrep-sdk\/)/]),
      "a workspace package the scan imports is part of what it runs",
    ).toContain("@ksp-gonogo/sitrep-sdk (imported)");
  });

  for (const [scan, domain] of Object.entries(SCAN_DOMAINS)) {
    it(scan, () => {
      expect(
        strays(scan, domain),
        `${scan} names these paths and its domain in scan-domains.mjs does not match them. Widen the domain, or the changed-only run will skip this scan when they change.`,
      ).toEqual([]);
    });
  }
});
