import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * A dispatched command now settles honestly: a refusal the game issued reaches
 * the client as `phase: "refused"` carrying the mod's typed reason, distinct
 * from a transport failure and from an inferred loss. Every site below throws
 * that away.
 *
 * `void someCmd.send(...)` discards the promise AND the outcome. A census of
 * these found that not one of them reads the phase or the resolved value, so
 * the information exists and nothing shows it: the operator presses the button,
 * the game says no, and the widget says nothing at all.
 *
 * ## Why a budget rather than a runtime error
 *
 * Because zero of these sites surface an error today. Making a discarded
 * refusal throw would convert every one of them into a crash at once, in
 * widgets whose only fault is predating the phase, and the reliable outcome of
 * that is a `.catch(() => {})` added everywhere to make it stop. A budget turns
 * the same list into a queue that can only shrink, answered widget by widget,
 * with the UX question settled once per widget rather than once globally.
 *
 * The runtime invariant is the right instrument for a NEW command, where there
 * is no debt to grandfather. It is the wrong one for these. Separate decision.
 *
 * ## Working the list down
 *
 * Read the outcome and show it. `classifyCommandRejection` (published on the
 * sdk barrel) sorts a caught rejection into refused / lost / failed, so a
 * widget can say "the game said no, because X" without matching a code string:
 *
 *     void hireCmd.send(args)
 *     ->  hireCmd.send(args).catch((err) => {
 *           const r = classifyCommandRejection(err);
 *           setNotice(r.kind === "refused" ? reasonText(r.errorCode) : r.message);
 *         })
 *
 * Then LOWER the file's count in the same commit. A file that improves and
 * leaves its number alone leaves slack for the next regression to hide in,
 * which is why that is now a failure and not a nag.
 *
 * Counts are per FILE, never one total, so one widget's fix cannot pay for
 * another's regression. Per file rather than per line because line numbers
 * churn on every edit above them, and a ratchet that fails for unrelated
 * reasons gets disabled.
 */

/**
 * Per-file fire-and-forget dispatch budget, seeded 2026-08-20 at the census
 * count. Each entry EQUALS what its file dispatches blind: a file absent from
 * this map may not have any, a file over its number fails, and so does a file
 * under it, because slack in a queue entry is room for the next regression to
 * hide in. See "has no entry above what its file actually dispatches" below.
 *
 * A number may only RISE for one reason: a dispatch that was already blind
 * became visible to this scan. `useExecuteAction` swallowed its own rejection
 * internally, so its call sites were discarding an outcome the whole time
 * while matching nothing here. Retiring it moved two widgets' dispatches into
 * the census rather than adding any. Every other direction is down.
 */
const FIRE_AND_FORGET_BUDGET: Record<string, number> = {
  "mod/GonogoBreakingGroundUplink/client/src/RoboticsConsole/index.tsx": 3,
  "mod/GonogoBreakingGroundUplink/client/src/RotorTachometer/index.tsx": 6,
  "mod/GonogoMechJebUplink/client/src/MechJeb/index.tsx": 3,
  "packages/components/src/ActionGroup/index.tsx": 1,
  "packages/components/src/AstronautComplex/index.tsx": 1,
  // 7 -> 8 on 2026-08-21: `ksp.launch` moved off the deleted `useExecuteAction`,
  // whose own `result.then(()=>undefined, ()=>undefined)` swallowed the refusal
  // before any call site could see it. The blind dispatch is not new, only
  // countable: launch has six refusal arms and showed none of them either way.
  // 8 -> 1: seven of them answered, launch's six refusal arms included. The
  // number was never lowered as they were, so the widget that prompted the note
  // above had been carrying the queue's largest single allowance for weeks.
  "packages/components/src/LaunchDirector/index.tsx": 1,
  "packages/components/src/ManeuverPlanner/index.tsx": 1,
  "packages/components/src/MapView/vanillaPoiProvider.ts": 1,
  // 6 -> 7 on 2026-08-21: the three trim actions moved off the deleted
  // `useExecuteAction` onto one shared `vessel.control.setAxes` handle. Same
  // note as LaunchDirector above: the swallow moved into view, it did not appear.
  "packages/components/src/Navball/index.tsx": 7,
  "packages/components/src/ShipMap/index.tsx": 1,
  "packages/components/src/TargetPicker/index.tsx": 5,
  "packages/components/src/WarpControl/index.tsx": 2,
};

/**
 * A guard on the guard. If the search silently stops matching (a bad regex, a
 * moved root, a renamed extension) every count reads zero and this budget
 * reports a clean codebase while checking nothing.
 *
 * Held well under the live file count, so ordinary shrinking never trips it and
 * only a broken scan does. That is a moving target and the reason this is not
 * simply the current number: seeded at 12 against 19 files, it was still 12
 * when the list reached 12, one fix away from failing the build for doing
 * exactly what the budget asks. A floor that has caught up with the count has
 * turned from a guard into a tripwire, so it drops with the list rather than
 * being left to meet it.
 */
