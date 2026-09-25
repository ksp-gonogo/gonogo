import { execFileSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * `vessel.state` is a derived channel, and a graph addresses its series by
 * string, so a compiler cannot see an address on it. Once the channel is gone
 * such a series resolves to a topic nothing publishes and draws empty, with no
 * error anywhere. Every production series is computed at the point of read
 * instead.
 */

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

const SERIES_ON_VESSEL_STATE =
  '(key|keyHigh|xKey):[[:space:]]*"vessel\\.state\\.|useDataSeries\\([^)]*"vessel\\.state\\.';

/**
 * The render harness seeds the series store by literal key and never reads the
 * channel, so its addresses are allowed. Its files are left IN the search and
 * set aside afterwards, which makes them the proof that the search reached the
 * tree it names.
 */
const HARNESS = "packages/components/scripts/";

/** Production sources addressing a series on the channel, harness included. */
function seriesAddressedOnVesselState(): string[] {
  try {
    return execFileSync(
      "git",
      [
        "grep",
        "--untracked",
        "-l",
        "-E",
        SERIES_ON_VESSEL_STATE,
        "--",
        "packages/*.ts",
        "packages/*.tsx",
        "mod/*.ts",
        "mod/*.tsx",
        ":!*.test.ts",
        ":!*.test.tsx",
        ":!*/dist/*",
      ],
      { cwd: REPO, encoding: "utf8" },
    )
      .split("\n")
      .filter((line) => line !== "");
  } catch (error) {
    // Exit status 1 is git grep's "no match", which is an answer; anything
    // else is a search that did not run.
    if (error instanceof Error && "status" in error && error.status === 1)
      return [];
    throw error;
  }
}

/* A whole-tree git grep: well under a second on a quiet machine, many
   seconds on a loaded one, and a timeout here would read as a finding. */
describe("no production series is addressed on vessel.state", {
  timeout: 60_000,
}, () => {
  const found = seriesAddressedOnVesselState();

  it("reaches the harness through the same search, so an empty answer is not a blind one", () => {
    expect(found).toContain(`${HARNESS}widgets.ts`);
  });

  it("finds none in any widget, app or Uplink source", () => {
    expect(found.filter((file) => !file.startsWith(HARNESS))).toEqual([]);
  });
});
