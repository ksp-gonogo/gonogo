// @vitest-environment node
//
// Node realm rather than the package's jsdom default, matching
// `uplink-isolation.test.ts`: the shrink-only half transpiles the allowlist at a
// git ref through esbuild, which asserts a real TextEncoder/Uint8Array realm.

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { transformSync } from "esbuild";
import { describe, expect, it } from "vitest";
import {
  BANNER_COMMENT_DEBT,
  MATCHER_REVISION,
  SCAN_FLOORS,
} from "./banner-comments.allowlist";
import {
  bannersIn,
  handWrittenSources,
  scanBanners,
} from "./banner-comments.matcher";
import {
  baseCounts,
  baseNumber,
  ratchetBaseRef,
  ratchetRepoRoot,
  sourceAtRatchetBase,
} from "./ratchetBaseRef";

/**
 * Banner-comment ratchet. CLAUDE.md has always said "no banner comments above an
 * obvious call" and nothing enforced it, so the population grew for months.
 *
 * The DEFINITION lives in `banner-comments.matcher.ts` and the numbers live in
 * `banner-comments.allowlist.ts`. This file is the grading, and nothing else.
 *
 * THREE NUMBERS, AND THEY DISAGREE ON PURPOSE. A loose scan for "a comment line
 * that is a run of rule characters" finds 664 lines across 161 files. A whole
 * tree review reported that count as the banner population and it is not: most
 * of those lines are a bare wrap with no title, which labels nothing, and the
 * rest bracket a prose paragraph. This ratchet counts 423 banners across 93
 * files. Between the two sat the count this gate could actually SEE before
 * 2026-09-02, which was 238, because the matcher knew only the one-line
 * spelling. Re-running the loose regex and finding ~670 is not evidence that
 * this ratchet is broken; running it and finding a number BELOW 423 is.
 *
 * The rule this enforces is about DECORATION, not about section structure.
 *
 * The tree reached zero banners on 2026-09-30 (Saga 697): `BANNER_COMMENT_DEBT`
 * is empty and the `SECTIONED_CEILINGS`/`SCHEME_MIN` exemption for long
 * sectioning tables is retired, since a count floor cannot sit above zero. The
 * instrument check for "can this scan still see a banner" is now a planted
 * violation, same shape as the other zero-count scans in this tree.
 *
 * Lives in `packages/core` because core holds this repo's cross-package
 * ratchets, and because `pnpm test` in core is the `test` job CI actually runs.
 * A type-level check would gate nothing: `pnpm typecheck` is not a CI job.
 */

const ALLOWLIST_PATH = "packages/core/src/banner-comments.allowlist.ts";
const MATCHER_PATH = "packages/core/src/banner-comments.matcher.ts";

const RESULT = scanBanners();

/** Rule characters assembled at runtime, so no literal below is itself a banner. */
const RULE = "-".repeat(3);

