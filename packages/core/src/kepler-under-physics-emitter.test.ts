import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * `under-physics` means the craft is off rails: its motion is being integrated
 * rather than read off a conic. Only the not-on-rails arm of
 * `keplerAdmissibility` knows that, so any other producer is saying something
 * about the craft that nothing established.
 */

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const KEPLER_RECKONING = "mod/sitrep-sdk/src/spine/kepler-reckoning.ts";

/**
 * Production TypeScript files matching `pattern`, a POSIX extended regex. `git
 * grep --untracked` so a file not yet committed is seen too; a walk of the tree
 * reads the C# build output as well and runs past the test timeout under a full
 * suite.
 */
function productionFilesMatching(pattern: string): string[] {
  let out: string;
  try {
    out = execFileSync(
      "git",
      [
        "grep",
        "--untracked",
        "-l",
        "-E",
        pattern,
        "--",
        "mod/*.ts",
        "mod/*.tsx",
        "packages/*.ts",
        "packages/*.tsx",
        ":!*.test.ts",
        ":!*.test.tsx",
        ":!*.test-d.ts",
        ":!*/dist/*",
      ],
      { cwd: REPO, encoding: "utf8" },
    );
  } catch (error) {
    // Exit status 1 is git grep's "no match", which is an answer; anything
    // else is a search that did not run.
    if (error instanceof Error && "status" in error && error.status === 1)
      return [];
    throw error;
  }
  return out.split("\n").filter((line) => line !== "");
}

/* A whole-tree git grep: well under a second on a quiet machine, many
   seconds on a loaded one, and a timeout here would read as a finding. */
describe("under-physics has exactly one emitter", { timeout: 60_000 }, () => {
  it("is raised by the not-on-rails arm and nowhere else", () => {
    const emitters = productionFilesMatching(
      'reason:[[:space:]]*"under-physics"',
    );

    expect(emitters).toEqual([KEPLER_RECKONING]);
    const source = readFileSync(join(REPO, emitters[0]), "utf8");
    expect(source.match(/reason:\s*"under-physics"/g)).toHaveLength(1);
  });

  it("can see an emitter, so an empty answer is not a blind scan", () => {
    // The control: the same search finds the general code's many emitters,
    // including the one file the rule above names.
    const general = productionFilesMatching(
      'reason:[[:space:]]*"model-inapplicable"',
    );
    expect(general).toContain(KEPLER_RECKONING);
    expect(general.length).toBeGreaterThan(3);
  });
});
