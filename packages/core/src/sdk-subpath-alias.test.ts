import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Every subpath `@ksp-gonogo/sitrep-sdk` exports must be aliased in every Uplink
 * vitest config that aliases the sdk at all.
 *
 * The alias map does PREFIX matching, so a config that aliases the bare
 * `@ksp-gonogo/sitrep-sdk` and not `@ksp-gonogo/sitrep-sdk/<sub>` rewrites the
 * subpath to a path underneath `index.ts` and the import fails to resolve. That
 * config's comment has said "every subpath the SDK exports needs a line here" for
 * a while and nothing checked it, so adding the `/registry` subpath broke 22 test
 * files in one Uplink with `Failed to resolve import
 * "@ksp-gonogo/sitrep-sdk/registry" from packages/sitrep-testing/dist/index.js`.
 * That message points at a built bundle, so it reads as a stale-dist problem
 * rather than a missing alias.
 *
 * This lives in core because core is the package that already devDepends on the
 * sdk and holds the other cross-package ratchets. It reads both sides off disk
 * rather than importing them: a vitest config cannot be imported here (it would
 * pull in the Uplink's whole plugin chain) and the point is to compare the
 * declared surface against the declared aliases, which is a text-level fact.
 */

const REPO_ROOT = join(import.meta.dirname, "..", "..", "..");
const SDK_PKG = join(REPO_ROOT, "mod", "sitrep-sdk", "package.json");

/** The subpath names the sdk publishes, e.g. `["media", "registry", ...]`. */
function sdkSubpaths(): string[] {
  const pkg = JSON.parse(readFileSync(SDK_PKG, "utf8")) as {
    exports: Record<string, unknown>;
  };
  return (
    Object.keys(pkg.exports)
      .filter((key) => key.startsWith("./") && key !== ".")
      .map((key) => key.slice(2))
      // `./biome` and `./tsconfig.base.json` are shared CONFIG files, not
      // importable modules: nothing resolves them through the module graph, so
      // an alias would have nothing to fix. They are matched by shape rather
      // than by name so the next one does not need an edit here, and the
      // classification test below still fails on a genuinely new module subpath.
      .filter((sub) => sub !== "biome" && !sub.endsWith(".json"))
  );
}

/**
 * Every vitest/vite config in the repo, with the two ways of spotting an sdk
 * alias in it.
 *
 * A config is included here if it names the specifier at all; `aliases` records
 * whether it does so in the exact spelling the subpath check keys off. A config
 * that aliases the sdk with single quotes, through a shared helper, or behind a
 * computed key is one and not the other, and would drop out of the scan
 * silently: the gate below would then iterate an empty list and report no
 * missing subpaths.
 */
function sdkConfigs(): { path: string; source: string; aliases: boolean }[] {
  const found: { path: string; source: string; aliases: boolean }[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === "node_modules" || entry.name === "dist") continue;
      if (entry.name.startsWith(".")) continue;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      if (!/^vitest?\.config\.(ts|mts|js|mjs)$/.test(entry.name)) continue;
      const source = readFileSync(full, "utf8");
      if (!source.includes("@ksp-gonogo/sitrep-sdk")) continue;
      found.push({
        path: full.slice(REPO_ROOT.length + 1),
        source,
        aliases: source.includes('"@ksp-gonogo/sitrep-sdk":'),
      });
    }
  };
  walk(join(REPO_ROOT, "mod"));
  walk(join(REPO_ROOT, "packages"));
  return found;
}

function configsAliasingTheSdk(): { path: string; source: string }[] {
  return sdkConfigs().filter((config) => config.aliases);
}

/**
 * Which sdk subpaths a runtime-loaded Uplink can resolve at load, and which
 * deliberately cannot.
 *
 * esbuild externalises a SUBPATH of an externalised package name, so marking
 * `@ksp-gonogo/sitrep-sdk` external leaves every `@ksp-gonogo/sitrep-sdk/<sub>`
 * in a loaded bundle as a bare specifier. The app's import map then matches keys
 * exactly, so a subpath without its own `ext-*.ts` entry resolves to nothing at
 * `import(bundleUrl)`. Nothing before load can see it: it typechecks, the Uplink
 * isolation ratchet permits it (the ratchet is a denylist of packages, and the
 * sdk is permitted at any depth), and esbuild reports no warning.
 *
 * That is what happened to `/spine` when the read-frame and libration-point
 * arithmetic landed on it. Listing both halves here means the NEXT subpath forces
 * the decision to be made rather than defaulted.
 */
const RUNTIME_RESOLVABLE_SUBPATHS = ["frames", "media", "spine"];

