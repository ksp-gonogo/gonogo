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

const SEARCH_ROOTS = ["packages", "mod"];

function repoRoot(startDir: string): string {
  return execFileSync("git", ["rev-parse", "--show-toplevel"], {
    cwd: startDir,
    encoding: "utf8",
  }).trim();
}

function offenders(root: string): string[] {
  let out: string;
  try {
    out = execFileSync(
      "git",
      ["grep", "-nE", HALF_GUARDED, "--", ...SEARCH_ROOTS],
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
  it("has no read that guards the parent but not the quantity", () => {
    const found = offenders(root);
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
