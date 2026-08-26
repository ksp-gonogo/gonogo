// @vitest-environment node
//
// Node realm rather than the package's jsdom default, matching
// `uplink-boundary.test.ts`: the shrink-only check transpiles the allowlist at a
// git ref through esbuild, which asserts a real TextEncoder/Uint8Array realm.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { transformSync } from "esbuild";
import { describe, expect, it } from "vitest";
import { ratchetBaseRef, sourceAtRatchetBase } from "./ratchetBaseRef";
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
 * `from` is required. Without it the possessive in a comment ("`@ksp-gonogo/
 * components`'s MapView") reads as a terminated specifier, which is how a summary
 * of this audit once reported four imports that were four sentences.
 */
const IMPORT_RE = new RegExp(
  `from\\s*["']@ksp-gonogo/(${FORBIDDEN_PACKAGES.join("|")})(?:["']|/)`,
  "g",
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
    const pkg = JSON.parse(readFileSync(manifest, "utf8")) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const hits = new Set<ForbiddenPackage>();
    for (const name of Object.keys({
      ...pkg.dependencies,
      ...pkg.devDependencies,
    })) {
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

describe("uplink isolation", () => {
  /**
   * The instrument check, before any assertion that could pass by finding
   * nothing. A scan that walks zero files reports a clean repo, and a broken
   * path or a renamed directory looks exactly like success. `styleguide-earth-day`
   * shipped in that state for weeks.
   */
  it("actually scanned the Uplink clients", () => {
    const files = uplinkSourceFiles();
    expect(files.length).toBeGreaterThan(200);
    expect(
      new Set(files.map((f) => f.split("/mod/")[1]?.split("/")[0])).size,
    ).toBeGreaterThanOrEqual(8);
  });

  /**
   * Instrument check for the manifest scan, for the same reason the source scan
   * has one: `scanDeclaredDependencies` reporting nothing is indistinguishable
   * from every Uplink being clean, and a renamed directory would produce it.
   */
  it("actually read the Uplink manifests", () => {
    expect(uplinkManifests().length).toBeGreaterThanOrEqual(8);
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
   * `DerivedChannelDefinition` into `resourceProjection.ts`, a production file,
   * because the script sorted by symbol and not by who was importing.
   */
  it("no PRODUCTION Uplink file imports a test-only entry", () => {
    const isTest = (f: string) =>
      /\.test\.|\.test-d\.|\/test\/|__fixtures__|\/scripts\//.test(f);
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
        (base.FORBIDDEN_PACKAGES as readonly string[] | undefined) ??
          FORBIDDEN_PACKAGES,
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
      const baseDebt = at.lists.INTERNAL_IMPORT_DEBT as
        | Record<string, readonly ForbiddenPackage[]>
        | undefined;
      if (!baseDebt) return;
      expect(
        additions(INTERNAL_IMPORT_DEBT, baseDebt, gradedPackages(at.lists)),
        `Debt entries may only be REMOVED, never added, vs ${at.ref}. See docs/uplink-isolation.md.`,
      ).toEqual([]);
    });

    it("DECLARED_DEPENDENCY_DEBT", () => {
      const at = baseAllowlist();
      if (!at) return;
      const baseDebt = at.lists.DECLARED_DEPENDENCY_DEBT as
        | Record<string, readonly ForbiddenPackage[]>
        | undefined;
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
      const baseForbidden = at.lists.FORBIDDEN_PACKAGES as
        | readonly string[]
        | undefined;
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
      const baseBlocked = at.lists.BLOCKED_FILENAMES as
        | readonly string[]
        | undefined;
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
  const PUBLISHED = {
    "@ksp-gonogo/sitrep-sdk": join(MOD_DIR, "sitrep-sdk", "package.json"),
    "@ksp-gonogo/ui-kit": join(REPO_ROOT, "packages", "ui-kit", "package.json"),
  } as const;

  /**
   * The module subpaths a package exports. `./biome` and the `.json` configs are
   * shared CONFIG files rather than importable modules, matched by shape rather
   * than by name so the next one needs no edit here, the same way
   * `sdk-subpath-alias.test.ts` does it.
   */
  function publishedSubpaths(manifestPath: string): string[] {
    const pkg = JSON.parse(readFileSync(manifestPath, "utf8")) as {
      exports?: Record<string, unknown>;
    };
    return Object.keys(pkg.exports ?? {})
      .filter((key) => key.startsWith("./") && key !== ".")
      .map((key) => key.slice(2))
      .filter((sub) => sub !== "biome" && !sub.endsWith(".json"));
  }

  const SUBPATH_IMPORT_RE =
    /from\s*["']@ksp-gonogo\/(sitrep-sdk|ui-kit)\/([^"']+)["']/g;

  it("classifies every published subpath, so a new one cannot default", () => {
    const unclassified: string[] = [];
    for (const [pkg, manifest] of Object.entries(PUBLISHED)) {
      const author = AUTHOR_SUBPATHS[pkg] ?? {};
      const nonAuthor = NON_AUTHOR_SUBPATHS[pkg] ?? {};
      for (const sub of publishedSubpaths(manifest)) {
        if (sub in author || sub in nonAuthor) continue;
        unclassified.push(`${pkg}/${sub}`);
      }
    }
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
