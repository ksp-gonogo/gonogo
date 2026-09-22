// @vitest-environment node
//
// Node realm rather than the package's jsdom default, matching
// `uplink-boundary.test.ts`: the shrink-only check transpiles the allowlist at a
// git ref through esbuild, which asserts a real TextEncoder/Uint8Array realm.
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { transformSync } from "esbuild";
import { afterAll, describe, expect, it } from "vitest";
import {
  baseStringLists,
  baseStrings,
  ratchetBaseRef,
  readJsonObject,
  sourceAtRatchetBase,
} from "./ratchetBaseRef";
import {
  AUTHOR_SUBPATHS,
  BLOCKED_FILENAMES,
  DECLARED_DEPENDENCY_DEBT,
  FORBIDDEN_PACKAGES,
  type ForbiddenPackage,
  INTERNAL_IMPORT_DEBT,
  NON_AUTHOR_SUBPATHS,
} from "./uplink-isolation.allowlist";

/**
 * Uplink isolation: an Uplink client may import the PUBLISHED surfaces
 * (`@ksp-gonogo/sitrep-sdk`, `@ksp-gonogo/ui-kit`) and nothing else from this
 * repo. Reaching into `core` / `components` / `data` / `ui` / `logger` makes the
 * Uplink unbuildable by a third-party author, which is the whole point of the
 * architecture.
 *
 * Runs the opposite direction to `uplink-boundary.test.ts`. Read that file's
 * header for the outward guard; this is the inward one, and its absence is why
 * 46 files accumulated unnoticed from the first day of the Uplink architecture.
 *
 * This lives in `packages/core` rather than beside the Uplinks on purpose: core
 * is what the Uplinks must NOT depend on, so core is the right place to own the
 * rule, and when the Uplinks eventually move to their own repos the guard simply
 * stops having subjects rather than needing to move with them.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, "..", "..", "..");
const MOD_DIR = join(REPO_ROOT, "mod");
const ALLOWLIST_PATH = "packages/core/src/uplink-isolation.allowlist.ts";

/**
 * Terminated on both sides. An unterminated `@ksp-gonogo/ui` also matches
 * `@ksp-gonogo/ui-kit`, which is the PERMITTED package: that exact mistake
 * inflated a first pass at this audit from 15 real violations to 72 and sent the
 * remediation after four Uplinks that were clean. A word boundary does not save
 * you, because `-` is a non-word character and `\bui\b` matches inside `ui-kit`.
 *
 * The terminator accepts `/` as well as a quote, so a SUBPATH import
 * (`@ksp-gonogo/core/test`, which several Uplink vitest configs still alias) is
 * caught. Nothing matched that form when the alternative was added; a check that
 * only sees the bare specifier would have gone on reporting clean the first time
 * one did.
 *
 * A bare specifier is never enough on its own. Without a preceding keyword the
 * possessive in a comment ("`@ksp-gonogo/components`'s MapView") reads as a
 * terminated specifier, which is how a summary of this audit once reported four
 * imports that were four sentences. Three such possessives are in Uplink client
 * headers today.
 */
const SPECIFIER_PREFIX =
  "(?:from\\s*|import\\s*\\(\\s*|require\\s*\\(\\s*|(?:^|[;{}])[ \\t]*import\\s+)";

/**
 * Every spelling that actually REACHES a module, not just the one everybody
 * writes.
 *
 * It was `from` alone for the whole life of this gate, and `from` is three of
 * four. Planting `import "@ksp-gonogo/core";`, `import("@ksp-gonogo/components")`
 * and `require("@ksp-gonogo/logger")` together in a production Uplink file on
 * 2026-09-04 left this suite at 14/14 and the entire `core:scans` project at
 * 337/337, while the same file's canonical `from` spelling failed it
 * immediately. The gate could see one quarter of its own subject.
 *
 * The side-effect form is the one that matters most and was the most likely to
 * arrive: an Uplink client entry point registers its widgets by being imported,
 * so `import "<package>"` for its side effects is the idiom this codebase
 * already uses, and it carries every byte of the package into the bundle while
 * naming no symbol for a reviewer to notice.
 */
const IMPORT_RE = new RegExp(
  `${SPECIFIER_PREFIX}["']@ksp-gonogo/(${FORBIDDEN_PACKAGES.join("|")})(?:["']|/)`,
  "gm",
);

/**
 * Every source file in an Uplink's client, not just `client/src`.
 *
 * It WAS `client/src` alone, hardcoded, and that missed `client/scripts`, where
 * the visual-gate probe harnesses live. Three of them imported
 * `@ksp-gonogo/core` and one also `@ksp-gonogo/data`, none of which those
 * packages declare, so they were resolving through pnpm hoisting and the
 * ratchet reported clean throughout. A probe harness is Uplink code an outside
 * author has to be able to run, and a check that cannot see half the package is
 * not a check.
 */
function uplinkSourceFiles(): string[] {
  if (!existsSync(MOD_DIR)) return [];
  const out: string[] = [];
  for (const entry of readdirSync(MOD_DIR)) {
    if (!/^Gonogo.*Uplink$/.test(entry)) continue;
    const client = join(MOD_DIR, entry, "client");
    if (!existsSync(client)) continue;
    walk(client, out);
  }
  return out;
}

function walk(dir: string, out: string[]): void {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === "dist") continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.tsx?$/.test(entry)) out.push(full);
  }
}

function scan(): Map<string, Set<ForbiddenPackage>> {
  const found = new Map<string, Set<ForbiddenPackage>>();
  for (const file of uplinkSourceFiles()) {
    const rel = relative(REPO_ROOT, file).split("\\").join("/");
    const hits = new Set<ForbiddenPackage>();
    for (const m of readFileSync(file, "utf8").matchAll(IMPORT_RE)) {
      hits.add(m[1] as ForbiddenPackage);
    }
    if (hits.size > 0) found.set(rel, hits);
  }
  return found;
}

/**
 * Files under `mod/Gonogo*Uplink/client/` as git tracks them, matching
 * `pattern`, outside `node_modules` and `dist`: the independent list the walks
 * above are checked against.
 */
