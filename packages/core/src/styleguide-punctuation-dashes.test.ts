// @vitest-environment node
/*
 * Node realm rather than the package's jsdom default, matching the comment-stack
 * and banner ratchets: the shrink-only half transpiles the allowlist at a git
 * ref through esbuild, which asserts a real TextEncoder/Uint8Array realm.
 */
import { transformSync } from "esbuild";
import { describe, expect, it } from "vitest";
import { PUNCTUATION_DASH_DEBT } from "./punctuation-dashes.allowlist";
import {
  codepointName,
  dashesIn,
  FORBIDDEN_DASHES,
  SANCTIONED_COUNT,
  SANCTIONED_FILE,
  scanPunctuationDashes,
} from "./punctuation-dashes.scan";
import {
  baseCounts,
  ratchetBaseRef,
  sourceAtRatchetBase,
} from "./ratchetBaseRef";

/**
 * Punctuation-dash ratchet, the family the em-dash gate beside it does not
 * cover.
 *
 * `styleguide-emdash.test.ts` holds U+2014 to zero outside one sanctioned
 * definition site. It gates one character; the en dash and its relatives are
 * the same defect in a different codepoint, and this gate holds them to a
 * shrink-only debt list.
 *
 * Which characters, and the two that are deliberately out, are in
 * `punctuation-dashes.scan.ts`. The short version: Unicode's own
 * `Dash_Punctuation` category, so box-drawing rules and the mathematical minus
 * are excluded by construction rather than by a list somebody has to remember.
 *
 * The em dash stays with its own gate rather than moving here, because that gate
 * is STRICTER: zero, with no debt list at all. A character held to zero in one
 * place and to a budget in another is a character with two rules.
 *
 * This file never spells a forbidden character literally, using
 * `String.fromCodePoint` throughout, so it can never appear in its own results.
 */

const ALLOWLIST_PATH = "packages/core/src/punctuation-dashes.allowlist.ts";

const RESULT = scanPunctuationDashes();

const EN_DASH = String.fromCodePoint(0x2013);

