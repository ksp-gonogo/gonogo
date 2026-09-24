import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Every workspace build that emits with `tsc` empties `dist` first.
 *
 * `tsc` writes what its sources produce and never deletes anything, so a
 * source file that is removed or renamed leaves its old output in `dist`
 * through every rebuild after. The orphan still resolves for a deep import,
 * still turns up in a grep, and still rides along in a `pnpm pack` of the
 * published sdk, while no source anywhere can be edited to change it.
 *
 * A bundler that already cleans (`tsup`, `vite build`) is not asked, and nor is
 * a `tsc --noEmit`, which writes nothing to go stale.
 */

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

/** A `tsc` invocation that emits, with no `--noEmit` on it. */
const EMITTING_TSC = /(?:^|&&\s*)tsc(?![^&]*--noEmit)\b/;

/** `rm -rf dist` somewhere before the first emitting `tsc`. */
function cleansBeforeEmit(build: string): boolean {
  const at = build.search(EMITTING_TSC);
  return at === -1 || /\brm -rf dist\b/.test(build.slice(0, at));
}

function workspaceBuilds(): Array<[string, string]> {
  return execFileSync("git", ["ls-files", "*package.json"], {
    cwd: ROOT,
    encoding: "utf8",
  })
    .split("\n")
    .filter((f) => f.endsWith("/package.json"))
    .filter((f) => /^(packages|mod)\//.test(f) && !f.includes("/vendor/"))
    .flatMap((f): Array<[string, string]> => {
      const build = JSON.parse(readFileSync(join(ROOT, f), "utf8")).scripts
        ?.build;
      return typeof build === "string" ? [[f, build]] : [];
    });
}

describe("workspace builds clean their output", () => {
  it("catches a tsc build that would leave orphans behind", () => {
    expect(cleansBeforeEmit("tsc -p tsconfig.build.json")).toBe(false);
    expect(cleansBeforeEmit("node gen.mjs && tsc -p tsconfig.build.json")).toBe(
      false,
    );
    expect(cleansBeforeEmit("tsc -p a.json && rm -rf dist")).toBe(false);
    expect(cleansBeforeEmit("rm -rf dist && tsc -p tsconfig.build.json")).toBe(
      true,
    );
    expect(cleansBeforeEmit("tsc --noEmit && vite build")).toBe(true);
    expect(cleansBeforeEmit("tsup")).toBe(true);
  });

  it("finds every tsc build in the tree clearing dist first", () => {
    const builds = workspaceBuilds();
    const emitting = builds.filter(([, b]) => EMITTING_TSC.test(b));
    // A walk that found nothing would pass by reading no scripts at all.
    expect(emitting.length).toBeGreaterThanOrEqual(10);

    const offenders = emitting
      .filter(([, b]) => !cleansBeforeEmit(b))
      .map(([f, b]) => `${f}: ${b}`);
    expect(offenders).toEqual([]);
  });
});