function trackedUplinkClientFiles(pattern: RegExp): string[] {
  return execFileSync("git", ["ls-files", "mod"], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  })
    .split("\n")
    .filter((rel) => /^mod\/Gonogo[^/]*Uplink\/client\//.test(rel))
    .filter((rel) => !/\/(node_modules|dist)\//.test(rel))
    .filter((rel) => pattern.test(rel))
    .sort();
}

/** `mod/Gonogo*Uplink/client/package.json`, in directory order. */
function uplinkManifests(): string[] {
  if (!existsSync(MOD_DIR)) return [];
  const out: string[] = [];
  for (const entry of readdirSync(MOD_DIR)) {
    if (!/^Gonogo.*Uplink$/.test(entry)) continue;
    const manifest = join(MOD_DIR, entry, "client", "package.json");
    if (existsSync(manifest)) out.push(manifest);
  }
  return out;
}

function scanDeclaredDependencies(): Map<string, Set<ForbiddenPackage>> {
  const forbidden = new Set<string>(FORBIDDEN_PACKAGES);
  const found = new Map<string, Set<ForbiddenPackage>>();
  for (const manifest of uplinkManifests()) {
    const rel = relative(REPO_ROOT, manifest).split("\\").join("/");
    const pkg = readJsonObject(manifest);
    const hits = new Set<ForbiddenPackage>();
    for (const name of dependencyNames(pkg)) {
      const suffix = name.startsWith("@ksp-gonogo/")
        ? name.slice("@ksp-gonogo/".length)
        : undefined;
      if (suffix !== undefined && forbidden.has(suffix)) {
        hits.add(suffix as ForbiddenPackage);
      }
    }
    if (hits.size > 0) found.set(rel, hits);
  }
  return found;
}

/** The dependency and devDependency names a manifest declares. */
function dependencyNames(pkg: Record<string, unknown>): string[] {
  const names: string[] = [];
  for (const field of ["dependencies", "devDependencies"]) {
    const block: unknown = pkg[field];
    if (typeof block === "object" && block !== null) {
      names.push(...Object.keys(block));
    }
  }
  return names;
}

/** A base-ref debt list keyed by Uplink, whose values name forbidden packages. */
function baseForbiddenLists(
  lists: Record<string, unknown>,
  name: string,
): Record<string, readonly ForbiddenPackage[]> | undefined {
  const raw = baseStringLists(lists, name);
  if (!raw) return undefined;
  const out: Record<string, readonly ForbiddenPackage[]> = {};
  for (const [key, entries] of Object.entries(raw)) {
    out[key] = entries as readonly ForbiddenPackage[];
  }
  return out;
}

describe("uplink isolation", () => {
  /**
   * The instrument check, before any assertion that could pass by finding
   * nothing. A scan that walks zero files reports a clean repo, and a broken
   * path or a renamed directory looks exactly like success. `styleguide-earth-day`
   * shipped in that state for weeks.
   */
  it("actually scanned the Uplink clients", () => {
    // Not a count: this was a floor of 200 files across 7 clients, and every
    // mod Uplink is leaving for the gonogo-uplinks repo. Instead every client
    // source file git tracks must have been read, and git's list must hold a
    // client that stays in this repo, so a walk reading nothing fails at any size.
    const read = new Set(
      uplinkSourceFiles().map((f) =>
        relative(REPO_ROOT, f).split("\\").join("/"),
      ),
    );
    const tracked = trackedUplinkClientFiles(/\.tsx?$/);
    expect(
      tracked.some((rel) =>
        rel.startsWith("mod/GonogoBreakingGroundUplink/client/"),
      ),
      "git lists no source for the Uplink client that stays in this repo, so this check reads nothing.",
    ).toBe(true);
    expect(
      tracked.filter((rel) => !read.has(rel)),
      "Uplink client source git tracks that the isolation walk did not read.",
    ).toEqual([]);
  });

  /**
   * Walking the right files proves only that the scan had something to read.
   * Whether it can RECOGNISE a violation in what it read is a separate
   * question, and the check above cannot ask it: both regexes below returned
   * nothing for three of the four ways to reach a module, and every count in
   * this file stayed exactly as green as it is when the tree is clean.
   *
   * So each spelling is planted here, in a string, and graded. A pattern that
   * stops matching one of them fails as BLIND rather than reporting a tree with
   * no violations in it. The false-positive half is graded in the same test
   * because widening a specifier regex is precisely when prose starts matching,
   * and three Uplink client headers carry the possessive form today.
   */
  it("recognises every spelling that reaches a module, and no prose", () => {
    const forbidden = FORBIDDEN_PACKAGES[0];
    const seen = (source: string) =>
      [...source.matchAll(IMPORT_RE)].map((m) => m[1]);

    const reaches: Record<string, string> = {
      "static named": `import { a } from "@ksp-gonogo/${forbidden}";`,
      "static side-effect": `import "@ksp-gonogo/${forbidden}";`,
      "side-effect, indented": `  import "@ksp-gonogo/${forbidden}";`,
      "re-export": `export * from "@ksp-gonogo/${forbidden}";`,
      dynamic: `const m = await import("@ksp-gonogo/${forbidden}");`,
      require: `const m = require("@ksp-gonogo/${forbidden}");`,
      subpath: `import { a } from "@ksp-gonogo/${forbidden}/test";`,
    };
    const missed = Object.entries(reaches)
      .filter(([, source]) => !seen(source).includes(forbidden))
      .map(([spelling]) => spelling);
    expect(
      missed,
      [
        "IMPORT_RE cannot see a spelling that reaches the module anyway.",
        "",
        "Every check in this file reports an empty offender list when the",
        "pattern misses, which is the same thing it reports when the tree is",
        "clean. Widen the pattern; do not narrow this list.",
      ].join("\n"),
    ).toEqual([]);

    const prose: Record<string, string> = {
      possessive: `// see @ksp-gonogo/${forbidden}'s registry`,
      "bare mention": `// this used to live in @ksp-gonogo/${forbidden}`,
      "permitted sibling": `import { a } from "@ksp-gonogo/ui-kit";`,
    };
    const falsePositives = Object.entries(prose)
      .filter(([, source]) => seen(source).length > 0)
      .map(([kind]) => kind);
    expect(
      falsePositives,
      "IMPORT_RE matched something that is not an import. A false positive here sends remediation after clean files, which is how one pass at this audit grew from 15 violations to 72.",
    ).toEqual([]);
  });

  /**
   * Instrument check for the manifest scan, for the same reason the source scan
   * has one: `scanDeclaredDependencies` reporting nothing is indistinguishable
   * from every Uplink being clean, and a renamed directory would produce it.
   */
  it("actually read the Uplink manifests", () => {
    // Held to git's list of client manifests rather than to a floor of 7.
    const tracked = trackedUplinkClientFiles(/\/client\/package\.json$/);
    expect(tracked).toContain(
      "mod/GonogoBreakingGroundUplink/client/package.json",
    );
    expect(
      uplinkManifests()
        .map((f) => relative(REPO_ROOT, f).split("\\").join("/"))
        .sort(),
    ).toEqual(tracked);
  });

  it("no Uplink client imports an app-internal package outside the debt list", () => {
    const found = scan();
    const unlisted: string[] = [];
    for (const [file, pkgs] of found) {
      const allowed = INTERNAL_IMPORT_DEBT[file];
      if (!allowed) {
        unlisted.push(`${file} -> ${[...pkgs].join(", ")}`);
        continue;
      }
      for (const pkg of pkgs) {
        if (!allowed.includes(pkg)) unlisted.push(`${file} -> ${pkg}`);
      }
    }
    expect(
      unlisted,
      [
        "An Uplink client imported an app-internal package.",
        "",
        "An Uplink may import @ksp-gonogo/sitrep-sdk and @ksp-gonogo/ui-kit only.",
        "Those are the published surfaces; a third-party Uplink author has no",
        "access to core/components/data/ui/logger, so an Uplink that imports one",
        "cannot be built outside this repo.",
        "",
        "Do NOT add these to the debt list: it is shrink-only and a new entry",
        "means new code just created the violation. Move the export you need into",
        "sitrep-sdk or ui-kit and re-point the import.",
        "",
        "See docs/uplink-isolation.md.",
      ].join("\n"),
    ).toEqual([]);
  });

  /**
   * The two `/testing` subpaths are published, so every check above is happy with
   * them, and a widget importing one would ship test code inside a runtime bundle.
   *
   * This used to name `@ksp-gonogo/sitrep-testing`, which was a whole package and is
   * deleted. The hazard did not go with it, it generalised: the harness lives on
   * `@ksp-gonogo/sitrep-sdk/testing` and `@ksp-gonogo/ui-kit/testing` now, and both
   * are one import away from any widget. Left naming the dead package, this check
   * could no longer express a failure and would have reported success forever.
   *
   * It is not hypothetical either. When the harness first moved, a bulk re-point put
   * `DerivedChannelDefinition` into `resourceProjection.ts` (since deleted), a
   * production file,
   * because the script sorted by symbol and not by who was importing.
   */
  it("no PRODUCTION Uplink file imports a test-only entry", () => {
    // `gonogo-render.setup.ts` is test-only code that does not live under a
    // test path: it is the render harness's own glue, the sanctioned successor
    // to the `client/scripts/` probes this pattern already covers, and it
    // exists to stand up the fakes a scene needs. It never reaches a runtime
    // bundle, being named only by the generated browser entry.
    const isTest = (f: string) =>
      /\.test\.|\.test-d\.|\/test\/|__fixtures__|\/scripts\/|\/gonogo-render\.setup\.tsx?$/.test(
        f,
      );
    const testOnlyEntry =
      /from\s*["']@ksp-gonogo\/(?:sitrep-sdk|ui-kit)\/testing["']/;
    const offenders = uplinkSourceFiles()
      .map((f) => relative(REPO_ROOT, f).split("\\").join("/"))
      .filter((f) => !isTest(f))
      .filter((f) =>
        testOnlyEntry.test(readFileSync(join(REPO_ROOT, f), "utf8")),
      );
    expect(
      offenders,
      [
        "A production Uplink file imported a test-only entry.",
        "",
        "Both /testing subpaths are published, so the isolation checks above allow",
        "them, but they exist for a test: Testing Library, the host injector, the",
        "dashboard provider stack. Importing one from a widget puts all of it in a",
        "runtime bundle.",
        "",
        "If a widget needs the symbol at runtime, it belongs on the ROOT barrel of",
        "@ksp-gonogo/sitrep-sdk or @ksp-gonogo/ui-kit, not on a testing entry.",
      ].join("\n"),
    ).toEqual([]);
  });

  it("does not re-introduce a blocked strategy", () => {
    const offenders = uplinkSourceFiles()
      .map((f) => relative(REPO_ROOT, f).split("\\").join("/"))
      .filter((f) => BLOCKED_FILENAMES.some((b) => f.endsWith(`/${b}`)));
    expect(
      offenders,
      [
        "A blocked strategy came back.",
        "",
        "These are patterns removed rather than allowlisted, because they need an",
        "app-internal import to work at all. A gate a third-party Uplink author",
        "cannot run is not a gate. Put the check app-side.",
        "",
        "See BLOCKED_FILENAMES in uplink-isolation.allowlist.ts for each one's story.",
      ].join("\n"),
    ).toEqual([]);
  });

  /**
   * The declaration half of the same rule. An import that resolves only through
   * pnpm workspace hoisting is not one an outside author has, and the reverse
   * (a declared dependency nothing imports) is a lie about the package's shape
   * that outlives the import by weeks: two Uplinks still declared `components`
   * when this check was written, long after the last import died.
   */
  it("no Uplink client DECLARES an app-internal package outside the debt list", () => {
    const found = scanDeclaredDependencies();
    const unlisted: string[] = [];
    for (const [manifest, pkgs] of found) {
      const allowed = DECLARED_DEPENDENCY_DEBT[manifest];
      if (!allowed) {
        unlisted.push(`${manifest} -> ${[...pkgs].join(", ")}`);
        continue;
      }
      for (const pkg of pkgs) {
        if (!allowed.includes(pkg)) unlisted.push(`${manifest} -> ${pkg}`);
      }
    }
    expect(
      unlisted,
      [
        "An Uplink client's package.json declares an app-internal package.",
        "",
        "A dependency that works locally through pnpm workspace hoisting is not a",
        "dependency you have: an outside author installing from the registry gets",
        "module-not-found. Declare only published packages.",
        "",
        "Same rule as the import list: do NOT add an entry here, move the export",
        "you need into a published package instead.",
        "",
        "See docs/uplink-isolation.md.",
      ].join("\n"),
    ).toEqual([]);
  });

  /**
   * The staleness direction, which neither the import scan nor the declaration
   * scan catches on its own: a manifest entry for a package this Uplink no
   * longer imports anywhere. It still makes the Uplink uninstallable for an
   * outsider while looking like a live dependency to everyone reading it, which
   * is how one Uplink's `components` declaration AND its vitest alias outlived
   * the last import by weeks, with a comment explaining a type-only import that
   * no file had contained for just as long.
   *
   * Derived from the two scans rather than from a list of its own, so it has no
   * upkeep and cannot itself go stale.
   */
  /**
   * The debt lists are checked for GROWTH everywhere else in this file. Nothing
   * checked whether an entry's violation was still there, so a fix somewhere else
   * left the entry behind, silently, and the list could never reach zero by
   * attrition: someone had to notice each dead line by hand. Publishing the render
   * harness fixed a dozen files at a stroke and left a dozen stale entries nobody
   * would have looked for.
   *
   * With this, every fix anywhere is an automatic reduction, and the list is
   * self-cleaning rather than merely non-growing. It is the counterpart to
   * `FORBIDDEN_PACKAGES never shrinks`: that one stops the SUBJECT narrowing, this
   * one stops the LIST outliving its subject.
   */
  it("lists no debt that is already fixed", () => {
    const found = scan();
    const stale: string[] = [];
    for (const [file, pkgs] of Object.entries(INTERNAL_IMPORT_DEBT)) {
      const actual = found.get(file);
      if (!actual) {
        stale.push(`${file} (whole entry: imports none of ${pkgs.join(", ")})`);
        continue;
      }
      for (const pkg of pkgs) {
        if (!actual.has(pkg)) stale.push(`${file} -> ${pkg}`);
      }
    }
    const declared = scanDeclaredDependencies();
    for (const [manifest, pkgs] of Object.entries(DECLARED_DEPENDENCY_DEBT)) {
      const actual = declared.get(manifest);
      if (!actual) {
        stale.push(
          `${manifest} (whole entry: declares none of ${pkgs.join(", ")})`,
        );
        continue;
      }
      for (const pkg of pkgs) {
        if (!actual.has(pkg)) stale.push(`${manifest} -> ${pkg}`);
      }
    }
    expect(
      stale,
      [
        "The debt list names a violation that no longer exists.",
        "",
        "Good news: something fixed it. Delete the line(s) above so the list keeps",
        "telling the truth about what is left. A debt list that outlives its debt",
        "reads as work remaining and hides how close to zero this is.",
      ].join("\n"),
    ).toEqual([]);
  });

  it("declares nothing it no longer imports", () => {
    const imported = new Map<string, Set<ForbiddenPackage>>();
    for (const [file, pkgs] of scan()) {
      const uplink = file.split("/")[1];
      const into = imported.get(uplink) ?? new Set<ForbiddenPackage>();
      for (const pkg of pkgs) into.add(pkg);
      imported.set(uplink, into);
    }
    const stale: string[] = [];
    for (const [manifest, pkgs] of scanDeclaredDependencies()) {
      const uplink = manifest.split("/")[1];
      for (const pkg of pkgs) {
        if (!imported.get(uplink)?.has(pkg))
          stale.push(`${manifest} -> ${pkg}`);
      }
    }
    expect(
      stale,
      [
        "An Uplink declares a forbidden package no file in it imports.",
        "",
        "Delete the declaration, and any vitest alias that went with it. The",
        "point of clearing an import is to stop depending on the package, and a",
        "manifest entry left behind still does.",
      ].join("\n"),
    ).toEqual([]);
  });

  describe("the debt lists only ever shrink", () => {
    /**
     * Both lists as they stood at the ratchet base, with the ref they came from
     * so a failure can quote it.
     *
     * `ratchetBaseRef` THROWS when no base can be reached, which is the whole
     * point of it. This used to catch that and return `undefined`, and every
     * caller below opens by returning early on `undefined`, so an unreachable
     * base made the shrink check evaporate and report green. Undefined now
     * means only that the checkout IS the base (nothing to diff) or that the
     * list did not exist there, and `ratchet-base-ref.test.ts` grades the
     * second case in one place rather than leaving each caller to shrug at it.
     */
    function baseAllowlist():
      | { ref: string; lists: Record<string, unknown> }
      | undefined {
      const at = ratchetBaseRef();
      if (!at) return undefined;
      const baseSource = sourceAtRatchetBase(at, ALLOWLIST_PATH);
      if (baseSource === null) return undefined;
      const js = transformSync(baseSource, {
        loader: "ts",
        format: "cjs",
      }).code;
      const module_ = { exports: {} as Record<string, unknown> };
      new Function("module", "exports", js)(module_, module_.exports);
      return { ref: at.ref, lists: module_.exports };
    }

    /**
     * Compare only packages forbidden at BOTH ends. When `FORBIDDEN_PACKAGES`
     * itself changes, entries for a newly-forbidden package are a reseed rather
     * than new debt, and grading them as growth would make it impossible to
     * widen the rule without disabling its own ratchet. Debt for a package
     * forbidden at both ends is still strictly shrink-only, which is the part
     * that has to hold.
     */
    function gradedPackages(base: Record<string, unknown>): Set<string> {
      const baseForbidden = new Set(
        baseStrings(base, "FORBIDDEN_PACKAGES") ?? FORBIDDEN_PACKAGES,
      );
      return new Set(
        FORBIDDEN_PACKAGES.filter((pkg) => baseForbidden.has(pkg)),
      );
    }

    function additions(
      current: Record<string, readonly ForbiddenPackage[]>,
      base: Record<string, readonly ForbiddenPackage[]>,
      graded: Set<string>,
    ): string[] {
      const added: string[] = [];
      for (const [file, pkgs] of Object.entries(current)) {
        const relevant = pkgs.filter((pkg) => graded.has(pkg));
        if (relevant.length === 0) continue;
        const before = base[file];
        if (!before) {
          added.push(`${file} (whole entry: ${relevant.join(", ")})`);
          continue;
        }
        for (const pkg of relevant) {
          if (!before.includes(pkg)) added.push(`${file} -> ${pkg}`);
        }
      }
      return added;
    }

    it("INTERNAL_IMPORT_DEBT", () => {
      const at = baseAllowlist();
      if (!at) return;
      const baseDebt = baseForbiddenLists(at.lists, "INTERNAL_IMPORT_DEBT");
      if (!baseDebt) return;
      expect(
        additions(INTERNAL_IMPORT_DEBT, baseDebt, gradedPackages(at.lists)),
        `Debt entries may only be REMOVED, never added, vs ${at.ref}. See docs/uplink-isolation.md.`,
      ).toEqual([]);
    });

    it("DECLARED_DEPENDENCY_DEBT", () => {
      const at = baseAllowlist();
      if (!at) return;
      const baseDebt = baseForbiddenLists(at.lists, "DECLARED_DEPENDENCY_DEBT");
      // Absent at the base: the list was seeded after it, so every entry is the
      // seed rather than growth. Graded from the next commit onwards.
      if (!baseDebt) return;
      expect(
        additions(DECLARED_DEPENDENCY_DEBT, baseDebt, gradedPackages(at.lists)),
        `Declared-dependency debt may only be REMOVED, never added, vs ${at.ref}. See docs/uplink-isolation.md.`,
      ).toEqual([]);
    });

    /**
     * The debt lists shrink; the list of what counts as debt does the OPPOSITE.
     * Dropping a name from `FORBIDDEN_PACKAGES` looks exactly like progress from
     * every other angle in this file: the scan stops finding that package, its
     * entries can be deleted as "cleared", and the shrink checks grade only
     * packages forbidden at BOTH ends, so they stop grading it too. The suite
     * goes green by no longer asking the question.
     *
     * That is not hypothetical. Clearing `ui` and `test-utils` from the debt
     * list on 2026-08-18 was done with a regex over this file, which matched the
     * entries AND the `FORBIDDEN_PACKAGES` members, and the full suite passed
     * with `ui` silently unguarded, because by then nothing imported it. A build
     * error over an unrelated union type is the only reason anyone looked.
     */
    it("FORBIDDEN_PACKAGES never shrinks", () => {
      const at = baseAllowlist();
      if (!at) return;
      const baseForbidden = baseStrings(at.lists, "FORBIDDEN_PACKAGES");
      if (!baseForbidden) return;
      const now = new Set<string>(FORBIDDEN_PACKAGES);
      expect(
        baseForbidden.filter((pkg) => !now.has(pkg)),
        [
          `A package was REMOVED from FORBIDDEN_PACKAGES vs ${at.ref}.`,
          "",
          "The rule may widen, never narrow. An Uplink importing a private",
          "package is unbuildable by an outside author whether or not this list",
          "still mentions it, and removing the name only stops the guard asking.",
          "",
          "If an Uplink no longer imports it, delete the DEBT ENTRIES and leave",
          "the package here so the next one is caught.",
        ].join("\n"),
      ).toEqual([]);
    });

    /**
     * `BLOCKED_FILENAMES` has the same property as `FORBIDDEN_PACKAGES` and needs
     * the same counterpart. Deleting an entry passes everything: the blocked-
     * strategy check then finds no offenders because it is no longer looking for
     * any, which is indistinguishable from the strategy not having come back.
     *
     * It is worse here than for the package list, because a blocked filename is a
     * strategy someone already arrived at twice by careful reasoning from a wrong
     * premise. It is the entry MOST likely to be removed by someone who has just
     * re-derived it and believes they are correcting an oversight.
     */
    it("BLOCKED_FILENAMES never shrinks", () => {
      const at = baseAllowlist();
      if (!at) return;
      const baseBlocked = baseStrings(at.lists, "BLOCKED_FILENAMES");
      if (!baseBlocked) return;
      const now = new Set<string>(BLOCKED_FILENAMES);
      expect(
        baseBlocked.filter((name) => !now.has(name)),
        [
          `A name was REMOVED from BLOCKED_FILENAMES vs ${at.ref}.`,
          "",
          "These are strategies removed rather than allowlisted, each with its own",
          "story in the allowlist. Deleting the entry does not unblock the",
          "strategy, it only stops the guard looking for it, and the suite then",
          "goes green for the wrong reason.",
          "",
          "If you believe one no longer applies, say so in the allowlist and leave",
          "the name in place.",
        ].join("\n"),
      ).toEqual([]);
    });
  });
});

/**
 * The subpath half of the rule, which the package-level checks structurally
 * cannot reach. `IMPORT_RE` is a denylist of package NAMES and both published
 * packages are permitted at any depth, so a widget importing
 * `@ksp-gonogo/sitrep-sdk/spine` passes every check above. The extraction probe
 * passes it too, because `/spine` is published and therefore resolves and
 * typechecks outside the workspace: being installable is exactly what makes it
 * invisible to a gate that asks whether an Uplink can leave.
 *
 * Measured on 2026-08-26 by planting that import in a production Uplink file:
 * this suite reported 12 of 12 passing and the extraction probe reported zero
 * errors, with `docs/uplink-isolation.md` saying in as many words that `/spine`
 * is not an author surface.
 */
describe("uplink subpath isolation", () => {
  const plantDirs: string[] = [];
  afterAll(() => {
    for (const dir of plantDirs.splice(0)) rmSync(dir, { recursive: true });
  });

  /**
   * Every package this repo PUBLISHES, discovered rather than named.
   *
   * It was a two-entry literal, and that made the scan blind along a dimension
   * it never reported: `@ksp-gonogo/uplink-tools` is published, is a
   * devDependency of every Uplink, and had all of its subpaths unclassified
   * while this test passed. Adding `@ksp-gonogo/ui-kit/grid` failed it
   * immediately and correctly in the same run, which is what a gate that
   * discovers one dimension and hardcodes another looks like from the inside.
   *
   * The walk is over `pnpm-workspace.yaml`'s own globs, so a package cannot be
   * published from a directory this does not read. `private: true` is what
   * excludes a package, matching what `npm publish` would actually do, rather
   * than a second list to keep in step.
   */
  function discoverPublished(): Record<string, string> {
    const found: Record<string, string> = {};
    for (const dir of [
      join(REPO_ROOT, "packages"),
      MOD_DIR,
      ...readdirSync(MOD_DIR, { withFileTypes: true })
        .filter((e) => e.isDirectory())
        .map((e) => join(MOD_DIR, e.name, "client")),
    ]) {
      if (!existsSync(dir)) continue;
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const manifest = entry.isDirectory()
          ? join(dir, entry.name, "package.json")
          : entry.name === "package.json"
            ? join(dir, entry.name)
            : undefined;
        if (!manifest || !existsSync(manifest)) continue;
        // Narrowed rather than asserted: this reads an arbitrary manifest off
        // disk, which is exactly the boundary `unknown` is for.
        const pkg: unknown = JSON.parse(readFileSync(manifest, "utf8"));
        if (typeof pkg !== "object" || pkg === null) continue;
        const name = "name" in pkg ? pkg.name : undefined;
        if (typeof name !== "string") continue;
        if ("private" in pkg && pkg.private === true) continue;
        if (!("exports" in pkg) || !pkg.exports) continue;
        found[name] = manifest;
      }
    }
    return found;
  }

  const PUBLISHED = discoverPublished();

  /**
   * The floor the discovery cannot drop below without saying so.
   *
   * A walk that finds nothing reports every subpath classified, which is the
   * failure mode this whole describe exists to prevent, one level up. Three is
   * what the repo publishes today; it is a FLOOR rather than an equality so
   * that publishing a fourth package does not fail here, where it has nothing
   * to say. It fails where it should: unclassified subpaths.
   */
  const MIN_PUBLISHED_PACKAGES = 3;

  /**
   * The module subpaths a package exports. `./biome` and the `.json` configs are
   * shared CONFIG files rather than importable modules, matched by shape rather
   * than by name so the next one needs no edit here, the same way
   * `sdk-subpath-alias.test.ts` does it.
   */
  function publishedSubpaths(manifestPath: string): string[] {
    const exports = readJsonObject(manifestPath).exports;
    return Object.keys(
      typeof exports === "object" && exports !== null ? exports : {},
    )
      .filter((key) => key.startsWith("./") && key !== ".")
      .map((key) => key.slice(2))
      .filter((sub) => sub !== "biome" && !sub.endsWith(".json"));
  }

  /**
   * The same four spellings the package-level scan reads, from the same
   * fragment, so the two cannot drift apart again: this one grew `import(`
   * when it was written and the package-level one did not, and the header
   * there said so for nine days without anything closing the gap.
   *
   * A vitest alias is none of them. It is `"<specifier>": path.resolve(...)`,
   * with no keyword and no call, and one Uplink config aliases both non-author
   * subpaths today because `sdk-subpath-alias.test.ts` requires every published
   * subpath to be aliased wherever the sdk is.
   *
   * The package alternation is DERIVED from the same walk the classification
   * uses, not written out. Hardcoding `(sitrep-sdk|ui-kit)` here left this half
   * blind to `@ksp-gonogo/uplink-tools` in exactly the way the classification
   * half was: planting an Uplink import of `/widgets` failed only the dedicated
   * widgets test and went unseen by this one, so a published package's subpaths
   * could be imported freely as long as nobody had written a bespoke test for
   * them. Fixing one half and not the other would have left the ticket half
   * done and looking finished.
   */
  const SUBPATH_IMPORT_RE = new RegExp(
    `${SPECIFIER_PREFIX}["']@ksp-gonogo/(${Object.keys(PUBLISHED)
      .map((name) => name.replace("@ksp-gonogo/", ""))
      .join("|")})/([^"']+)["']`,
    "gm",
  );

  /**
   * The subpath scan's own blindness floor, for the reason the package-level
   * one has it: `offenders` is empty both when no Uplink imports `/spine` and
   * when the pattern has stopped being able to say so.
   */
  it("recognises every spelling that reaches a subpath", () => {
    const seen = (source: string) =>
      [...source.matchAll(SUBPATH_IMPORT_RE)].map((m) => `${m[1]}/${m[2]}`);
    const reaches: Record<string, string> = {
      "static named": `import { a } from "@ksp-gonogo/sitrep-sdk/spine";`,
      "static side-effect": `import "@ksp-gonogo/sitrep-sdk/spine";`,
      "re-export": `export * from "@ksp-gonogo/sitrep-sdk/spine";`,
      dynamic: `const m = await import("@ksp-gonogo/sitrep-sdk/spine");`,
      require: `const m = require("@ksp-gonogo/sitrep-sdk/spine");`,
    };
    const missed = Object.entries(reaches)
      .filter(([, source]) => !seen(source).includes("sitrep-sdk/spine"))
      .map(([spelling]) => spelling);
    expect(
      missed,
      "SUBPATH_IMPORT_RE cannot see a spelling that reaches the subpath anyway. Widen SPECIFIER_PREFIX rather than narrowing this list.",
    ).toEqual([]);
    expect(
      seen(`// the arithmetic lives in @ksp-gonogo/sitrep-sdk/frames`),
      "SUBPATH_IMPORT_RE matched prose.",
    ).toEqual([]);
  });

  /** A throwaway manifest exporting `subpaths`, for the blindness plants. */
  function manifestWith(subpaths: string[]): string {
    const dir = mkdtempSync(join(tmpdir(), "uplink-isolation-plant-"));
    plantDirs.push(dir);
    const file = join(dir, "package.json");
    writeFileSync(
      file,
      JSON.stringify({
        name: "@planted/pkg",
        exports: Object.fromEntries(subpaths.map((s) => [s, "./x.js"])),
      }),
    );
    return file;
  }

  /**
   * Extracted from the test body so the blindness check below can run it
   * against PLANTED manifests. Inline, the only thing that could exercise it
   * was the repo's real state, which is exactly the state it is supposed to be
   * auditing.
   */
  function unclassifiedSubpaths(published: Record<string, string>): string[] {
    const unclassified: string[] = [];
    for (const [pkg, manifest] of Object.entries(published)) {
      const author = AUTHOR_SUBPATHS[pkg] ?? {};
      const nonAuthor = NON_AUTHOR_SUBPATHS[pkg] ?? {};
      for (const sub of publishedSubpaths(manifest)) {
        if (sub in author || sub in nonAuthor) continue;
        unclassified.push(`${pkg}/${sub}`);
      }
    }
    return unclassified;
  }

  it("discovers every published package, so a whole one cannot go unread", () => {
    expect(
      Object.keys(PUBLISHED).length,
      `The published-package walk found ${Object.keys(PUBLISHED).length} (${Object.keys(PUBLISHED).join(", ")}), below the floor of ${MIN_PUBLISHED_PACKAGES}. A walk that finds nothing reports every subpath classified. Fix the walk, or lower the floor deliberately if a package genuinely stopped being published.`,
    ).toBeGreaterThanOrEqual(MIN_PUBLISHED_PACKAGES);
    for (const manifest of Object.values(PUBLISHED)) {
      expect(existsSync(manifest), `${manifest} does not exist`).toBe(true);
    }
  });

  it("reports an unclassified subpath in EVERY published package, not just the first", () => {
    // Two planted packages, not one: a reader that stops at its first find, or
    // carries state between iterations, passes a single plant and fails this.
    // The same lesson as a `/g` regex skipping the second occurrence.
    const planted = {
      "@ksp-gonogo/sitrep-sdk": manifestWith(["./planted-one"]),
      "@ksp-gonogo/ui-kit": manifestWith(["./planted-two"]),
    };
    expect(unclassifiedSubpaths(planted).sort()).toEqual([
      "@ksp-gonogo/sitrep-sdk/planted-one",
      "@ksp-gonogo/ui-kit/planted-two",
    ]);
    // And it is the CLASSIFICATION doing the work, not the planting: a subpath
    // that is listed comes back clean through the same path.
    expect(
      unclassifiedSubpaths({
        "@ksp-gonogo/ui-kit": manifestWith(["./testing"]),
      }),
    ).toEqual([]);
  });

  it("records a real reason for every classification, not a placeholder", () => {
    /**
     * Generalised from the guard written for the pending state: a decision with
     * no reason recorded is how a classification becomes folklore. `./widgets`
     * is the worked example, its reason being the operator's own words plus the
     * ticket, which is what this is protecting.
     */
    for (const [label, map] of [
      ["author", AUTHOR_SUBPATHS],
      ["non-author", NON_AUTHOR_SUBPATHS],
    ] as const) {
      for (const [pkg, subs] of Object.entries(map)) {
        for (const [sub, reason] of Object.entries(subs)) {
          expect(
            reason.length,
            `${label} ${pkg}/${sub} needs the reason written down, not an empty placeholder`,
          ).toBeGreaterThan(40);
        }
      }
    }
  });

  it("classifies every published subpath, so a new one cannot default", () => {
    const unclassified = unclassifiedSubpaths(PUBLISHED);
    expect(
      unclassified,
      [
        "A published subpath is classified neither as an author surface nor as one",
        "an Uplink must not import.",
        "",
        "Defaulting is what this list exists to prevent: a new subpath is reachable",
        "the moment it is published, and every other gate in the tree permits it.",
        "Decide, and record the reason, in AUTHOR_SUBPATHS or NON_AUTHOR_SUBPATHS in",
        "packages/core/src/uplink-isolation.allowlist.ts.",
      ].join("\n"),
    ).toEqual([]);
  });

  it("no Uplink file imports a subpath that is not an author surface", () => {
    const offenders: string[] = [];
    for (const file of uplinkSourceFiles()) {
      const rel = relative(REPO_ROOT, file).split("\\").join("/");
      for (const match of readFileSync(file, "utf8").matchAll(
        SUBPATH_IMPORT_RE,
      )) {
        const pkg = `@ksp-gonogo/${match[1]}`;
        const sub = match[2];
        if (sub in (AUTHOR_SUBPATHS[pkg] ?? {})) continue;
        const why = NON_AUTHOR_SUBPATHS[pkg]?.[sub];
        offenders.push(`${rel} -> ${pkg}/${sub}${why ? `: ${why}` : ""}`);
      }
    }
    expect(
      offenders,
      [
        "An Uplink imported a subpath of a published package that is not an author",
        "surface.",
        "",
        "Being published is not permission. /spine and /registry resolve, install and",
        "typecheck for anyone, which is precisely why nothing else catches this: the",
        "package denylist permits the sdk at any depth and the extraction probe finds",
        "a tarball that does contain them.",
        "",
        "Take what you need off the ROOT barrel, or off /frames for the frame",
        "arithmetic. If it is not there, move it there.",
        "",
        "See docs/uplink-isolation.md.",
      ].join("\n"),
    ).toEqual([]);
  });
});

/**
 * `@ksp-gonogo/uplink-tools/widgets` is the app's own widgets, registered, so an
 * Uplink's docs page can draw an augment inside its real host. It is PUBLISHED,
 * which is what makes it reachable from outside this repo at all, and that is
 * exactly what makes it dangerous: every other rule in this file works by a
 * package being unpublished, and this one cannot.
 *
 * Pulling the widgets into the UI kit is only for the docs page, not for
 * anything else, so the line is not WHETHER an Uplink may name it, but WHERE:
 *
 *   - `devDependencies` and `gonogo.renderWith`: yes. That is the whole purpose
 *   - `dependencies`: no. A runtime dependency is the Uplink shipping the app's
 *     widget library to its users
 *   - any `import` in client source: no. There is nothing to import: the
 *     package exports no symbols, only the side effect of registration, so an
 *     import is someone reaching past the exports map for a widget
 *
 * Position is the whole check, which is why this cannot be an entry in
 * `FORBIDDEN_PACKAGES`: that list is scanned across `dependencies` and
 * `devDependencies` together and would ban the one position that is correct.
 */
describe("uplink-tools/widgets is a render-time module, not an import", () => {
  /**
   * TWO names, and conflating them silently disarms half this gate.
   *
   * A manifest can only ever declare the PACKAGE; `dependencies` never holds a
   * subpath. An import, by contrast, has to name the subpath, because the
   * package root is the harness API that `uplink-page.test.ts` legitimately
   * imports in five Uplinks.
   *
   * Written as one constant, the manifest half looks for
   * `@ksp-gonogo/uplink-tools/widgets` in `dependencies`, which nothing can ever
   * contain, so it passes for ever while reading exactly like a check.
   */
  const TOOLS_PACKAGE = "@ksp-gonogo/uplink-tools";
  const WIDGETS_MODULE = `${TOOLS_PACKAGE}/widgets`;

  /**
   * Same spellings as `IMPORT_RE`, for the one subpath.
   *
   * `m` but deliberately NOT `g`: this one is used with `.test()`, and a global
   * regex carries `lastIndex` between calls, so testing a second file starts
   * partway through it and can miss a match the file plainly contains. Clean,
   * that is invisible (nothing matches, `lastIndex` stays 0) and it only
   * shows once TWO files are in violation, which is the worst time to find out.
   *
   * `replaceAll`, not `replace`: the latter takes only the FIRST slash, and
   * this specifier has two.
   */
  const WIDGETS_MODULE_IMPORT_RE = new RegExp(
    `${SPECIFIER_PREFIX}["']${WIDGETS_MODULE.replaceAll("/", "\\/")}(?:["']|/)`,
    "m",
  );

  /**
   * Does this manifest TEXT declare the package as a runtime dependency?
   *
   * Takes the source rather than a path so the instrument check below can feed
   * it a planted manifest and exercise this exact reader, instead of asserting
   * that a separate copy of the same lookup behaves the same way.
   *
   * Narrowed rather than cast: `JSON.parse` hands back `any`, and an `as` here
   * would assert the shape this is trying to establish. `unknown-cast.test.ts`
   * holds this file to a ceiling for that reason.
   */
  function declaresItAtRuntime(manifestSource: string): boolean {
    const parsed: unknown = JSON.parse(manifestSource);
    if (typeof parsed !== "object" || parsed === null) return false;
    if (!("dependencies" in parsed)) return false;
    const deps = parsed.dependencies;
    if (typeof deps !== "object" || deps === null) return false;
    return TOOLS_PACKAGE in deps;
  }

  function manifestsDeclaringItAsARuntimeDependency(): string[] {
    return uplinkManifests()
      .filter((manifest) => declaresItAtRuntime(readFileSync(manifest, "utf8")))
      .map((manifest) => relative(REPO_ROOT, manifest).split("\\").join("/"));
  }

  function sourceFilesImportingIt(): string[] {
    return uplinkSourceFiles().filter((file) =>
      WIDGETS_MODULE_IMPORT_RE.test(readFileSync(file, "utf8")),
    );
  }

  /**
   * Both scanners, graded against a planted violation of each, because both
   * report an empty list when they are blind and an empty list is what a clean
   * tree reports too. There are no Uplinks declaring or importing this package
   * today, so without this test the two checks below would pass on a tree where
   * neither scanner could see anything at all.
   */
  it("can see a violation of each position it forbids", () => {
    const seen = (source: string) => WIDGETS_MODULE_IMPORT_RE.test(source);

    const reaches: Record<string, string> = {
      "static named": `import { a } from "${WIDGETS_MODULE}";`,
      "static side-effect": `import "${WIDGETS_MODULE}";`,
      "re-export": `export * from "${WIDGETS_MODULE}";`,
      dynamic: `const m = await import("${WIDGETS_MODULE}");`,
      require: `const m = require("${WIDGETS_MODULE}");`,
      subpath: `import { a } from "${WIDGETS_MODULE}/anything";`,
    };
    expect(
      Object.entries(reaches)
        .filter(([, source]) => !seen(source))
        .map(([spelling]) => spelling),
      "The import pattern cannot see a spelling that reaches the module anyway.",
    ).toEqual([]);

    const prose: Record<string, string> = {
      possessive: `// ${WIDGETS_MODULE}'s registrations`,
      "renderWith declaration": `"renderWith": ["${WIDGETS_MODULE}"]`,
      "permitted sibling": `import { Panel } from "@ksp-gonogo/ui-kit";`,
    };
    expect(
      Object.entries(prose)
        .filter(([, source]) => seen(source))
        .map(([kind]) => kind),
      "The import pattern matched something that is not an import. The renderWith entry is the case that matters: it names the package in the manifest on purpose, and a pattern that reads it as an import fails the very thing it is meant to permit.",
    ).toEqual([]);

    /**
     * The manifest scanner, graded through the reader the check itself uses:
     * forbidden in `dependencies`, permitted in `devDependencies`. The
     * permitted position is the one worth planting, because a reader that
     * reported BOTH would fail every correctly-written Uplink.
     */
    expect(
      declaresItAtRuntime(
        `{"dependencies":{"${TOOLS_PACKAGE}":"^0.1.0"},"devDependencies":{}}`,
      ),
      "The manifest reader cannot see a runtime declaration.",
    ).toBe(true);
    expect(
      declaresItAtRuntime(
        `{"devDependencies":{"${TOOLS_PACKAGE}":"^0.1.0"},"dependencies":{}}`,
      ),
      "The manifest reader flags the devDependency, which is the position this package is FOR.",
    ).toBe(false);
  });

  it("no Uplink client declares the widgets module as a runtime dependency", () => {
    expect(
      manifestsDeclaringItAsARuntimeDependency(),
      [
        `An Uplink client declares ${TOOLS_PACKAGE} in "dependencies".`,
        "",
        "It belongs in devDependencies. It exists to render the docs page and",
        "for nothing else, so a runtime dependency on it means this Uplink now",
        "ships the app's whole widget library to its users.",
        "",
        'Move it to devDependencies and name it in "gonogo.renderWith".',
        "",
        "See docs/uplink-isolation.md.",
      ].join("\n"),
    ).toEqual([]);
  });

  it("no Uplink client source imports the widgets module", () => {
    expect(
      sourceFilesImportingIt().map((f) =>
        relative(REPO_ROOT, f).split("\\").join("/"),
      ),
      [
        `An Uplink client file imports ${WIDGETS_MODULE}.`,
        "",
        "There is nothing in it to import: it exports no symbols, only the",
        "side effect of registering the app's widgets so a docs render can",
        "find a scene's host. An import is therefore someone reaching for an",
        "app widget to use for real, which is the thing this package was put",
        "behind its own name to prevent.",
        "",
        'Name it in "gonogo.renderWith" instead. If you need a component from',
        "it, move that component into @ksp-gonogo/ui-kit.",
        "",
        "See docs/uplink-isolation.md.",
      ].join("\n"),
    ).toEqual([]);
  });
});
