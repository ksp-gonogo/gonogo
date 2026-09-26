import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * No tracked file names the vessel.state channel in a string literal.
 *
 * The channel does not exist, and a topic is addressed by string: a test
 * topic, a fixture key, a plotted series or a carried-channel list naming it
 * all compile and resolve to nothing. Only a search sees them.
 *
 * A literal is the name inside quotes or backticks, bare or followed by a
 * field path or a template interpolation. That takes in a comment's code span
 * too, and leaves out a C# member access on KSP's own Vessel.state.
 */

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

/** Built from parts so this file does not match itself. */
const CHANNEL = ["vessel", "state"].join("\\.");

const literalOn = (channel: string) => `["'\`]${channel}(["'\`]|\\.[A-Za-z$])`;

const EVERY_TRACKED_FILE = [".", ":!*.md", ":!local_docs/*", ":!.serena/*"];

/** Files matching `pattern` under `pathspecs`, run from `cwd`. */
function gitGrepFiles(
  pattern: string,
  pathspecs: readonly string[],
  opts: { cwd: string; noIndex?: boolean },
): string[] {
  try {
    return execFileSync(
      "git",
      [
        "grep",
        opts.noIndex ? "--no-index" : "--untracked",
        "-I",
        "-l",
        "-E",
        pattern,
        "--",
        ...pathspecs,
      ],
      { cwd: opts.cwd, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
    )
      .split("\n")
      .filter((line) => line !== "");
  } catch (error) {
    // Exit status 1 is git grep's "no match", which is an answer; anything else is a search that did not run.
    if (error instanceof Error && "status" in error && error.status === 1)
      return [];
    throw error;
  }
}

/* A whole-tree git grep: well under a second on a quiet machine, many
   seconds on a loaded one, and a timeout here would read as a finding. */
describe("no string literal names the vessel.state channel", {
  timeout: 60_000,
}, () => {
  it("matches every spelling of a literal, and not a member access", () => {
    const dir = mkdtempSync(join(tmpdir(), "vessel-state-literal-"));
    const name = ["vessel", "state"].join(".");
    try {
      writeFileSync(join(dir, "topic.ts"), `useStream("${name}");\n`);
      writeFileSync(
        join(dir, "field.ts"),
        `const k = '${name}.apoapsisAlt';\n`,
      );
      writeFileSync(join(dir, "template.ts"), `const k = \`${name}.\${f}\`;\n`);
      writeFileSync(join(dir, "fixture.json"), `{ "${name}.met": 1 }\n`);
      writeFileSync(join(dir, "comment.ts"), `// reads \`${name}\`\n`);
      writeFileSync(
        join(dir, "member.cs"),
        `if (${name} != Vessel.State.DEAD) {}\n`,
      );
      writeFileSync(
        join(dir, "sibling.ts"),
        `useStream("${name}ful"); useStream("vessel.flight");\n`,
      );
      expect(
        gitGrepFiles(literalOn(CHANNEL), ["."], {
          cwd: dir,
          noIndex: true,
        }).sort(),
      ).toEqual([
        "comment.ts",
        "field.ts",
        "fixture.json",
        "template.ts",
        "topic.ts",
      ]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("reaches production, tests, fixtures and e2e specs, so an empty answer is not a blind one", () => {
    const found = gitGrepFiles(
      literalOn("vessel\\.flight"),
      EVERY_TRACKED_FILE,
      {
        cwd: REPO,
      },
    );
    for (const prefix of [
      "mod/sitrep-sdk/src/",
      "packages/components/src/",
      "packages/components/scripts/",
      "tests/playwright/",
    ]) {
      expect(found.some((file) => file.startsWith(prefix))).toBe(true);
    }
    expect(found.some((file) => file.endsWith(".json"))).toBe(true);
    expect(found.some((file) => file.endsWith(".test.ts"))).toBe(true);
  });

  it("finds none in any tracked file", () => {
    expect(
      gitGrepFiles(literalOn(CHANNEL), EVERY_TRACKED_FILE, { cwd: REPO }),
    ).toEqual([]);
  });
});
