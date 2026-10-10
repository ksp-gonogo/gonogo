// @vitest-environment node
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  baseStrings,
  ratchetBaseRef,
  readJsonObject,
  sourceAtRatchetBase,
} from "./ratchetBaseRef";

/**
 * Every scene fixture says what it shows, in one plain sentence in
 * `_meta.shows`, because a widget's reference page prints that sentence under
 * the state's heading and a fixture without one leaves the heading bare.
 *
 * A scene fixture is a fixture file with a `_meta` or a `_stream` key. A file
 * with neither is data a test feeds in, not a scene, and is not graded.
 *
 * Held by `fixture-shows.debt.json`, a list of fixture paths that only
 * shrinks. `GONOGO_FIXTURE_SHOWS_UPDATE=1` rewrites it with the entries that
 * now pass removed, and never adds one.
 */

const REPO_ROOT = join(import.meta.dirname, "..", "..", "..");
const DEBT_PATH = "packages/core/src/fixture-shows.debt.json";
const SCOPES = ["packages/components/src", "mod"];

const isFixture = (file: string) =>
  /(^|\/)__fixtures__\/.*\.json$/.test(file) &&
  (file.startsWith("packages/components/src/") ||
    /^mod\/[^/]+\/client\/src\//.test(file));

/** Whether a parsed fixture is a scene that fails to say what it shows. */
function lacksShows(fixture: unknown): boolean {
  if (typeof fixture !== "object" || fixture === null) return false;
  const record = fixture as Record<string, unknown>;
  if (!("_meta" in record) && !("_stream" in record)) return false;
  const meta = record._meta;
  if (typeof meta !== "object" || meta === null) return true;
  const shows = (meta as Record<string, unknown>).shows;
  return typeof shows !== "string" || shows.trim() === "";
}

function scan(): string[] {
  const files = execFileSync(
    "git",
    ["ls-files", "--cached", "--others", "--exclude-standard", ...SCOPES],
    { cwd: REPO_ROOT, encoding: "utf8" },
  )
    .split("\n")
    .filter(isFixture);
  return files
    .filter((file) => {
      try {
        return lacksShows(
          JSON.parse(readFileSync(join(REPO_ROOT, file), "utf8")),
        );
      } catch {
        return false;
      }
    })
    .sort();
}

const DEBT = (() => {
  const parsed = readJsonObject(join(REPO_ROOT, DEBT_PATH));
  const list = baseStrings({ debt: parsed.debt }, "debt");
  if (!list) throw new Error(`${DEBT_PATH} has no "debt" list of paths`);
  return list;
})();
const NOW = scan();

describe("design-system: scene fixtures say what they show", () => {
  it("grades the planted fixtures before the tree", () => {
    expect(
      [
        lacksShows({ _stream: {} }),
        lacksShows({ _meta: { notes: "no sentence" } }),
        lacksShows({ _meta: { shows: "  " } }),
        lacksShows({ _meta: { shows: "A sentence." } }),
        lacksShows({ "v.topology": [] }),
      ],
      "BLIND: a scene without a shows sentence must fail, and a documented scene or a plain data file must not",
    ).toEqual([true, true, true, false, false]);
  });

  it("reads the fixtures", () => {
    expect(NOW.length).toBeLessThan(50);
    const all = execFileSync("git", ["ls-files", ...SCOPES], {
      cwd: REPO_ROOT,
      encoding: "utf8",
    })
      .split("\n")
      .filter(isFixture);
    expect(all.length).toBeGreaterThan(200);
  });

  it("finds no fixture outside the debt list", () => {
    const unlisted = NOW.filter((file) => !DEBT.includes(file));
    expect(
      unlisted,
      `${unlisted.length} scene fixture(s) without a _meta.shows sentence. Add one saying what the scene shows:\n${unlisted.join("\n")}`,
    ).toEqual([]);
  });

  it("lists no entry that now passes", () => {
    if (process.env.GONOGO_FIXTURE_SHOWS_UPDATE) {
      writeFileSync(
        join(REPO_ROOT, DEBT_PATH),
        `${JSON.stringify({ debt: DEBT.filter((f) => NOW.includes(f)).sort() }, null, 2)}\n`,
      );
      return;
    }
    const stale = DEBT.filter((file) => !NOW.includes(file));
    expect(
      stale,
      `${stale.length} debt entr(ies) now pass or name no fixture. Remove them with GONOGO_FIXTURE_SHOWS_UPDATE=1:\n${stale.join("\n")}`,
    ).toEqual([]);
  });

  it("never grows", () => {
    const at = ratchetBaseRef();
    if (!at) return;
    const source = sourceAtRatchetBase(at, DEBT_PATH);
    if (source === null) return;
    const before = baseStrings({ debt: JSON.parse(source).debt }, "debt");
    if (!before) return;
    expect(
      DEBT.length,
      `the fixture debt grew since ${at.ref}. Give the new scene a shows sentence instead`,
    ).toBeLessThanOrEqual(before.length);
  });
});
