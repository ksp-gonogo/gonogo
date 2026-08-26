import { execFileSync } from "node:child_process";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * An optional chain that reaches a `.magnitude` must stay optional the whole
 * way.
 *
 *     flight?.surfaceSpeed.magnitude   // throws
 *     flight?.surfaceSpeed?.magnitude  // undefined
 *
 * The first one guards `flight` and then reads `.magnitude` off whatever
 * `surfaceSpeed` happens to be. TypeScript is satisfied, because the contract
 * types `surfaceSpeed` as present on a `VesselFlight`. The wire disagrees: a
 * Topic sends a SUBSET of its fields routinely, which is why the decode-time
 * wrap has an explicit `if (!(field in target)) continue` rather than minting
 * the absent ones. So `flight` arrives, `surfaceSpeed` does not, and the
 * widget throws inside render.
 *
 * That is worse than a wrong number. A `TypeError` in a component body is not
 * caught by the readout's own null handling: it unmounts the widget, and in a
 * dashboard of thirty widgets sharing one error boundary it can take the
 * neighbours with it.
 *
 * Thirteen of these landed at once, all from the same mechanical pass that
 * appended `.magnitude` to reads which had become `Value`s. Every one
 * type-checked. One of them was caught by an uncaught-exception in a test that
 * otherwise reported itself as passing, which is not a mechanism to rely on
 * twice.
 *
 * The rule is purely syntactic, so a grep is the right shape of check: if a
 * chain is optional anywhere before `.magnitude`, the link immediately before
 * `.magnitude` must be optional too.
 */

// `?.foo.magnitude`: an optional chain, then a NON-optional hop, then the
// magnitude. `?.foo?.magnitude` and a plain `foo.magnitude` are both fine.
const HALF_GUARDED = String.raw`\?\.[A-Za-z_$][A-Za-z0-9_$]*\.magnitude`;

/**
 * The SAFE spelling, `?.foo?.magnitude`, which differs from the violation by one
 * character and exercises the same `\?\.`, the same character classes and the
 * same `\.magnitude`.
 *
 * Zero is this check's pass condition, so zero is also what a pattern the local
 * grep does not accept produces, and the two are indistinguishable from the
 * outside. A `\b` that POSIX ERE does not support matched nothing on macOS for
 * weeks elsewhere in this tree. Running a needle KNOWN to be present through the
 * same pipeline is what separates "looked and found nothing" from "did not
 * look".
 */
const FULLY_GUARDED = String.raw`\?\.[A-Za-z_$][A-Za-z0-9_$]*\?\.magnitude`;

/** Well under the 47 present when this was written, so ordinary edits do not trip it. */
const MIN_FULLY_GUARDED = 20;

const SEARCH_ROOTS = ["packages", "mod"];

function repoRoot(startDir: string): string {
  return execFileSync("git", ["rev-parse", "--show-toplevel"], {
    cwd: startDir,
    encoding: "utf8",
  }).trim();
}

function grepFor(root: string, pattern: string): string[] {
  let out: string;
  try {
    out = execFileSync(
      "git",
      // `--untracked` is load-bearing: `git grep` alone searches only
      // TRACKED files, so a violation introduced in a BRAND-NEW file is
      // invisible to this scan until the moment it is staged, and a local
      // run before `git add` reports success while not looking at it. It
      // still honours .gitignore, so build output stays out.
      ["grep", "--untracked", "-nE", pattern, "--", ...SEARCH_ROOTS],
      { cwd: root, encoding: "utf8", maxBuffer: 1024 * 1024 * 16 },
    );
  } catch (err) {
    // git grep exits 1 when nothing matches, which is the goal state.
    if ((err as { status?: number }).status === 1) return [];
    throw err;
  }
  return (
    out
      .split("\n")
      .filter(Boolean)
      .filter((line) => !line.includes("/dist/"))
      // A test owns the payload it emits, so a field missing there is the
      // test's own bug and it fails loudly on the spot. This guard is about
      // what a LIVE frame can withhold from a widget.
      .filter((line) => !line.includes(".test."))
  );
}

const root = repoRoot(dirname(fileURLToPath(import.meta.url)));

describe("an optional chain to a magnitude stays optional", () => {
  it("can still see a chain of this shape, so a clean result means something", () => {
    const guarded = grepFor(root, FULLY_GUARDED);
    expect(
      guarded.length,
      `Found ${guarded.length} correctly-guarded \`?.x?.magnitude\` chains, expected at least ` +
        `${MIN_FULLY_GUARDED}. The scan below reports a violation count of zero when it is ` +
        "working and when its pattern matches nothing, and this is what tells those apart.",
    ).toBeGreaterThanOrEqual(MIN_FULLY_GUARDED);
  });

  it("has no read that guards the parent but not the quantity", () => {
    const found = grepFor(root, HALF_GUARDED);
    if (found.length > 0) {
      throw new Error(
        "An optional chain stops one link short of `.magnitude`. The wire " +
          "sends a subset of a Topic's fields routinely, so the parent can " +
          "arrive without the quantity and this throws inside render rather " +
          "than reading as absent. Add the `?.`:\n" +
          found.map((f) => `  ${f}`).join("\n"),
      );
    }
    expect(found).toEqual([]);
  });
});
