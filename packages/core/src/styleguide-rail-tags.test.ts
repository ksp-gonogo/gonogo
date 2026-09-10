import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * The delay rail's three axes must be DERIVED at every production site, never
 * spelled out.
 *
 * There are exactly three derivations, all in `mod/sitrep-sdk/src/rail-tags.ts`:
 * `railTagsForCommand` (off what the command's owning assembly declared),
 * `railTagsForControlAxis` (a held axis is a span, delivery off the command),
 * and `railTagsForTelemetry` (direction and delivery are what telemetry
 * structurally is, continuity stated by the producer). A production site reaches
 * one of them or it is wrong.
 *
 * ## Why this is a ban rather than a budget
 *
 * Because there is no debt: the tree reached zero as part of the same change
 * that added the derivations, and the two shapes this bans are the two the rail
 * has already been bitten by.
 *
 * `Partial<RailTags>` was the escape hatch. Three types carried one, layered
 * over a default, and the layering was how the rail came to assume all three
 * axes: an entry that stated `continuity` inherited a `direction` and a
 * `delivery` nobody had thought about, and the assumption looked like a
 * declaration. Nothing needs a patch over derived axes: a producer the
 * contract does not describe declares all three through
 * `railTagsForTelemetry`, so the type is gone and must not come back.
 *
 * A hand-written triple is the same defect without the type. A site that writes
 * `direction: "telemetry"` has decided an axis rather than read one, and it goes
 * on deciding it after the derivation moves. That is what "emulating the table"
 * meant: the rail drew voice as a ribbon because a widget put it in the
 * `ribbons` array, and fly-by-wire as continuous because one command id sat in a
 * hardcoded `Set`.
 *
 * ## What is deliberately allowed
 *
 * - the derivations themselves. They are the one place an axis is decided, and
 *   each says why in prose next to the decision
 * - TESTS. A test asserting `{ direction: "telemetry", continuity: "continuous",
 *   delivery: "fire-and-forget" }` is stating the expected answer independently
 *   of the code that produced it, which is the whole value of the assertion. A
 *   test that called the derivation to build its own expectation would agree
 *   with itself forever
 */

const SCAN_ROOTS = ["packages", "mod"];

/**
 * A rail axis decided in place: `direction: "command"` / `direction: "telemetry"`.
 *
 * DIRECTION alone is the probe, not all three. It is the axis no producer has
 * any business choosing (a command id is a command, a push is telemetry), so a
 * site spelling it has necessarily bypassed a derivation, and any hand-written
 * triple contains it. Matching on `continuity` instead would catch nothing: the
 * word is a legitimate parameter name in all three derivations and in every
 * caller that passes one through.
 */
const HAND_TAGGED_RE = /direction:\s*["'](?:command|telemetry)["']/;

/**
 * The retired per-axis override type, in any spacing, in CODE.
 *
 * The lookbehind excludes a backticked mention, which is prose. This repo
 * documents its retired APIs on purpose (the note in `CommandDelay.tsx` saying
 * what the `tags` field replaced is the reason the reader knows the layering was
 * deliberate rather than an accident), and a gate that made naming a dead type
 * impossible would delete that history to quieten itself. Sixty-odd comments
 * about the retired `useDataValue` shim are the precedent.
 */
const PARTIAL_TAGS_RE = /(?<!`)Partial<\s*RailTags\s*>/;

/**
 * Where an axis may be decided: the derivations, and nothing else. A path, not a
 * name pattern, so moving the file is a deliberate edit here rather than a
 * silent widening.
 */
const DERIVATIONS = "mod/sitrep-sdk/src/rail-tags.ts";

const isTest = (rel: string): boolean =>
  /\.test\.tsx?$|\.test-d\.ts$/.test(rel);

/**
 * The scan must walk at least this many files to be believed. Without a floor
 * this file passes while seeing NOTHING: an enumeration that returns an empty
 * list finds zero offenders, and zero offenders is exactly what success looks
 * like. Same reasoning, and the same number, as `styleguide-cleanup`.
 */
const SCAN_FLOOR = 1500;

function findRepoRoot(start: string): string {
  let dir = start;
  while (dir !== "/") {
    if (existsSync(join(dir, "pnpm-workspace.yaml"))) return dir;
    dir = dirname(dir);
  }
  throw new Error(`Could not locate workspace root from ${start}`);
}

let memo: { scanned: number; handTagged: string[]; partials: string[] };

function scan(): typeof memo {
  if (memo !== undefined) return memo;
  const root = findRepoRoot(dirname(fileURLToPath(import.meta.url)));
  /*
   * git-TRACKED sources, not a filesystem walk: a live walk races the `dist/`
   * output and the temp fixtures other packages write during a concurrent
   * `turbo test`, so its count flickers, while the git index does not move
   * during a run. The cost, which will mislead anyone probing this gate: an
   * UNTRACKED file is invisible, so verifying it means `git add -N` on the
   * planted violation first. CI and the commit hook both see the index.
   */
  const tracked = execFileSync("git", ["ls-files", "-z", "--", ...SCAN_ROOTS], {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  })
    .split("\0")
    .filter((rel) => /\.tsx?$/.test(rel));

  /*
   * Narrow before reading. A file matching either regex necessarily contains
   * `direction` or `RailTags`, so this is a strict superset and the exact
   * regexes still decide every candidate.
   *
   * A narrowing that quietly matched nothing would report no offenders, which is
   * indistinguishable from a clean tree. `git grep` returns 1 when nothing
   * matches and 2 on a bad pathspec, and `execFileSync` throws on both, so a
   * broken prefilter fails this test rather than passing it. The explicit check
   * below is a backstop for one future edit: wrapping this in a try, or moving
   * to an API that returns "" instead of throwing, restores exactly the silence
   * this scan cannot afford.
   */
  const candidates = execFileSync(
    "git",
    ["grep", "-l", "-e", "direction", "-e", "RailTags", "--", ...SCAN_ROOTS],
    { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
  )
    .split("\n")
    .filter((rel) => /\.tsx?$/.test(rel));
  if (candidates.length === 0 && tracked.length > 0) {
    throw new Error(
      "styleguide-rail-tags: the git-grep prefilter matched no files while the " +
        "tree has tracked sources. The narrowing is broken, so this scan cannot " +
        "see an offender and must not report a clean result.",
    );
  }

  const handTagged: string[] = [];
  const partials: string[] = [];
  for (const rel of candidates) {
    if (isTest(rel)) continue;
    let source: string;
    try {
      source = readFileSync(join(root, rel), "utf8");
    } catch {
      continue;
    }
    if (PARTIAL_TAGS_RE.test(source)) partials.push(rel);
    if (rel === DERIVATIONS) continue;
    if (HAND_TAGGED_RE.test(source)) handTagged.push(rel);
  }
  memo = { scanned: tracked.length, handTagged, partials };
  return memo;
}

describe("the rail's axes are derived, never spelled", () => {
  it("recognises the shapes it bans, and leaves their neighbours alone", () => {
    /*
     * The patterns are exercised BEFORE the scan result is trusted: a ban whose
     * regex matches nothing passes every file in the repo.
     *
     * The samples are ASSEMBLED rather than written out, because this file is
     * itself inside the scan roots and is not on the exemption list: a literal
     * sample would make this guard its own first offender. Splitting the value
     * keeps the file subject to its own rule instead of exempting it by path,
     * which is how a guard ends up unable to see the one file it should.
     */
    const dir = "direction";
    const cmd = `"comm${"and"}"`;
    const tel = `"telem${"etry"}"`;

    expect(
      HAND_TAGGED_RE.test(`{ ${dir}: ${cmd}, continuity: "discrete" }`),
    ).toBe(true);
    expect(HAND_TAGGED_RE.test(`  ${dir}:   ${tel},`)).toBe(true);
    expect(HAND_TAGGED_RE.test(`${dir}: 'comm${"and"}'`)).toBe(true);
    // Neighbours that must NOT trip it: another `direction` field entirely, and
    // a mention of the vocabulary that decides nothing.
    expect(HAND_TAGGED_RE.test(`${dir}: "column"`)).toBe(false);
    expect(HAND_TAGGED_RE.test(`railTagsForTelemetry("continuous")`)).toBe(
      false,
    );

    const partial = `Part${"ial"}<Rail${"Tags"}>`;
    expect(PARTIAL_TAGS_RE.test(`tags?: ${partial};`)).toBe(true);
    expect(PARTIAL_TAGS_RE.test(`Part${"ial"}< Rail${"Tags"} >`)).toBe(true);
    expect(PARTIAL_TAGS_RE.test(`tags: Rail${"Tags"};`)).toBe(false);
    // A backticked mention is prose about the retired type, not a declaration
    // of one. Both verdicts exercised: a gate that could not tell them apart
    // would either miss the declaration or forbid the history.
    expect(PARTIAL_TAGS_RE.test(`replaced a \`${partial}\` override`)).toBe(
      false,
    );
  });

  it("walks the tree it claims to walk", () => {
    expect(scan().scanned).toBeGreaterThanOrEqual(SCAN_FLOOR);
  });

  it("finds no production site deciding an axis by hand", () => {
    const { scanned, handTagged } = scan();
    expect(scanned).toBeGreaterThanOrEqual(SCAN_FLOOR);
    if (handTagged.length > 0) {
      throw new Error(
        `${handTagged.length} production file(s) write a rail axis as a literal.\n` +
          "Call a derivation instead: railTagsForCommand(command) for a command, " +
          "railTagsForControlAxis(writeCommand) for a held axis, " +
          "railTagsForTelemetry(continuity) for something arriving. A site that " +
          "decides an axis goes on deciding it after the derivation moves.\n" +
          handTagged.map((o) => `  ${o}`).join("\n"),
      );
    }
    expect(handTagged).toEqual([]);
  }, 30_000);

  it("finds no per-axis override type anywhere", () => {
    const { scanned, partials } = scan();
    expect(scanned).toBeGreaterThanOrEqual(SCAN_FLOOR);
    if (partials.length > 0) {
      throw new Error(
        `${partials.length} file(s) declare a Partial<RailTags>.\n` +
          "A patch over derived axes is how the rail came to assume all three: " +
          "an entry stating one inherited two nobody had considered. Carry the " +
          "whole RailTags, built by a derivation.\n" +
          partials.map((o) => `  ${o}`).join("\n"),
      );
    }
    expect(partials).toEqual([]);
  }, 30_000);
});
