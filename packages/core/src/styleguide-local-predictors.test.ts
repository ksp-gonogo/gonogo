import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * A prediction LandingStatus makes for itself must say why it is not a
 * registered reckoner.
 *
 * `registerReckoner` carries a Topic's own value forward past its last
 * observation. LandingStatus's solves describe an event that has not happened,
 * from measurements at the view time, and their outputs sit on no channel, so
 * none of them can be one. That is a fact about each file, and it is only worth
 * having where a maintainer reads it, so every file in the widget that predicts
 * must open a paragraph with `Not a reckoner:` and give the reason.
 *
 * A file counts as predicting when it exports a `solve*`, `predict*` or
 * `project*` function, or calls `projectDescent`. `SOLVING_FILES` names the
 * ones that exist today and each must carry the marker; a new predicting file
 * fails until it is added here with its reason written. `clocks.ts` is listed
 * by hand: its `deriveDelayClocks` has none of those prefixes, and a margin
 * computed from a solved countdown is still a prediction about the same event.
 *
 * `projectDescent` lives in the sdk, so its own file is checked for the marker
 * as well, though a caller anywhere else in the widget is found by its call.
 */

function findRepoRoot(start: string): string {
  let dir = start;
  while (dir !== "/") {
    if (existsSync(join(dir, "pnpm-workspace.yaml"))) return dir;
    dir = dirname(dir);
  }
  throw new Error(`Could not locate workspace root from ${start}`);
}

const ROOT = findRepoRoot(dirname(fileURLToPath(import.meta.url)));

const WIDGET_DIR = "packages/components/src/LandingStatus/";

const SOLVING_FILES = [
  "packages/components/src/LandingStatus/clocks.ts",
  "packages/components/src/LandingStatus/descentLayers.ts",
  "packages/components/src/LandingStatus/solveLanding.ts",
  "mod/sitrep-sdk/src/descent.ts",
];

const MARKER = /^ \* Not a reckoner:/m;

const PREDICTS_RE =
  /export (?:async )?function (?:solve|predict|project)[A-Z]\w*|\bprojectDescent\(|export const (?:solve|predict|project)[A-Z]\w*\s*=/;

function isSource(file: string): boolean {
  return (
    /\.tsx?$/.test(file) &&
    !/\.(test|test-d|stories)\.tsx?$/.test(file) &&
    !file.includes("/__")
  );
}

function trackedWidgetSources(): string[] {
  return execFileSync("git", ["ls-files", WIDGET_DIR], {
    cwd: ROOT,
    encoding: "utf8",
  })
    .split("\n")
    .filter((file) => file !== "" && isSource(file));
}

function predictingFiles(read: (file: string) => string): string[] {
  return trackedWidgetSources().filter((file) => PREDICTS_RE.test(read(file)));
}

function readRepoFile(file: string): string {
  return readFileSync(join(ROOT, file), "utf8");
}

/** The widget files that predict but are not named in `SOLVING_FILES`. */
function unlisted(found: readonly string[]): string[] {
  return found.filter((file) => !SOLVING_FILES.includes(file));
}

/** The files in `SOLVING_FILES` that carry no marker paragraph. */
function unexplained(read: (file: string) => string): string[] {
  return SOLVING_FILES.filter((file) => !MARKER.test(read(file)));
}

describe("LandingStatus predictions say why they are not reckoners", () => {
  it("can see a predictor and a marker (planted)", () => {
    for (const planted of [
      "export function solveThing() {}",
      "export function predictLanding() {}",
      "export async function projectPath() {}",
      "const x = projectDescent({ a });",
      "export const solveBurn = () => 0;",
    ]) {
      expect(PREDICTS_RE.test(planted), `blind to ${planted}`).toBe(true);
    }
    for (const innocent of [
      "export function buildPlot() {}",
      "export function deriveBoard() {}",
      "// projectDescent is mentioned in prose",
    ]) {
      expect(PREDICTS_RE.test(innocent) && !innocent.startsWith("//")).toBe(
        false,
      );
    }
    expect(MARKER.test("/**\n * Not a reckoner: because.\n */")).toBe(true);
    expect(MARKER.test("/**\n * It is not a reckoner.\n */")).toBe(false);
  });

  it("names every predicting file in the widget", () => {
    const missing = unlisted(predictingFiles(readRepoFile));
    expect(
      missing,
      `These files predict and are not in SOLVING_FILES in packages/core/src/styleguide-local-predictors.test.ts. ` +
        `Write a "Not a reckoner:" paragraph in each saying why it cannot be one, then add it.`,
    ).toEqual([]);
  });

  it("lists no file that is gone", () => {
    const gone = SOLVING_FILES.filter((file) => !existsSync(join(ROOT, file)));
    expect(
      gone,
      "These files no longer exist. Remove them from SOLVING_FILES.",
    ).toEqual([]);
  });

  it("keeps the written reason in every listed file", () => {
    expect(
      unexplained(readRepoFile),
      'These files lost their "Not a reckoner:" paragraph. Restore the reason, or decide the solve now is a reckoner.',
    ).toEqual([]);
  });

  it("fails when a listed file loses its reason (planted)", () => {
    expect(unexplained(() => "/** no reason here */")).toEqual(SOLVING_FILES);
  });

  it("fails when a new predicting file appears (planted)", () => {
    expect(unlisted([...SOLVING_FILES, `${WIDGET_DIR}newSolve.ts`])).toEqual([
      `${WIDGET_DIR}newSolve.ts`,
    ]);
  });
});