/** Subpaths that must NOT have an entry, with the reason each is unreachable. */
const RUNTIME_ABSENT_SUBPATHS: Record<string, string> = {
  // App orchestration (which widgets a dashboard renders). The app reaches it
  // through core's re-export, so it is resolved inside the app's own build and
  // never survives as a specifier; an Uplink has no business calling it.
  registry: "app orchestration, reached through core's re-export",
  // Test-only. No shipped Uplink bundle imports it, so nothing has to resolve it
  // in a browser.
  testing: "test harness, never in a shipped bundle",
  // Build tooling. `gonogo-uplink bundle` reads it to mark specifiers external,
  // and the app reads it to bake the import map; both resolve it at BUILD time,
  // so no shipped bundle carries the specifier and nothing has to resolve it in
  // a browser.
  "uplink-externals": "build tooling, resolved before a bundle exists",
};

/*
 * The sdk's own copy, not the app's. The list moved to `@ksp-gonogo/sitrep-sdk`
 * so an Uplink author's bundler and the app's import map read ONE list: it lived
 * only in the app, which is unpublished, so an author had to hand-copy it and a
 * copy whose failure mode is a missing entry agrees by omission. The app now
 * re-exports, so reading the app's file here would parse a re-export and find
 * nothing, which is a gate that passes by seeing no entries at all.
 */
const EXTERNALS_ENTRIES = join(
  REPO_ROOT,
  "mod",
  "sitrep-sdk",
  "src",
  "uplink-externals.ts",
);

describe("sdk subpath runtime resolution", () => {
  it("classifies every declared subpath, so a new one cannot default", () => {
    const classified = new Set([
      ...RUNTIME_RESOLVABLE_SUBPATHS,
      ...Object.keys(RUNTIME_ABSENT_SUBPATHS),
    ]);
    const unclassified = sdkSubpaths().filter((sub) => !classified.has(sub));
    expect(unclassified).toEqual([]);
  });

  it("bakes an import-map entry for every runtime-resolvable subpath", () => {
    const source = readFileSync(EXTERNALS_ENTRIES, "utf8");
    const missing = RUNTIME_RESOLVABLE_SUBPATHS.filter(
      (sub) => !source.includes(`"@ksp-gonogo/sitrep-sdk/${sub}"`),
    );
    expect(missing).toEqual([]);
  });

  it("bakes no entry for a subpath nothing loads", () => {
    const source = readFileSync(EXTERNALS_ENTRIES, "utf8");
    const unexpected = Object.keys(RUNTIME_ABSENT_SUBPATHS).filter((sub) =>
      source.includes(`"@ksp-gonogo/sitrep-sdk/${sub}"`),
    );
    expect(unexpected).toEqual([]);
  });
});

describe("sdk subpath aliases", () => {
  it("finds the sdk's declared subpaths, so a green result means something", () => {
    // The probe check: if `exports` is ever restructured so this returns nothing,
    // the test below would pass vacuously against an empty list.
    expect(sdkSubpaths()).toContain("registry");
    expect(sdkSubpaths().length).toBeGreaterThanOrEqual(3);
  });

  it("finds at least one config to check, so a green result means something", () => {
    expect(configsAliasingTheSdk().length).toBeGreaterThan(0);
  });

  it("recognises the alias in every config that names the sdk at all", () => {
    /*
     * The count alone cannot carry this: one config names the sdk today, so a
     * floor is satisfied by the same single file whose respelling would empty
     * the scan. Comparing the two ways of finding it is a different kind of
     * check, and it is the one that notices.
     */
    const unrecognised = sdkConfigs()
      .filter((config) => !config.aliases)
      .map((config) => config.path);
    expect(
      unrecognised,
      'These configs name @ksp-gonogo/sitrep-sdk but not in the exact `"@ksp-gonogo/sitrep-sdk":` ' +
        "spelling the subpath check looks for, so they are aliasing it in a form this scan " +
        "cannot see and their subpath aliases are ungated.",
    ).toEqual([]);
  });

  /*
   * BUILD-only subpaths are exempt, and the reason is what the alias is for: a
   * config aliasing the bare specifier must alias every subpath a module under
   * test could import, or two subpaths resolve to two copies of the sdk and its
   * `globalThis`-backed registries stop being shared. A subpath that only build
   * tooling reads is never imported by a widget under test, so aliasing it in a
   * vitest config would be ceremony that teaches the next author nothing.
   */
  const BUILD_ONLY_SUBPATHS = new Set(["uplink-externals"]);

  it("aliases every sdk subpath wherever the bare specifier is aliased", () => {
    const subpaths = sdkSubpaths().filter(
      (sub) => !BUILD_ONLY_SUBPATHS.has(sub),
    );
    const missing: string[] = [];
    for (const { path, source } of configsAliasingTheSdk()) {
      for (const sub of subpaths) {
        if (!source.includes(`"@ksp-gonogo/sitrep-sdk/${sub}":`)) {
          missing.push(`${path} is missing "@ksp-gonogo/sitrep-sdk/${sub}"`);
        }
      }
    }
    expect(missing).toEqual([]);
  });
});
