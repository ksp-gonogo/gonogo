import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Design-system guard: **every test setup pins the quantity locale.**
 *
 * `formatQuantity` writes a number in the READER's locale by default, which is
 * the right answer for an operator and the wrong one for a test. The same
 * reading is `1,234,567.5` here, `1 234 567,5` in France, `12,34,567.5` in
 * India and Arabic-Indic digits in Egypt: all the same number, none of them
 * the same string. A snapshot rendered on one machine has to match one
 * rendered on another, and the per-engine visual baselines even more so.
 *
 * The failure this prevents is quiet and late. Nothing goes red when a package
 * forgets: it goes red months later, on somebody else's machine or on a runner
 * whose image changed its default locale, in a snapshot that has nothing to do
 * with units. So the pin is checked rather than remembered.
 *
 * To satisfy it, add to the package's `src/test/setup.ts`:
 *
 *     import { setQuantityLocale } from "@ksp-gonogo/ui-kit";
 *     setQuantityLocale("en-GB");
 *
 * (ui-kit's own setup imports from `../units`, since a package importing
 * itself by name resolves to the built `dist` rather than the source it is
 * testing.)
 */

function repoRoot(startDir: string): string {
  return execFileSync("git", ["rev-parse", "--show-toplevel"], {
    cwd: startDir,
    encoding: "utf8",
  }).trim();
}

/** Every vitest setup file in the workspace, found rather than listed. */
function setupFiles(root: string): string[] {
  return execFileSync(
    "git",
    [
      "ls-files",
      "--",
      "packages/*/src/test/setup.ts",
      "mod/*/client/src/test/setup.ts",
    ],
    { cwd: root, encoding: "utf8" },
  )
    .split("\n")
    .filter(Boolean);
}

const root = repoRoot(dirname(fileURLToPath(import.meta.url)));

describe("design-system: a rendered quantity is reproducible", () => {
  it("pins the locale in every package's test setup", () => {
    const files = setupFiles(root);
    // A guard that finds nothing to check is not passing, it is broken.
    expect(files.length).toBeGreaterThan(5);

    const missing = files.filter(
      (file) =>
        !readFileSync(join(root, file), "utf8").includes(
          'setQuantityLocale("en-GB")',
        ),
    );
    if (missing.length > 0) {
      throw new Error(
        "These test setups do not pin the quantity locale, so what they " +
          "render depends on the machine that ran them. Add " +
          '`setQuantityLocale("en-GB")` (imported from @ksp-gonogo/ui-kit) ' +
          `to each:\n${missing.map((f) => `  ${f}`).join("\n")}`,
      );
    }
    expect(missing).toEqual([]);
  });
});