const MINIMUM_FILES_EXPECTED = 8;

const SEARCH_GLOBS = ["*.ts", "*.tsx"];

/**
 * `void <expr>.send(`: the fire-and-forget dispatch shape. Every match in the
 * seed is a `useCommand` handle (`cmd`, `hireCmd`, `engage`, ...), not a
 * transport or peer `send`, which is why the receiver is left unconstrained
 * rather than pattern-matched on a `Cmd` suffix: a command handle called
 * `land` or `executeNode` is the same defect and an earlier suffix-matching
 * pass missed four files for exactly that reason.
 *
 * POSIX ERE via `git grep -E`, which has no `\b`. Nothing in the character
 * class needs escaping, but if a `]` is ever added it must come FIRST inside
 * the brackets: `[...\]...]` ends the class at the backslash and the whole
 * pattern then silently matches nothing.
 */
const FIRE_AND_FORGET = String.raw`void [A-Za-z0-9_$.]+\.send\(`;

/**
 * Excluded from the budget:
 *  - `/dist/` build output, not source
 *  - tests and fixtures, which own the dispatches they make
 *  - `__generated__`, written by the contract generator
 */
const EXCLUDED = /\/dist\/|\.test\.|\.spec\.|test-d|__fixtures__|__generated__/;

/**
 * A line whose first non-space character opens a comment is prose, not a call
 * site. `use-command.ts`'s own explanation of why it marks these rejections
 * handled writes the shape in backticks, and charging a file for documenting
 * itself is how a budget teaches people to stop writing the comment.
 */
const COMMENT_LINE = /^(\/\/|\*|\/\*)/;

function repoRoot(startDir: string): string {
  return execFileSync("git", ["rev-parse", "--show-toplevel"], {
    cwd: startDir,
    encoding: "utf8",
  }).trim();
}

function countsByFile(root: string): Map<string, number> {
  let out: string;
  try {
    out = execFileSync(
      "git",
      // `--untracked` is load-bearing: `git grep` alone searches only TRACKED
      // files, so a brand-new widget's blind dispatches are invisible to this
      // budget until the moment they are committed, which is the one moment
      // nobody is looking. It still honours .gitignore, so build output and
      // node_modules stay out.
      ["grep", "-nE", "--untracked", FIRE_AND_FORGET, "--", ...SEARCH_GLOBS],
      { cwd: root, encoding: "utf8", maxBuffer: 1024 * 1024 * 16 },
    );
  } catch (err) {
    // git grep exits 1 when nothing matches. That is not a pass here: the whole
    // repo losing every dispatch at once is a broken search, and the file floor
    // below is what says so.
    if ((err as { status?: number }).status === 1) return new Map();
    throw err;
  }
  const counts = new Map<string, number>();
  for (const line of out.split("\n")) {
    if (!line || EXCLUDED.test(line)) continue;
    const firstColon = line.indexOf(":");
    const secondColon = line.indexOf(":", firstColon + 1);
    if (firstColon < 1 || secondColon < 0) continue;
    const file = line.slice(0, firstColon);
    if (COMMENT_LINE.test(line.slice(secondColon + 1).trim())) continue;
    counts.set(file, (counts.get(file) ?? 0) + 1);
  }
  return counts;
}

/**
 * Entries sitting above what their file actually dispatches, formatted for the
 * failure. A pure function of the two inputs so the planted check below can
 * drive it with a synthetic pair whose answer is known: this arm exists to make
 * a stale number visible, so it failing silently would restore precisely the
 * defect it was added to fix.
 */
function staleEntries(
  budget: Record<string, number>,
  counts: Map<string, number>,
): string[] {
  const stale: string[] = [];
  for (const [file, allowed] of Object.entries(budget).sort()) {
    const used = counts.get(file) ?? 0;
    if (used < allowed) {
      stale.push(
        `  ${file}: ${allowed} -> ${used}${used === 0 ? " (delete the entry)" : ""}`,
      );
    }
  }
  return stale;
}

const root = repoRoot(dirname(fileURLToPath(import.meta.url)));

