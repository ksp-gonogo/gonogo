import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * No production source keeps a table that sends one telemetry address to
 * another.
 *
 * A read of one name answered from a different Topic hands a widget, an alarm
 * or a saved plot a number it did not ask for, with nothing at the read site to
 * say so. A value lives on the Topic that carries it and is read there; a key
 * that stops resolving is shown as gone rather than quietly pointed elsewhere.
 *
 * Two shapes are refused: an entry whose key and value are both dotted
 * addresses, and a declaration named for redirecting.
 */

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

const ADDRESS = `["'][a-z][A-Za-z0-9]*\\.[A-Za-z0-9_.]+["']`;

/** `"vessel.flight.altitudeAsl": "vessel.orbit.sma"`, on one line. */
const ADDRESS_TO_ADDRESS = `${ADDRESS}[[:space:]]*:[[:space:]]*${ADDRESS}`;

/** `const KINEMATIC_REDIRECTS`, `function redirectSubtopic`. */
const NAMED_REDIRECT =
  "(const|let|var|function)[[:space:]]+[A-Za-z_$]*[Rr][Ee][Dd][Ii][Rr][Ee][Cc][Tt]";

const PRODUCTION_PATHSPECS = [
  "packages/*.ts",
  "packages/*.tsx",
  "mod/*.ts",
  "mod/*.tsx",
  ":!*.test.ts",
  ":!*.test.tsx",
  ":!*.test-d.ts",
  ":!*/dist/*",
];

/** Lines matching `pattern` under `pathspecs`, run from `cwd`. */
function gitGrepLines(
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
        "-n",
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
    // Exit status 1 is git grep's "no match", which is an answer; anything
    // else is a search that did not run.
    if (error instanceof Error && "status" in error && error.status === 1)
      return [];
    throw error;
  }
}

const fileOf = (line: string) => line.slice(0, line.indexOf(":"));

/* A whole-tree git grep: well under a second on a quiet machine, many
   seconds on a loaded one, and a timeout here would read as a finding. */
describe("no topic-redirect map", { timeout: 60_000 }, () => {
  it("matches both shapes, and not an ordinary topic declaration", () => {
    const dir = mkdtempSync(join(tmpdir(), "topic-redirect-"));
    try {
      writeFileSync(
        join(dir, "table.ts"),
        'const T = {\n  "vessel.flight.altitudeAsl": "vessel.orbit.sma",\n};\n',
      );
      writeFileSync(
        join(dir, "single.ts"),
        "const T = { 'comm.delay': 'comms.delay.oneWaySeconds' };\n",
      );
      writeFileSync(
        join(dir, "named.ts"),
        "const KINEMATIC_REDIRECTS = {};\nexport function redirectKinematicSubtopic() {}\n",
      );
      writeFileSync(
        join(dir, "clean.ts"),
        [
          'const def = { topic: "system.state", inputs: ["system.bodies"] };',
          'const units = { "vessel.flight.altitudeAsl": "m" };',
          'const labels = { "vessel.flight": "Flight" };',
          "",
        ].join("\n"),
      );
      const found = gitGrepLines(ADDRESS_TO_ADDRESS, ["."], {
        cwd: dir,
        noIndex: true,
      }).map(fileOf);
      expect(found.sort()).toEqual(["single.ts", "table.ts"]);
      const named = gitGrepLines(NAMED_REDIRECT, ["."], {
        cwd: dir,
        noIndex: true,
      }).map(fileOf);
      expect(named).toEqual(["named.ts", "named.ts"]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("reaches production sources in both trees, so an empty answer is not a blind one", () => {
    const found = gitGrepLines(
      "registerDerivedChannel|registerComponent",
      PRODUCTION_PATHSPECS,
      { cwd: REPO },
    ).map(fileOf);
    expect(found.some((file) => file.startsWith("mod/sitrep-sdk/src/"))).toBe(
      true,
    );
    expect(
      found.some((file) => file.startsWith("packages/components/src/")),
    ).toBe(true);
    expect(found.some((file) => file.startsWith("mod/Gonogo"))).toBe(true);
  });

  it("finds no address-to-address table", () => {
    expect(
      gitGrepLines(ADDRESS_TO_ADDRESS, PRODUCTION_PATHSPECS, { cwd: REPO }),
    ).toEqual([]);
  });

  it("finds no declaration named for redirecting", () => {
    expect(
      gitGrepLines(NAMED_REDIRECT, PRODUCTION_PATHSPECS, { cwd: REPO }),
    ).toEqual([]);
  });
});
