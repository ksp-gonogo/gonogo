// @vitest-environment node
/*
 * Node realm rather than the package's jsdom default, matching
 * `styleguide-banner-comments.test.ts`: the shrink-only half transpiles the
 * allowlist at a git ref through esbuild, which asserts a real
 * TextEncoder/Uint8Array realm.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { transformSync } from "esbuild";
import { describe, expect, it } from "vitest";
import {
  COMMENT_STACK_DEBT,
  MATCHER_REVISION,
  SCAN_FLOORS,
} from "./comment-stacks.allowlist";
import {
  MIN_STACK_LINES,
  scanCommentStacks,
  stacksIn,
} from "./comment-stacks.scan";
import {
  baseCounts,
  baseNumber,
  baseNumberFields,
  ratchetBaseRef,
  ratchetRepoRoot,
  sourceAtRatchetBase,
} from "./ratchetBaseRef";
import { scanScope } from "./scanScope";

/**
 * Comment-stack ratchet. CLAUDE.md says that a genuinely multi-line thought uses
 * proper multi-line formatting, never one long sentence mashed into a stack of
 * single-line fragments, and that a merely-long single comment stays one line.
 *
 * THE DEFINITION, in one sentence: a violation is two or more consecutive
 * line-comment lines whose joined text is a SINGLE sentence, in a hand-written
 * source file. A divider or an empty comment line ends a run.
 *
 * The single-sentence part is what makes this gate usable. A loose scan for
 * consecutive prose comment lines finds most of the tree; gating on that would
 * forbid the prevailing comment style rather than the defect. A stack of several
 * complete sentences is the "real paragraph" the rule explicitly permits.
 *
 * JS/TS only, unlike the banner ratchet beside it, which also scans C#. A `//`
 * paragraph is idiomatic .NET because C# keeps `///` for the doc form, so the
 * stack there is the normal way to write an aside rather than a mashed
 * substitute for a block comment. That exemption is not a gap: it is the reason
 * the tree's largest offenders by raw count are all C# and none of them appear
 * in the debt list.
 *
 * Lives in `packages/core` because core holds this repo's cross-package
 * ratchets, and because `pnpm test` in core is the `test` job CI actually runs.
 */

const ALLOWLIST_PATH = "packages/core/src/comment-stacks.allowlist.ts";
const SCAN_PATH = "packages/core/src/comment-stacks.scan.ts";

/** The scan module as read back from a git ref, for the re-seed proof. */
interface BaseScan {
  scanCommentStacks?: typeof scanCommentStacks;
}

const SCOPE = scanScope();
const RESULT = scanCommentStacks(SCOPE.covers);