describe("banner comments", () => {
  /**
   * The instrument check, before any assertion that can pass by finding
   * nothing. Every other test in this file is `expect(offenders).toEqual([])`,
   * and a scan that walks zero files satisfies all of them. A wrong cwd, a
   * renamed root, a `git ls-files` that errors into an empty string: each looks
   * exactly like a clean repo.
   *
   * The floors are far below the seeded numbers rather than equal to them, so
   * ordinary churn does not touch this and only a broken enumeration does.
   */
  it("actually scanned the source tree", () => {
    const banners = [...RESULT.counts.values()].reduce((a, b) => a + b, 0);
    const summary = [
      `scanned ${RESULT.scanned} files`,
      `${RESULT.generated} skipped as generated`,
      `${RESULT.counts.size} files carry a banner`,
      `${banners} banner lines`,
      `matcher revision ${MATCHER_REVISION}`,
    ].join(", ");
    // The census, not a boolean. A number in the log is what lets the next
    // person tell "found nothing" from "looked at nothing", and it is only
    // visible under `--reporter=verbose`; the default reporter mutes console
    // output for tests that pass.
    console.info(`[banner-comments] ${summary}`);
    expect(RESULT.scanned, summary).toBeGreaterThanOrEqual(SCAN_FLOORS.files);
    expect(RESULT.counts.size, summary).toBe(0);
    expect(banners, summary).toBe(0);
  });

  /**
   * The population floors this test used to carry (`filesWithBanner`,
   * `banners`) cannot survive a real count of zero: a floor above zero fails a
   * clean tree, and a floor of zero cannot distinguish "found nothing" from
   * "looked at nothing." So the instrument check for the matcher's ability to
   * SEE a banner is a planted violation instead, the same shape
   * `styleguide-magnitude-budget.test.ts` uses once its own ratchet reached
   * zero.
   *
   * Planted in an isolated tmpdir, never the repo tree: this whole file runs
   * alongside every other whole-tree scan in the same `vitest run`, each
   * walking `git ls-files` from the repo root on its own schedule, so a real
   * file written into `packages/core/src` is a live race against every one of
   * them (measured: `styleguide-token-refs.test.ts` read this file mid-write
   * and threw ENOENT the moment the `finally` block below deleted it). A
   * tmpdir outside the repo is invisible to every other scan by construction,
   * so this reads the planted file back the same way `scanBanners` does
   * (`readFileSync` + split + `bannersIn`) without touching anything another
   * test can see.
   */
  it("can see a banner (planted)", () => {
    const dir = mkdtempSync(join(tmpdir(), "banner-comments-"));
    const planted = join(dir, "p.ts");
    try {
      writeFileSync(
        planted,
        [`// ${RULE} Planted section ${RULE}`, "export {};", ""].join("\n"),
      );
      const lines = readFileSync(planted, "utf8").split("\n");
      expect(bannersIn(lines)).toEqual([`// ${RULE} Planted section ${RULE}`]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  /**
   * The instrument check for the matcher itself, which the file-count floor
   * above cannot give: `scanned` stays healthy if the matcher is edited into
   * something that matches nothing, and the debt assertions then read as a repo
   * that cleaned itself overnight.
   *
   * EVERY SPELLING IS PLANTED HERE, and that is the point rather than
   * thoroughness for its own sake. This gate has now been blind twice, and both
   * times the proof-it-fires test planted only the spelling its author already
   * had in mind: an ASCII one-line banner, while 134 files wrote box-drawing
   * ones and 56 wrote the spread form. A planted case that shares the matcher's
   * blind spot proves nothing about the shape it cannot match. So each case
   * below is a form found in the wild, and the negatives are the shapes the
   * definition deliberately excludes.
   *
   * Every literal is built from pieces, so this file contains no line its own
   * scan would report.
   */
  describe("the matcher sees every spelling the tree actually writes", () => {
    const cases: Array<[string, string[]]> = [
      ["one line, ASCII", [`// ${RULE} Registration ${RULE}`]],
      [
        "one line, indented and padded",
        [`  // ${RULE}- recorded calls ${RULE}-`],
      ],
      ["one line, equals rule", [`// ${"=".repeat(4)} Time ${"=".repeat(4)}`]],
      [
        "one line, box drawing",
        [`// ${"─".repeat(4)} Vessel ${"─".repeat(4)}`],
      ],
      [
        "spread over three lines",
        [`// ${"-".repeat(20)}`, "// Vessel telemetry", `// ${"-".repeat(20)}`],
      ],
      [
        "spread, with the title wrapped onto a second line",
        [
          `// ${"-".repeat(20)}`,
          "// Career capture (funds/reputation/science, facility",
          "// levels+costs, contracts, strategies, unlocked tech)",
          `// ${"-".repeat(20)}`,
        ],
      ],
      [
        "spread, box drawing",
        [`// ${"═".repeat(20)}`, "// Flight history", `// ${"═".repeat(20)}`],
      ],
      [
        "spread, C# doc comment lead",
        [`/// ${"-".repeat(20)}`, "/// The gate.", `/// ${"-".repeat(20)}`],
      ],
      [
        "spread, inside a block comment",
        [
          ` * ${"-".repeat(20)}`,
          " * fleet delay absent",
          ` * ${"-".repeat(20)}`,
        ],
      ],
      [
        "two stacked back to back share no rule line",
        [
          `// ${"-".repeat(20)}`,
          "// First",
          `// ${"-".repeat(20)}`,
          `// ${"-".repeat(20)}`,
          "// Second",
          `// ${"-".repeat(20)}`,
        ],
      ],
    ];

    it.each(cases)("names a banner written %s", (_name, lines) => {
      expect(bannersIn(lines).length).toBeGreaterThanOrEqual(1);
    });

    const negatives: Array<[string, string[]]> = [
      ["a bare rule that labels nothing", [`// ${"-".repeat(60)}`]],
      [
        "a paragraph that merely opens with rule characters",
        [`// ${RULE} a paragraph that wraps onward`],
      ],
      ["a two-dash bullet", ["// -- a two-dash bullet, not a banner"]],
      [
        "a rule opening a block that never closes with one",
        [`// ${"-".repeat(20)}`, "// prose", "// more prose", "const x = 1;"],
      ],
      [
        "an essay bracketed by rules, which is prose, not a title",
        [
          `// ${"-".repeat(20)}`,
          "// one",
          "// two",
          "// three",
          "// four",
          `// ${"-".repeat(20)}`,
        ],
      ],
      [
        "a title interrupted by a blank comment line",
        [
          `// ${"-".repeat(20)}`,
          "// heading",
          "//",
          "// the paragraph under it",
          `// ${"-".repeat(20)}`,
        ],
      ],
      [
        "two rules with nothing between them",
        [`// ${"-".repeat(20)}`, `// ${"-".repeat(20)}`],
      ],
    ];

    it.each(negatives)("does not name %s", (_name, lines) => {
      expect(bannersIn(lines)).toEqual([]);
    });

    /**
     * The counting check the per-case assertions cannot give. Each case above
     * asserts "at least one", which a matcher that returns a hit for every line
     * would also satisfy.
     */
    it("counts a stacked pair as two banners, not three", () => {
      const rule = `// ${"-".repeat(20)}`;
      expect(
        bannersIn([rule, "// First", rule, rule, "// Second", rule]),
      ).toEqual(["// First", "// Second"]);
    });
  });

  /**
   * Growth. A file with a banner and no entry, or a file whose count has gone
   * up, both land here. The count is per file rather than per repo so the
   * message names the file, which is the whole difference between a gate
   * somebody acts on and a gate somebody mutes.
   */
  it("adds no banner comment to a file that is not already carrying one", () => {
    const offenders: string[] = [];
    for (const [file, count] of RESULT.counts) {
      const budget = BANNER_COMMENT_DEBT[file];
      if (budget !== undefined) {
        if (count > budget) {
          offenders.push(
            `${file}: ${count} banner(s), debt list says ${budget}`,
          );
        }
        continue;
      }
      offenders.push(
        `${file}: ${count} banner(s), unlisted -> ${RESULT.titles.get(file)?.[0]}`,
      );
    }
    expect(
      offenders,
      [
        "A banner comment appeared where the ratchet was not expecting one.",
        "",
        'CLAUDE.md: no banner comments ("// --- Registration ---") above an',
        "obvious call, and a rule / title / rule sandwich is the same thing",
        "spread over three lines. Delete the rule characters. If the comment is",
        "worth keeping, keep the sentence and drop the decoration; if it only",
        "restates the call below it, drop the whole line.",
        "",
        "Do NOT add an entry to banner-comments.allowlist.ts. The debt list is",
        "shrink-only and a new entry means new code just created the violation.",
      ].join("\n"),
    ).toEqual([]);
  });

  /**
   * The staleness direction, and the reason the debt counts are exact rather
   * than ceilings. Nothing else notices when a banner is cleaned, so the entry
   * sits there reading as work remaining, and the list can never reach zero by
   * attrition. With this, every cleanup anywhere is an automatic reduction and
   * the next person to touch the file is told to write the smaller number down.
   */
  it("records no banner that is already gone", () => {
    const stale: string[] = [];
    for (const [file, expected] of Object.entries(BANNER_COMMENT_DEBT)) {
      const actual = RESULT.counts.get(file) ?? 0;
      if (actual < expected) {
        stale.push(`${file} says ${expected}, actually ${actual}`);
      }
    }
    expect(
      stale,
      [
        "The debt list claims more banners than the file still has.",
        "",
        "Good news: something cleaned them. Lower the number, or delete the line",
        "when the count reaches 0, so the list keeps telling the truth about what",
        "is left. A debt list that outlives its debt reads as work remaining and",
        "hides how close to zero this is.",
      ].join("\n"),
    ).toEqual([]);
  });

  describe("the debt list only ever shrinks", () => {
    /**
     * The list as it stood at the ratchet base, with the ref it came from so a
     * failure can quote it.
     *
     * `ratchetBaseRef` THROWS when no base can be reached. This used to catch
     * that and return `undefined`, which every caller below treats as "nothing
     * to check", so an unreachable base turned the whole shrink check into a
     * pass. Undefined now means only that the checkout IS the base or that the
     * list did not exist there, and `ratchet-base-ref.test.ts` grades the
     * second case.
     */
    function baseAllowlist():
      | { ref: string; sha: string; lists: Record<string, unknown> }
      | undefined {
      const at = ratchetBaseRef();
      if (!at) return undefined;
      const source = sourceAtRatchetBase(at, ALLOWLIST_PATH);
      if (source === null) return undefined;
      return { ref: at.ref, sha: at.sha, lists: load(source) };
    }

    /**
     * A module at a git ref, transpiled and evaluated in this process.
     *
     * `require` is passed in rather than left out. The allowlist is pure data
     * and imports nothing, so it did not need one; the matcher reaches for
     * `node:fs` and friends, and without a require in scope the transpiled CJS
     * dies with "require is not defined" the first time a widening tries to
     * re-run the previous matcher, which is the one moment this has to work.
     */
    function load(source: string): Record<string, unknown> {
      const js = transformSync(source, { loader: "ts", format: "cjs" }).code;
      const module_ = { exports: {} as Record<string, unknown> };
      new Function("module", "exports", "require", js)(
        module_,
        module_.exports,
        createRequire(import.meta.url),
      );
      return module_.exports;
    }

    function additions(
      current: Record<string, number>,
      base: Record<string, number>,
    ): string[] {
      const added: string[] = [];
      for (const [file, count] of Object.entries(current)) {
        const before = base[file];
        if (before === undefined) {
          added.push(`${file} (new entry: ${count})`);
          continue;
        }
        if (count > before) added.push(`${file} (${before} -> ${count})`);
      }
      return added;
    }

    /**
     * Whether this commit is declaring a widened matcher, and the proof that it
     * really is one.
     *
     * A widening is the only change that legitimately raises these numbers, and
     * the numbers alone cannot show the difference between "the gate learned to
     * see a spelling" and "somebody wrote more banners". So the claim is checked
     * rather than believed, in the only way that actually settles it: run the
     * OLD matcher over the CURRENT tree. If the old matcher still measures what
     * the old numbers say, every newly counted banner is one it could not see,
     * and none of them is new code.
     */
    function reseed(base: {
      ref: string;
      sha: string;
      lists: Record<string, unknown>;
    }): { declared: false } | { declared: true; before: number } {
      const was = baseNumber(base.lists, "MATCHER_REVISION");
      if (was === MATCHER_REVISION) return { declared: false };
      // An allowlist predating the constant is revision 1 by definition.
      const before = was ?? 1;
      expect(
        MATCHER_REVISION,
        `MATCHER_REVISION may only go up (${before} at ${base.ref}).`,
      ).toBeGreaterThan(before);

      const now = readFileSync(join(ratchetRepoRoot(), MATCHER_PATH), "utf8");
      const then = sourceAtRatchetBase(base, MATCHER_PATH);
      expect(
        then === null || then !== now,
        `MATCHER_REVISION went ${before} -> ${MATCHER_REVISION} but ${MATCHER_PATH} ` +
          `is byte-identical to ${base.ref}. The revision declares a widened ` +
          "matcher; bumping it without one re-seeds every shrink-only number for " +
          "nothing.",
      ).toBe(true);

      const total = [...RESULT.counts.values()].reduce((a, b) => a + b, 0);
      if (then === null) {
        console.info(
          `[banner-comments] re-seed ${before} -> ${MATCHER_REVISION} at ` +
            `${total} banners in ${RESULT.counts.size} files. ${MATCHER_PATH} ` +
            `does not exist at ${base.ref}, so the previous matcher cannot be ` +
            "re-run and this re-seed is UNCHECKED. True only of the commit that " +
            "introduces the module; every later one is graded.",
        );
        return { declared: true, before };
      }

      const old = load(then) as { bannersIn?: typeof bannersIn };
      expect(
        typeof old.bannersIn,
        `${MATCHER_PATH} at ${base.ref} exports no bannersIn, so the previous ` +
          "matcher cannot be re-run and the re-seed cannot be checked.",
      ).toBe("function");

      // The whole point of the re-seed: re-grade the CURRENT tree with the OLD
      // matcher against the OLD numbers. A floor on the old total would not do
      // it, because a banner ADDED in the same commit only pushes that total up.
      // Passing the old gate outright is what shows the tree is clean by the
      // previous standard, so every number this commit raises is attributable to
      // the matcher's new vision and to nothing a contributor wrote.
      const offenders = regrade(
        old.bannersIn as typeof bannersIn,
        baseCounts(base.lists, "BANNER_COMMENT_DEBT") ?? {},
      );
      expect(
        offenders,
        [
          `MATCHER_REVISION went ${before} -> ${MATCHER_REVISION}, which re-seeds`,
          "every shrink-only number in the allowlist. That is only sound when the",
          "tree still PASSES the previous gate, so that everything newly counted",
          "is something the old matcher could not see.",
          "",
          `It does not. Run with the matcher as it stood at ${base.ref}, the`,
          "current tree fails its own debt list. Clean these first, then re-seed:",
        ].join("\n"),
      ).toEqual([]);

      console.info(
        `[banner-comments] re-seed ${before} -> ${MATCHER_REVISION}: the tree ` +
          `still passes the ${base.ref} gate, and the widened matcher now counts ` +
          `${total} banners in ${RESULT.counts.size} files.`,
      );
      return { declared: true, before };
    }

    /** Grade the current tree with a given matcher against a given debt list. */
    function regrade(
      match: typeof bannersIn,
      debt: Record<string, number>,
    ): string[] {
      const root = ratchetRepoRoot();
      const counts = new Map<string, number>();
      for (const file of handWrittenSources()) {
        let source: string;
        try {
          source = readFileSync(join(root, file), "utf8");
        } catch {
          continue;
        }
        const n = match(source.split("\n")).length;
        if (n > 0) counts.set(file, n);
      }
      const offenders: string[] = [];
      for (const [file, count] of counts) {
        const budget = debt[file];
        if (budget !== undefined) {
          if (count > budget) {
            offenders.push(`${file}: ${count}, debt list said ${budget}`);
          }
          continue;
        }
        offenders.push(`${file}: ${count}, unlisted`);
      }
      return offenders;
    }

    it("BANNER_COMMENT_DEBT", () => {
      const at = baseAllowlist();
      if (!at) return;
      if (reseed(at).declared) return;
      const before = baseCounts(at.lists, "BANNER_COMMENT_DEBT");
      if (!before) return;
      expect(
        additions(BANNER_COMMENT_DEBT, before),
        `Debt entries may only be REMOVED or lowered, never added or raised, vs ${at.ref}.`,
      ).toEqual([]);
    });
  });
});
