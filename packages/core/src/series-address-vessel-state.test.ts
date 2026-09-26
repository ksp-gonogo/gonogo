import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
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
 * The same address shape on a wire topic the render harness plots, so a search
 * with the production pathspecs has something it must find there.
 */
const SERIES_ON_VESSEL_FLIGHT =
  '(key|keyHigh|xKey):[[:space:]]*"vessel\\.flight\\.';

const HARNESS = "packages/components/scripts/";

const PRODUCTION_PATHSPECS = [
  "packages/*.ts",
  "packages/*.tsx",
  "mod/*.ts",
  "mod/*.tsx",
  ":!*.test.ts",
  ":!*.test.tsx",
  ":!*/dist/*",
];

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
        "-l",
        "-E",
        pattern,
        "--",
        ...pathspecs,
      ],
      { cwd: opts.cwd, encoding: "utf8" },
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
  it("matches an address on the channel, so an empty answer is not a broken pattern", () => {
    const dir = mkdtempSync(join(tmpdir(), "series-address-"));
    try {
      writeFileSync(
        join(dir, "planted.ts"),
        'const s = { key: "vessel.state.altitudeAsl" };\n',
      );
      writeFileSync(
        join(dir, "hooked.ts"),
        'useDataSeries("data", "vessel.state.orbitalSpeed", 60);\n',
      );
      writeFileSync(
        join(dir, "clean.ts"),
        'const s = { key: "vessel.flight.altitudeAsl" };\n',
      );
      expect(
        gitGrepFiles(SERIES_ON_VESSEL_STATE, ["."], {
          cwd: dir,
          noIndex: true,
        }).sort(),
      ).toEqual(["hooked.ts", "planted.ts"]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("reaches the harness through the same pathspecs, so an empty answer is not a blind one", () => {
    expect(
      gitGrepFiles(SERIES_ON_VESSEL_FLIGHT, PRODUCTION_PATHSPECS, {
        cwd: REPO,
      }),
    ).toContain(`${HARNESS}widgets.ts`);
  });

  it("finds none in any widget, app, Uplink or harness source", () => {
    expect(
      gitGrepFiles(SERIES_ON_VESSEL_STATE, PRODUCTION_PATHSPECS, {
        cwd: REPO,
      }),
    ).toEqual([]);
  });
});
