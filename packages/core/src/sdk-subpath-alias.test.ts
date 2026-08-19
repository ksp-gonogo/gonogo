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
      // `./biome` is a shared config file, not an importable module, so no test
      // ever resolves it and no alias is needed.
      .filter((sub) => sub !== "biome")
  );
}

/** Every vitest/vite config in the repo that aliases the sdk at all. */
function configsAliasingTheSdk(): { path: string; source: string }[] {
  const found: { path: string; source: string }[] = [];
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
      if (source.includes('"@ksp-gonogo/sitrep-sdk":')) {
        found.push({ path: full.slice(REPO_ROOT.length + 1), source });
      }
    }
  };
  walk(join(REPO_ROOT, "mod"));
  walk(join(REPO_ROOT, "packages"));
  return found;
}

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

  it("aliases every sdk subpath wherever the bare specifier is aliased", () => {
    const subpaths = sdkSubpaths();
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