describe("the fire-and-forget command budget only shrinks", () => {
  const counts = countsByFile(root);

  it("is actually looking at the codebase", () => {
    expect(counts.size).toBeGreaterThanOrEqual(MINIMUM_FILES_EXPECTED);
  });

  it("can see a violation (planted)", () => {
    /*
     * The file floor catches a walk that stops finding files. It cannot catch a
     * walk that finds them and a PATTERN that stops matching, and this one is
     * POSIX ERE with a documented footgun sitting in it: the header warns that
     * a `]` added anywhere but first in the bracket class ends the class early
     * and silently matches nothing from then on.
     *
     * Driven through `git grep` rather than a JS RegExp so the engine under
     * test is the one that runs, and from a temp dir outside any repository
     * because `--no-index` refuses a path outside the repo it finds from cwd.
     */
    const dir = mkdtempSync(join(tmpdir(), "faf-ratchet-"));
    try {
      writeFileSync(
        join(dir, "p.ts"),
        [
          "void cmd.send({});", // the plain handle
          "void hireCmd.send(args);", // a suffixed one
          "void this.engage.send();", // a dotted receiver
          "void land.send(x);", // a handle named nothing like a command
        ].join("\n"),
      );
      const hits = execFileSync(
        "git",
        ["grep", "--no-index", "-nE", FIRE_AND_FORGET, "--", "p.ts"],
        { cwd: dir, encoding: "utf8" },
      )
        .trim()
        .split("\n");
      // Four, including the two receiver shapes an earlier suffix-matching pass
      // missed: the header records it walking past four files for that reason.
      expect(hits).toHaveLength(4);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("can see a stale entry (planted)", () => {
    /*
     * The shrink arm's guard-on-the-guard. The planted check above proves the
     * `git grep` pattern still matches; it says nothing about the comparison
     * that turns a count into a stale-entry failure, and a comparison that
     * stopped comparing would report a tight list forever. Synthetic inputs,
     * because a tight list cannot demonstrate the arm firing.
     */
    const stale = staleEntries(
      { over: 6, exact: 3, answered: 2 },
      new Map([
        ["over", 4],
        ["exact", 3],
      ]),
    );
    expect(stale).toEqual([
      "  answered: 2 -> 0 (delete the entry)",
      "  over: 6 -> 4",
    ]);
    // A file at its number is not stale, and a file OVER it belongs to the
    // other arm: this one stays silent on both rather than double-reporting.
    expect(
      staleEntries(
        { exact: 1, under: 2 },
        new Map([
          ["exact", 1],
          ["under", 9],
        ]),
      ),
    ).toEqual([]);
  });

  it("has no entry for a path that no longer exists", () => {
    /*
     * An entry for a deleted file can never be spent, so it never trips the
     * over-budget arm below and no run ever mentions it. The magnitude budget
     * was found carrying one of these for a widget directory deleted outright;
     * this list is clean today and this is what keeps it so.
     */
    const missing = Object.keys(FIRE_AND_FORGET_BUDGET)
      .filter((rel) => !existsSync(join(root, rel)))
      .sort();
    expect(missing, "budgeted paths that no longer exist, delete them").toEqual(
      [],
    );
  });

  it("has no entry above what its file actually dispatches", () => {
    /*
     * The shrink arm. `LaunchDirector` is why it exists: it answered seven
     * blind dispatches, its entry stayed at 8, and nothing said so, so the
     * widget carried the queue's largest single allowance for weeks after
     * earning the smallest (see its note above). An entry above the live count
     * is not a record, it is room for that many new ones, and the over-budget
     * arm below cannot see them because they fit inside it.
     *
     * It throws rather than warning because a warning was tried on the sibling
     * styled-components ratchet and reached nobody: vitest 4's default reporter
     * suppresses console output for a PASSING test, and `pnpm test` and CI both
     * run the default reporter. A red build is the only signal here shown to
     * move a number, and it is the only one that can be TESTED, by planting a
     * shrink and asserting the failure.
     *
     * The sibling test above already hard-fails an entry whose file was
     * deleted; this is the same rule applied to a file that merely improved.
     *
     * Lowering stays manual, with no `--update`, so an entry whose number was
     * CHOSEN and explained in a comment cannot be quietly rewritten by a tool.
     */
    const stale = staleEntries(FIRE_AND_FORGET_BUDGET, counts);
    if (stale.length > 0) {
      throw new Error(
        "These entries sit above what their file dispatches blind. That gap is " +
          "room for exactly that many new blind dispatches, which the " +
          "over-budget check below cannot see. Lower each one (or delete it, " +
          "where the file now has none) in " +
          "packages/core/src/styleguide-fire-and-forget-commands.test.ts. If an " +
          "entry carries a comment, read it first: that number was chosen, and " +
          "the note may want rewriting rather than deleting:\n" +
          stale.join("\n"),
      );
    }
    expect(stale).toEqual([]);
  });

  it("has no file over its budget, and no unbudgeted file dispatching blind", () => {
    const over: string[] = [];
    for (const [file, used] of [...counts].sort()) {
      const budget = FIRE_AND_FORGET_BUDGET[file];
      if (budget === undefined) {
        over.push(`  ${file}: ${used} (not on the list)`);
      } else if (used > budget) {
        over.push(`  ${file}: ${used}, budget ${budget}`);
      }
    }
    if (over.length > 0) {
      throw new Error(
        "These files dispatch a command and discard its outcome more than the " +
          "budget allows, so a refusal the game issued shows the operator " +
          "nothing. Read the rejection and surface it (see " +
          "`classifyCommandRejection` on the sdk barrel), then lower the count " +
          "here in the same commit:\n" +
          over.join("\n"),
      );
    }
    expect(over).toEqual([]);
  });
});
