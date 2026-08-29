// @vitest-environment node
//
// Node realm rather than the package's jsdom default, matching
// `styleguide-banner-comments.test.ts`: the shrink-only half transpiles the
// allowlist at a git ref through esbuild, which asserts a real
// TextEncoder/Uint8Array realm.
import { transformSync } from "esbuild";
import { describe, expect, it } from "vitest";
import { COMMENT_STACK_DEBT, SCAN_FLOORS } from "./comment-stacks.allowlist";
import {
  MIN_STACK_LINES,
  scanCommentStacks,
  stacksIn,
} from "./comment-stacks.scan";
import { ratchetBaseRef, sourceAtRatchetBase } from "./ratchetBaseRef";

/**
 * Comment-stack ratchet. CLAUDE.md has always said that a genuinely multi-line
 * thought uses proper multi-line formatting, never one long sentence mashed into
 * a stack of single-line fragments, and nothing enforced it, so the population
 * grew to 1610 stacks across 732 JS/TS files.
 *
 * THE DEFINITION, in one sentence: a violation is three or more consecutive
 * line-comment lines whose joined text is a SINGLE sentence, in a hand-written
 * source file.
 *
 * The single-sentence part is what makes this gate usable. A loose scan for
 * three consecutive prose comment lines finds 5197 blocks across 1301 files,
 * which is most of the tree; gating on that would forbid the prevailing comment
 * style rather than the defect. A stack of several complete sentences is the
 * "real paragraph" the rule explicitly permits. Getting 5197 from a looser regex
 * is not evidence that this gate is broken; the two measure different things.
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

const RESULT = scanCommentStacks();

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
      `scanned ${RESULT.scanned} files`,
      `${RESULT.generated} skipped as generated`,
      `${RESULT.counts.size} files carry a stack`,
      `${stacks} stacks`,
    ].join(", ");
    // The census, not a boolean. A number in the log is what lets the next
    // person tell "found nothing" from "looked at nothing", and it is only
    // visible under `--reporter=verbose`; the default reporter mutes console
    // output for tests that pass.
    console.info(`[comment-stacks] ${summary}`);
    expect(RESULT.scanned, summary).toBeGreaterThanOrEqual(SCAN_FLOORS.files);
    expect(RESULT.counts.size, summary).toBeGreaterThanOrEqual(
      SCAN_FLOORS.filesWithStack,
    );
    expect(stacks, summary).toBeGreaterThanOrEqual(SCAN_FLOORS.stacks);
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

    const twoLines = [
      `${c} A single sentence that merely wraps across two lines is ordinary`,
      `${c} and is not what this gate is about.`,
    ].join("\n");
    expect(stacksIn(twoLines)).toHaveLength(0);

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

    // Triple-slash is a directive form in TS and the doc form in C#; either
    // way it is already proper multi-line formatting and never counts, however
    // long the sentence it carries runs on for.
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
        "A single sentence was split across three or more // comment lines.",
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
  it("still requires three lines to call something a stack", () => {
    expect(MIN_STACK_LINES).toBe(3);
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

    it("COMMENT_STACK_DEBT", () => {
      const at = baseAllowlist();
      if (!at) return;
      const before = at.lists.COMMENT_STACK_DEBT as
        | Record<string, number>
        | undefined;
      if (!before) return;
      const added: string[] = [];
      for (const [file, count] of Object.entries(COMMENT_STACK_DEBT)) {
        const was = before[file];
        if (was === undefined) added.push(`${file} (new entry: ${count})`);
        else if (count > was) added.push(`${file} (${was} -> ${count})`);
      }
      expect(
        added,
        `Debt entries may only be REMOVED or lowered, never added or raised, vs ${at.ref}.`,
      ).toEqual([]);
    });

    /**
     * The floors are data in the same file and would otherwise be lowerable with
     * a one-digit edit that reads as maintenance, which would blind the
     * instrument check above. Same rule as the debt list, in the other
     * direction: up only.
     */
    it("SCAN_FLOORS", () => {
      const at = baseAllowlist();
      if (!at) return;
      const before = at.lists.SCAN_FLOORS as
        | { files: number; filesWithStack: number; stacks: number }
        | undefined;
      if (!before) return;
      const lowered: string[] = [];
      for (const key of ["files", "filesWithStack", "stacks"] as const) {
        if (SCAN_FLOORS[key] < before[key]) {
          lowered.push(`${key} (${before[key]} -> ${SCAN_FLOORS[key]})`);
        }
      }
      expect(
        lowered,
        [
          `The scan floors may only be RAISED, vs ${at.ref}.`,
          "",
          "Lowering a floor blinds the instrument check: it is what stands",
          "between 'the scan found nothing' and 'the scan looked at nothing'.",
          "",
          "The floors sit at half the seeded census precisely so that real",
          "cleanup never reaches them. If cleanup genuinely has, that is the",
          "moment to retire this gate, not to lower its floor.",
        ].join("\n"),
      ).toEqual([]);
    });
  });
});