describe("design-system: punctuation dashes", () => {
  /**
   * The instrument check, before any assertion that can pass by finding
   * nothing, and the sanctioned site asserted in BOTH directions.
   *
   * The scan only ever reads files `git grep` reported, so a pattern that
   * stopped matching, a wrong cwd, or a listing that errored into an empty
   * string would each look exactly like a clean repo. `Band.tsx` is the one
   * file guaranteed to carry a forbidden dash, so finding it there, through the
   * same grep and the same matcher as everything else, is what proves the scan
   * looked. A count of files found cannot do that job: it falls every time
   * debt is paid, and a floor on it fails the gate for the outcome it exists to
   * produce.
   *
   * Absent, and the carve-out has also outlived its reason and is quietly
   * excusing whatever lands in that file next. Over count, and a second dash
   * has been written beside the definition under cover of the exemption.
   */
  it("finds the interval separator exactly once, where it is defined", () => {
    const total = [...RESULT.counts.values()].reduce((a, b) => a + b, 0);
    // The census, printed under `--reporter=verbose` so the direction of travel is visible beside the verdict.
    console.info(
      `[punctuation-dashes] ${RESULT.counts.size} files carry a forbidden dash, ${total} occurrences`,
    );
    expect(
      RESULT.counts.get(SANCTIONED_FILE) ?? 0,
      `${SANCTIONED_FILE} should hold the sole sanctioned dash, the ` +
        "INTERVAL_DASH definition itself. Zero means either the scan saw " +
        "nothing at all or the token moved and this carve-out now excuses " +
        "nothing; more than one means a second occurrence was written beside " +
        "it. A caller asserting on the separator imports INTERVAL_DASH rather " +
        "than writing the character.",
    ).toBe(SANCTIONED_COUNT);
  });

  /**
   * The instrument check for the character set: the derivation runs at load
   * time against the regex engine, and a `Dash_Punctuation` lookup that
   * returned nothing would leave the scan matching no character.
   *
   * The exclusions are asserted as well as the inclusions. Each is a character
   * the tree writes thousands of times for a legitimate reason, and a gate that
   * flagged one would be muted within the hour.
   */
  it("forbids the dash family and not the rule or the minus sign", () => {
    expect(FORBIDDEN_DASHES.length).toBeGreaterThan(10);
    for (const cp of [0x2010, 0x2011, 0x2012, 0x2013, 0x2015]) {
      const ch = String.fromCodePoint(cp);
      expect(FORBIDDEN_DASHES, codepointName(ch)).toContain(ch);
    }
    // Invisible, and `Cf` rather than `Pd`, so no derivation reaches it.
    expect(FORBIDDEN_DASHES).toContain(String.fromCodePoint(0x00ad));

    // The ASCII hyphen is the correct character.
    expect(FORBIDDEN_DASHES).not.toContain(String.fromCodePoint(0x002d));
    // The em dash belongs to the stricter gate beside this one.
    expect(FORBIDDEN_DASHES).not.toContain(String.fromCodePoint(0x2014));
    // A mathematical operator: `a(1-e)`, a signed range, a decrement button.
    expect(FORBIDDEN_DASHES).not.toContain(String.fromCodePoint(0x2212));
    // Rules, not punctuation, and `banner-comments.matcher.ts` is built of them.
    for (const cp of [0x2500, 0x2501, 0x2550, 0x254c]) {
      expect(FORBIDDEN_DASHES).not.toContain(String.fromCodePoint(cp));
    }
  });

  /**
   * The matcher against literal strings, so the gate can be seen to FAIL
   * without touching the filesystem. A ratchet whose only evidence is a green
   * run has never been shown to refuse anything.
   */
  it("finds a planted dash and reports where it is", () => {
    const planted = `const label = "AG1${EN_DASH}AG10";`;
    const hits = dashesIn(planted);
    expect(hits).toHaveLength(1);
    expect(hits[0].codepoint).toBe("U+2013");
    expect(hits[0].line).toBe(1);

    expect(dashesIn('const label = "AG1-AG10";')).toEqual([]);
    // The minus sign and a box-drawing rule both pass through untouched.
    expect(dashesIn(`x = a ${String.fromCodePoint(0x2212)} b;`)).toEqual([]);
    expect(dashesIn(`// ${String.fromCodePoint(0x2500).repeat(20)}`)).toEqual(
      [],
    );
  });

  /**
   * Growth. A file with a dash and no entry, or a file whose count has gone up,
   * both land here. Per file rather than per repo so the message names the
   * file, which is the difference between a gate somebody acts on and a gate
   * somebody mutes.
   */
  it("adds no dash to a file that is not already carrying one", () => {
    const offenders: string[] = [];
    for (const [file, count] of RESULT.counts) {
      if (file === SANCTIONED_FILE) continue;
      const budget = PUNCTUATION_DASH_DEBT[file];
      if (budget === undefined) {
        const first = RESULT.hits.get(file)?.[0];
        offenders.push(
          `${file}:${first?.line}: ${count} ${first?.codepoint}, unlisted -> ${first?.text.slice(0, 80)}`,
        );
        continue;
      }
      if (count > budget) {
        offenders.push(`${file}: ${count} dash(es), debt list says ${budget}`);
      }
    }
    expect(
      offenders,
      [
        "A non-ASCII punctuation dash was written into a file.",
        "",
        "CLAUDE.md: no em-dashes; use commas, colons, parentheses, or separate",
        "sentences instead. The en dash and its relatives are the same character",
        "in a different codepoint, and the rule does not turn on which one.",
        "",
        "For a numeric range, an ASCII hyphen reads identically and survives",
        "every encoding. For prose, rewrite the sentence.",
        "",
        "Do NOT add an entry to punctuation-dashes.allowlist.ts. The debt list is",
        "shrink-only and a new entry means new code just created the violation.",
      ].join("\n"),
    ).toEqual([]);
  });

  /**
   * The staleness direction, and the reason the debt counts are exact rather
   * than ceilings. Nothing else notices when a dash is cleaned, so the entry
   * sits there reading as work remaining and the list never reaches zero by
   * attrition. It is also the second half of the instrument check: a scan gone
   * blind reads every listed file as clean, and every entry fails here.
   */
  it("records no dash that is already gone", () => {
    const stale: string[] = [];
    for (const [file, expected] of Object.entries(PUNCTUATION_DASH_DEBT)) {
      const actual = RESULT.counts.get(file) ?? 0;
      if (actual < expected) {
        stale.push(`${file} says ${expected}, actually ${actual}`);
      }
    }
    expect(
      stale,
      [
        "The debt list claims more dashes than the file still has.",
        "",
        "Good news: something cleaned them. Regenerate the list so it keeps",
        "telling the truth about what is left:",
        "",
        "  node scripts/punctuation-dash-debt.mjs --update",
      ].join("\n"),
    ).toEqual([]);
  });

  describe("the debt list only ever shrinks", () => {
    /**
     * The list as it stood at the ratchet base.
     *
     * `ratchetBaseRef` THROWS when no base can be reached, deliberately:
     * catching that and returning `undefined` would make an unreachable base
     * read as "nothing to check", turning the whole shrink guard into a pass.
     * Undefined here means only that the checkout IS the base, or that the list
     * did not exist there, which is true of the commit that seeds it.
     */
    function baseAllowlist():
      | { ref: string; lists: Record<string, unknown> }
      | undefined {
      const at = ratchetBaseRef();
      if (!at) return undefined;
      const source = sourceAtRatchetBase(at, ALLOWLIST_PATH);
      if (source === null) return undefined;
      const js = transformSync(source, { loader: "ts", format: "cjs" }).code;
      const module_ = { exports: {} as Record<string, unknown> };
      new Function("module", "exports", js)(module_, module_.exports);
      return { ref: at.ref, lists: module_.exports };
    }

    /**
     * An EXISTING entry may only fall, and that half never bends. A NEW entry
     * is allowed only when the repo-wide total did not rise, which is what a
     * file MOVE looks like: the same dashes under a different path, one key
     * removed and one added, total unchanged. Without that the gate fails on
     * every rename and the only way past it is to delete the check.
     */
    it("PUNCTUATION_DASH_DEBT", () => {
      const at = baseAllowlist();
      if (!at) return;
      const before = baseCounts(at.lists, "PUNCTUATION_DASH_DEBT");
      if (!before) return;

      const sum = (list: Record<string, number>): number =>
        Object.values(list).reduce((a, b) => a + b, 0);
      const totalBefore = sum(before);
      const totalNow = sum(PUNCTUATION_DASH_DEBT);

      const raised: string[] = [];
      const arrived: string[] = [];
      for (const [file, count] of Object.entries(PUNCTUATION_DASH_DEBT)) {
        const was = before[file];
        if (was === undefined) arrived.push(`${file} (${count})`);
        else if (count > was) raised.push(`${file} (${was} -> ${count})`);
      }

      expect(
        raised,
        `A listed file gained dashes, vs ${at.ref}. An entry may only fall.`,
      ).toEqual([]);

      expect(
        totalNow > totalBefore ? arrived : [],
        [
          `New debt entries raised the repo-wide total, vs ${at.ref}:`,
          `  ${totalBefore} -> ${totalNow}`,
          "",
          "A new entry is only allowed when the total holds, which is what a file",
          "MOVE looks like. A rising total means a dash was written rather than",
          "carried, so fix the character instead of listing it.",
        ].join("\n"),
      ).toEqual([]);
    });
  });
});
