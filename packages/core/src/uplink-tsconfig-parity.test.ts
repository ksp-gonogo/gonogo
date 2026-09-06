import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Every Uplink client must build on a tsconfig that TRAVELS with it.
 *
 * All ten extended `../../../tsconfig.base.json`, three levels up and out of the
 * package. Inside the workspace that resolves; an Uplink copied into its own
 * repository has no such file and does not compile. The extraction probe found
 * it, not a reading of the manifests, and it is the same shape as every client
 * declaring `react` as a peer and never as a devDependency: the workspace
 * supplies something the package does not declare.
 *
 * The fix is `@ksp-gonogo/sitrep-sdk/tsconfig.base.json`. An author already
 * depends on the sdk, so the baseline arrives with it, which is what makes it
 * the right home rather than a copy in each Uplink.
 *
 * That buys a second copy of the settings, and two copies drift. This is what
 * stops them: the shipped base and the repo's own are held identical, both ways.
 */

function findRepoRoot(start: string): string {
  let dir = start;
  while (dir !== "/") {
    if (existsSync(join(dir, "pnpm-workspace.yaml"))) return dir;
    dir = dirname(dir);
  }
  throw new Error(`Could not locate workspace root from ${start}`);
}

const ROOT = findRepoRoot(dirname(fileURLToPath(import.meta.url)));
const SHIPPED = "mod/sitrep-sdk/tsconfig.base.json";
const AUTHOR_BASE = "@ksp-gonogo/sitrep-sdk/tsconfig.base.json";

const readJson = (relative: string) =>
  JSON.parse(readFileSync(join(ROOT, relative), "utf8")) as Record<
    string,
    unknown
  >;

function uplinkClientTsconfigs(): string[] {
  const mod = join(ROOT, "mod");
  return readdirSync(mod)
    .filter((entry) => /^Gonogo.*Uplink$/.test(entry))
    .map((entry) => join("mod", entry, "client", "tsconfig.json"))
    .filter((relative) => existsSync(join(ROOT, relative)))
    .sort();
}

describe("an Uplink's tsconfig travels with it", () => {
  it("the sdk ships the author-facing base", () => {
    expect(
      existsSync(join(ROOT, SHIPPED)),
      `${SHIPPED} is missing, so every Uplink extending ${AUTHOR_BASE} stops resolving.`,
    ).toBe(true);

    const pkg = readJson("mod/sitrep-sdk/package.json") as {
      files: string[];
      exports: Record<string, unknown>;
      publishConfig: { exports: Record<string, unknown> };
    };
    expect(
      pkg.files.includes("tsconfig.base.json"),
      "the sdk's `files` does not include tsconfig.base.json, so it is not in the tarball",
    ).toBe(true);
    // Both maps, because `pack-publishable.mjs` REPLACES `exports` with
    // `publishConfig.exports` wholesale: a subpath added to one and not the
    // other resolves in the workspace and is absent for every consumer, which is
    // precisely the class of gap that made 249 bindings unresolvable.
    for (const [label, map] of [
      ["exports", pkg.exports],
      ["publishConfig.exports", pkg.publishConfig.exports],
    ] as const) {
      expect(
        Object.hasOwn(map, "./tsconfig.base.json"),
        `the sdk's ${label} has no "./tsconfig.base.json" entry`,
      ).toBe(true);
    }
  });

  it("the shipped base and the repo's own are identical", () => {
    const shipped = readJson(SHIPPED).compilerOptions;
    const repo = readJson("tsconfig.base.json").compilerOptions;
    expect(
      shipped,
      `${SHIPPED} has drifted from tsconfig.base.json. Two copies of the same settings only ` +
        `stay the same while something checks; an author would then be compiling under ` +
        `different rules from the first-party Uplinks, and would find out through a bug.`,
    ).toEqual(repo);
  });

  it("no Uplink client reaches outside its own package for a base config", () => {
    const offenders: string[] = [];
    for (const relative of uplinkClientTsconfigs()) {
      const extendsValue = readJson(relative).extends;
      if (typeof extendsValue === "string" && extendsValue.startsWith(".")) {
        offenders.push(`${relative} extends ${extendsValue}`);
      }
    }
    expect(
      offenders,
      `An Uplink client extends a RELATIVE tsconfig, which does not exist once the package ` +
        `leaves this repo. Extend ${AUTHOR_BASE} instead: it arrives with the dependency the ` +
        `Uplink already has.\n${offenders.join("\n")}`,
    ).toEqual([]);
  });

  it("finds the clients it is meant to be checking", () => {
    // A walk that returns nothing reports no offenders, which is what a clean
    // tree reports too. 8 since GonogoAvionicsUplink and GonogoRealFuelsUplink
    // left for the gonogo-uplinks repo and took their clients with them.
    expect(uplinkClientTsconfigs().length).toBeGreaterThanOrEqual(8);
  });
});
