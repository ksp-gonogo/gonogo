import { execFileSync } from "node:child_process";
import { dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { exitStatus } from "./ratchetBaseRef";

/**
 * A figure that has stopped arriving is HELD, and the tree says so in one
 * word. The other phrasing for it is banned everywhere: operator-facing copy,
 * identifiers, data attributes, comments and test names alike, so the
 * vocabulary is one thing rather than two. "Currently" is ordinary English and
 * stays.
 *
 * Scans every file git sees, untracked included, so a new file is checked
 * before it is staged. This file is the only one allowed to spell the phrase,
 * because it carries the plants below.
 */
const PATTERN = "not[ _-]?current(?!ly)|no longer current";

/**
 * Every spelling the pattern must catch, and one it must not. Each sits alone
 * on its own line of this file, so the scan's hits on this file are the proof
 * that it can see each one.
 */
const PLANTS = [
  "plant: not current",
  "plant: no longer current",
  "plant: valueNotCurrent",
  "plant: NOT_CURRENT",
  "plant: data-not-current",
] as const;
const SPARED = "plant: not currently";

function repoRoot(startDir: string): string {
  return execFileSync("git", ["rev-parse", "--show-toplevel"], {
    cwd: startDir,
    encoding: "utf8",
  }).trim();
}

/** `path:line text` for every matching line in the repo. */
function hits(root: string): string[] {
  try {
    return execFileSync(
      "git",
      ["grep", "--untracked", "-I", "-n", "-i", "-P", PATTERN, "--", "."],
      { cwd: root, encoding: "utf8", maxBuffer: 1024 * 1024 * 64 },
    )
      .split("\n")
      .filter(Boolean);
  } catch (err) {
    if (exitStatus(err) === 1) return [];
    throw err;
  }
}

const here = fileURLToPath(import.meta.url);
const root = repoRoot(dirname(here));
const self = relative(root, here);
const all = hits(root);
const own = all.filter((h) => h.startsWith(`${self}:`));
const offenders = all.filter((h) => !h.startsWith(`${self}:`));

describe("design-system: held wording", () => {
  it("names a figure that stopped arriving held, in every file", () => {
    if (offenders.length > 0) {
      throw new Error(
        `Found the banned phrasing on ${offenders.length} line(s). Say "held" ` +
          "(an identifier `xHeld`, an attribute `data-held`). Offenders:\n" +
          offenders
            .slice(0, 20)
            .map((h) => `  ${h}`)
            .join("\n"),
      );
    }
    expect(offenders).toHaveLength(0);
  });

  it("sees every planted spelling", () => {
    for (const plant of PLANTS) {
      expect(own.some((h) => h.includes(`"${plant}"`))).toBe(true);
    }
  });

  it("spares the adverb", () => {
    expect(SPARED).toContain("current");
    expect(own.some((h) => h.includes(`"${SPARED}"`))).toBe(false);
  });
});
