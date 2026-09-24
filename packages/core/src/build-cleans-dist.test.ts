import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Every workspace build that emits with `tsc` prunes its orphans afterwards.
 *
 * `tsc` writes what its sources produce and never deletes anything, so a
 * source file that is removed or renamed leaves its old output in `dist`
 * through every rebuild after. The orphan still resolves for a deep import,
 * still turns up in a grep, and still rides along in a `pnpm pack` of the
 * published sdk, while no source anywhere can be edited to change it.
 *
 * The prune runs AFTER `tsc` rather than as an `rm -rf dist` before it. An
 * emptied `dist` is a window in which the package has no build, and turbo runs
 * a package's own `test` alongside its own `build`: the sdk's CLI suite
 * executes `dist`, and a build killed inside that window left the sdk with no
 * `dist` at all.
 *
 * A bundler that already cleans (`tsup`, `vite build`) is not asked, and nor is
 * a `tsc --noEmit`, which writes nothing to go stale. An Uplink is not asked
 * either: it has to build outside this repo, so it cannot call a repo script.
 */

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

/** A `tsc` invocation that emits, with no `--noEmit` on it. */
const EMITTING_TSC = /(?:^|&&\s*)tsc(?![^&]*--noEmit)\b/;

const PRUNE = /&&\s*node\s+\S*scripts\/prune-dist\.mjs\b/;

/** The prune follows the first emitting `tsc`, and nothing empties `dist`. */
function prunesAfterEmit(build: string): boolean {
  const at = build.search(EMITTING_TSC);
  if (at === -1) return true;
  if (/\brm -rf dist\b/.test(build)) return false;
  return PRUNE.test(build.slice(at));
}

function workspaceBuilds(): Array<[string, string]> {
  return execFileSync("git", ["ls-files", "*package.json"], {
    cwd: ROOT,
    encoding: "utf8",
  })
    .split("\n")
    .filter((f) => f.endsWith("/package.json"))
    .filter((f) => /^(packages|mod)\//.test(f) && !f.includes("/vendor/"))
    .filter((f) => !/^mod\/Gonogo\w+Uplink\//.test(f))
    .flatMap((f): Array<[string, string]> => {
      const build = JSON.parse(readFileSync(join(ROOT, f), "utf8")).scripts
        ?.build;
      return typeof build === "string" ? [[f, build]] : [];
    });
}

describe("workspace builds prune their output", () => {
  it("catches a tsc build that would leave orphans or an empty dist behind", () => {
    expect(prunesAfterEmit("tsc -p tsconfig.build.json")).toBe(false);
    expect(prunesAfterEmit("node gen.mjs && tsc -p tsconfig.build.json")).toBe(
      false,
    );
    expect(
      prunesAfterEmit("node ../../scripts/prune-dist.mjs && tsc -p a.json"),
    ).toBe(false);
    expect(
      prunesAfterEmit(
        "rm -rf dist && tsc -p a.json && node ../../scripts/prune-dist.mjs",
      ),
    ).toBe(false);
    expect(
      prunesAfterEmit("tsc -p a.json && node ../../scripts/prune-dist.mjs"),
    ).toBe(true);
    expect(prunesAfterEmit("tsc --noEmit && vite build")).toBe(true);
    expect(prunesAfterEmit("tsup")).toBe(true);
  });

  it("finds every tsc build in the tree pruning after it emits", () => {
    const emitting = workspaceBuilds().filter(([, b]) => EMITTING_TSC.test(b));
    // A walk that found nothing would pass by reading no scripts at all.
    expect(emitting.length).toBeGreaterThanOrEqual(10);

    const offenders = emitting
      .filter(([, b]) => !prunesAfterEmit(b))
      .map(([f, b]) => `${f}: ${b}`);
    expect(offenders).toEqual([]);
  });
});