describe("comment stacks", () => {
  /**
   * The instrument check, before any assertion that can pass by finding
   * nothing. Every other test here is `expect(offenders).toEqual([])`, and a
   * scan that walks zero files satisfies all of them: a wrong cwd, a renamed
   * root, or a `git ls-files` that errored into an empty string each look
   * exactly like a clean repo.
   */
  it("actually scanned the source tree", () => {
    const stacks = [...RESULT.counts.values()].reduce((a, b) => a + b, 0);
    const summary = [
      SCOPE.label,
      `listed ${RESULT.enumerated} files`,
      `scanned ${RESULT.scanned}`,
      `${RESULT.generated} skipped as generated`,
      `${RESULT.counts.size} files carry a stack`,
      `${stacks} stacks`,
    ].join(", ");
    /*
     * The census, not a boolean. A number in the log is what lets the next
     * person see the direction of travel beside the verdict, and it is only
     * visible under `--reporter=verbose`; the default reporter mutes console
     * output for tests that pass.
     */
    console.info(`[comment-stacks] ${summary}`);
    // The listing is whole-tree in both scopes, so this floor holds in both: a wrong cwd or an empty `git ls-files` fails here either way.
    expect(RESULT.enumerated, summary).toBeGreaterThanOrEqual(
      SCAN_FLOORS.files,
    );
    /*
     * What was WALKED, never what was found. The stack and file-with-stack
     * counts are the debt, and they fall as it is paid; a floor on them would
     * fail the gate for the one outcome it exists to produce. A matcher gone
     * blind is caught elsewhere: by the literal-string test below, and by every
     * exact debt entry reading low in "records no comment stack that is already
     * gone".
     */
    if (SCOPE.mode === "changed") return;
    expect(RESULT.scanned, summary).toBeGreaterThanOrEqual(SCAN_FLOORS.files);
  });

  /**
   * The instrument check for the matcher itself, which the file-count floor
   * cannot give: `scanned` stays healthy if the matcher is edited into something
   * that matches nothing, and the debt assertions then read as a repo that
   * cleaned itself overnight.
   *
   * The negative cases matter more than the positive one. Each is a shape that
   * legitimately stacks, and a gate that flagged any of them would be muted
   * within a day.
   */
  it("matches a mashed sentence and not a paragraph, directive or code", () => {
    const c = "//";
    const mashed = [
      `${c} Arrow-highlighted option first; fall back to the first filtered`,
      `${c} result so a partial path plus Enter works without an arrow key,`,
      `${c} matching the picker's own convention.`,
    ].join("\n");
    expect(stacksIn(mashed)).toHaveLength(1);

    const paragraph = [
      `${c} The outer gate is Courier-thread-only. Both classes are keyed by`,
      `${c} topic internally. That is why the pair is safe to share.`,
      `${c} Nothing else touches it.`,
    ].join("\n");
    expect(stacksIn(paragraph)).toHaveLength(0);

    // Two lines is the commonest spelling of the defect, not an exemption.
    const twoLines = [
      `${c} A single sentence hand-wrapped across two lines is the commonest`,
      `${c} spelling of this defect and is exactly what the gate is about.`,
    ].join("\n");
    expect(stacksIn(twoLines)).toHaveLength(1);

    // A divider ENDS a run, so the sentence beneath it is judged on its own.
    const underARule = [
      `${c} ${"-".repeat(20)}`,
      `${c} A sentence sitting directly beneath a divider, which is a sentence`,
      `${c} of its own rather than a continuation of the rule above it.`,
    ].join("\n");
    expect(stacksIn(underARule)).toHaveLength(1);

    const titledRule = [
      `${c} --- Registration ---`,
      `${c} Proves the widget spreads straight into registerComponent.`,
    ].join("\n");
    expect(stacksIn(titledRule)).toHaveLength(0);

    // An empty comment line is a paragraph break, which is what makes the text around it a paragraph rather than one sentence.
    const acrossAParagraphBreak = [
      `${c} One complete thought.`,
      `${c}`,
      `${c} Another complete thought.`,
    ].join("\n");
    expect(stacksIn(acrossAParagraphBreak)).toHaveLength(0);

    // A run of rule characters INSIDE prose is not a divider.
    const backtickedOperator = [
      `${c} \`== null\`, not \`=== undefined\`: an explicit null is the NORMAL`,
      `${c} answer here, since stock KSP has no calendar to anchor against.`,
    ].join("\n");
    expect(stacksIn(backtickedOperator)).toHaveLength(1);

    const commentedOutCode = [
      `${c} const next = compute(previous);`,
      `${c} if (next > limit) { report(next); }`,
      `${c} return next;`,
    ].join("\n");
    expect(stacksIn(commentedOutCode)).toHaveLength(0);

    const directives = [
      `${c} eslint-disable-next-line no-console`,
      `${c} @ts-expect-error the shim is deliberately untyped here`,
      `${c} biome-ignore lint/suspicious/noExplicitAny: wire shape`,
    ].join("\n");
    expect(stacksIn(directives)).toHaveLength(0);

    /*
     * Triple-slash is a directive form in TS and the doc form in C#; either way
     * it is already proper multi-line formatting and never counts, however long
     * the sentence it carries runs on for.
     */
    const tripleSlash = [
      `/// <reference types="vite/client" />`,
      `/// spread over as many lines as it likes, because the shape is already`,
      `/// the multi-line one this gate is asking for.`,
    ].join("\n");
    expect(stacksIn(tripleSlash)).toHaveLength(0);
  });

  /**
   * Growth. A file with a stack and no entry, or a file whose count has gone up,
   * both land here. The count is per file rather than per repo so the message
   * names the file, which is the whole difference between a gate somebody acts
   * on and a gate somebody mutes.
   */
  it("adds no comment stack to a file that is not already carrying one", () => {
    const offenders: string[] = [];
    for (const [file, count] of RESULT.counts) {
      const budget = COMMENT_STACK_DEBT[file];
      if (budget === undefined) {
        const first = RESULT.stacks.get(file)?.[0];
        offenders.push(
          `${file}:${first?.line}: ${count} stack(s), unlisted -> ${first?.text.slice(0, 90)}`,
        );
        continue;
      }
      if (count > budget) {
        offenders.push(`${file}: ${count} stack(s), debt list says ${budget}`);
      }
    }
    expect(
      offenders,
      [
        "A single sentence was split across two or more // comment lines.",
        "",
        "CLAUDE.md: a genuinely multi-line thought uses proper multi-line",
        "formatting (a /** */ block or a real paragraph), never one long",
        "sentence mashed into a stack of single-line // fragments. A merely-long",
        "single comment stays one line and relies on editor wrapping.",
        "",
        "So either turn it into a block comment, or let the one sentence be one",
        "line. Several complete sentences stacked as a paragraph are fine and",
        "are not what this reports.",
        "",
        "Do NOT add an entry to comment-stacks.allowlist.ts. The debt list is",
        "shrink-only and a new entry means new code just created the violation.",
      ].join("\n"),
    ).toEqual([]);
  });

  /**
   * The staleness direction, and the reason the debt counts are exact rather
   * than ceilings. Nothing else notices when a stack is cleaned, so the entry
   * sits there reading as work remaining, and the list can never reach zero by
   * attrition. With this, every cleanup anywhere is an automatic reduction and
   * the next person to touch the file is told to write the smaller number down.
   */
  it("records no comment stack that is already gone", () => {
    const stale: string[] = [];
    for (const [file, expected] of Object.entries(COMMENT_STACK_DEBT)) {
      // An unread file has no count, which is not the same as a count of zero.
      if (!SCOPE.covers(file)) continue;
      const actual = RESULT.counts.get(file) ?? 0;
      if (actual < expected) {
        stale.push(`${file} says ${expected}, actually ${actual}`);
      }
    }
    expect(
      stale,
      [
        "The debt list claims more comment stacks than the file still has.",
        "",
        "Good news: something cleaned them. Regenerate the list so it keeps",
        "telling the truth about what is left:",
        "",
        "  node scripts/comment-stack-debt.mjs --update",
        "",
        "A debt list that outlives its debt reads as work remaining and hides",
        "how close to zero this is.",
      ].join("\n"),
    ).toEqual([]);
  });

  /** Guards the constant the whole shape rests on against a quiet edit. */
  it("calls two lines a stack", () => {
    expect(MIN_STACK_LINES).toBe(2);
  });

  describe("the debt list only ever shrinks", () => {
    /**
     * The list as it stood at the ratchet base, with the ref it came from so a
     * failure can quote it.
     *
     * `ratchetBaseRef` THROWS when no base can be reached, deliberately:
     * catching that and returning `undefined` would make an unreachable base
     * read as "nothing to check", turning the whole shrink guard into a pass.
     * Undefined here means only that the checkout IS the base, or that the list
     * did not exist there.
     */
    function baseAllowlist():
      | {
          base: NonNullable<ReturnType<typeof ratchetBaseRef>>;
          ref: string;
          lists: Record<string, unknown>;
        }
      | undefined {
      const at = ratchetBaseRef();
      if (!at) return undefined;
      const source = sourceAtRatchetBase(at, ALLOWLIST_PATH);
      if (source === null) return undefined;
      return { base: at, ref: at.ref, lists: load(source) };
    }

    function load(source: string): Record<string, unknown> {
      const js = transformSync(source, { loader: "ts", format: "cjs" }).code;
      const module_ = { exports: {} as Record<string, unknown> };
      new Function("module", "exports", "require", js)(
        module_,
        module_.exports,
        require,
      );
      return module_.exports;
    }

    /**
     * Whether this commit declares a widened matcher, and the proof that it
     * really is one.
     *
     * A widening is the only change that legitimately raises these numbers, and
     * the numbers alone cannot tell "the gate learned to see a spelling" from
     * "somebody wrote more stacks". So the claim is checked rather than
     * believed, in the only way that settles it: run the OLD matcher over the
     * CURRENT tree. If the tree still passes the OLD gate outright, everything
     * newly counted is something the old matcher could not see, and none of it
     * is new code. Same mechanism as `styleguide-banner-comments.test.ts`.
     */
    function reseed(
      at: NonNullable<ReturnType<typeof baseAllowlist>>,
    ): boolean {
      const was = baseNumber(at.lists, "MATCHER_REVISION") ?? 1;
      if (was === MATCHER_REVISION) return false;

      expect(
        MATCHER_REVISION,
        `MATCHER_REVISION may only go up (${was} at ${at.ref}).`,
      ).toBeGreaterThan(was);

      const now = readFileSync(join(ratchetRepoRoot(), SCAN_PATH), "utf8");
      const then = sourceAtRatchetBase(at.base, SCAN_PATH);
      expect(
        then,
        `${SCAN_PATH} cannot be read at ${at.ref}, so the previous matcher ` +
          "cannot be re-run and the re-seed cannot be checked.",
      ).not.toBeNull();
      expect(
        then !== now,
        `MATCHER_REVISION went ${was} -> ${MATCHER_REVISION} but ${SCAN_PATH} is ` +
          "byte-identical to the base. The revision declares a widened matcher; " +
          "bumping it without one re-seeds every shrink-only number for nothing.",
      ).toBe(true);

      const old = load(then ?? "") as BaseScan;
      expect(
        typeof old.scanCommentStacks,
        `${SCAN_PATH} at ${at.ref} exports no scanCommentStacks, so the previous ` +
          "matcher cannot be re-run and the re-seed cannot be checked.",
      ).toBe("function");

      const before = baseCounts(at.lists, "COMMENT_STACK_DEBT") ?? {};
      const regraded = old.scanCommentStacks?.().counts ?? new Map();
      const offenders: string[] = [];
      for (const [file, count] of regraded) {
        const budget = before[file];
        if (budget === undefined) offenders.push(`${file}: ${count}, unlisted`);
        else if (count > budget) {
          offenders.push(`${file}: ${count}, debt list said ${budget}`);
        }
      }

      expect(
        offenders,
        [
          `MATCHER_REVISION went ${was} -> ${MATCHER_REVISION}, which re-seeds`,
          "every shrink-only number in the allowlist. That is only sound when the",
          "tree still PASSES the previous gate, so that everything newly counted",
          "is something the old matcher could not see.",
          "",
          `It does not. Run with the matcher as it stood at ${at.ref}, the current`,
          "tree fails its own debt list. Clean these first, then re-seed:",
        ].join("\n"),
      ).toEqual([]);

      const total = [...RESULT.counts.values()].reduce((a, b) => a + b, 0);
      console.info(
        `[comment-stacks] re-seed ${was} -> ${MATCHER_REVISION}: the tree still ` +
          `passes the ${at.ref} gate, and the widened matcher now counts ` +
          `${total} stacks in ${RESULT.counts.size} files.`,
      );
      return true;
    }

    /**
     * Growth is refused two different ways, because a moved file and a new
     * violation look identical to a per-file comparison.
     *
     * An EXISTING entry may only fall. That is the strict half and it never
     * bends: a file that gains a stack has gained a defect.
     *
     * A NEW entry is allowed only when the repo-wide total did not rise. That is
     * what a relocation looks like: the same stacks under a different path, one
     * key removed and one added, total unchanged. Without this the gate fails on
     * every file move and the only way past it is to lower a floor or delete the
     * check, which is how a ratchet gets muted.
     *
     * It is not a hole. New stacks cannot enter under it, because entering
     * raises the total; the most it permits is carrying existing debt from one
     * file to another, which leaves the population exactly as large as it was.
     */
    it("COMMENT_STACK_DEBT", () => {
      const at = baseAllowlist();
      if (!at) return;
      if (reseed(at)) return;
      const before = baseCounts(at.lists, "COMMENT_STACK_DEBT");
      if (!before) return;

      const sum = (list: Record<string, number>): number =>
        Object.values(list).reduce((a, b) => a + b, 0);
      const totalBefore = sum(before);
      const totalNow = sum(COMMENT_STACK_DEBT);

      const raised: string[] = [];
      const arrived: string[] = [];
      for (const [file, count] of Object.entries(COMMENT_STACK_DEBT)) {
        const was = before[file];
        if (was === undefined) arrived.push(`${file} (${count})`);
        else if (count > was) raised.push(`${file} (${was} -> ${count})`);
      }

      expect(
        raised,
        `A listed file gained comment stacks, vs ${at.ref}. An entry may only fall.`,
      ).toEqual([]);

      expect(
        totalNow > totalBefore ? arrived : [],
        [
          `New debt entries raised the repo-wide total, vs ${at.ref}:`,
          `  ${totalBefore} -> ${totalNow}`,
          "",
          "A new entry is only allowed when the total holds, which is what a file",
          "MOVE looks like. A rising total means a stack was written rather than",
          "carried, so fix the comment instead of listing it.",
        ].join("\n"),
      ).toEqual([]);
    });

    /**
     * The floor is data in the same file and would otherwise be lowerable with
     * a one-digit edit that reads as maintenance, which would blind the
     * instrument check above. Same rule as the debt list, in the other
     * direction: up only. It counts files WALKED, so no cleanup can lower the
     * measurement it guards.
     */
    it("SCAN_FLOORS", () => {
      const at = baseAllowlist();
      if (!at) return;
      const before = baseNumberFields(at.lists, "SCAN_FLOORS", ["files"]);
      if (!before) return;
      expect(
        SCAN_FLOORS.files,
        [
          `The scan floor may only be RAISED, vs ${at.ref}.`,
          "",
          "Lowering it blinds the instrument check: it is what stands between",
          "'the scan found nothing' and 'the scan looked at nothing'.",
        ].join("\n"),
      ).toBeGreaterThanOrEqual(before.files);
    });
  });
});
