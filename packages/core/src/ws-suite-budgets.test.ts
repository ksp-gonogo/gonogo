// @vitest-environment node
// Node realm: this reads C# sources off disk.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * The WebSocket integration suite takes its wall-clock deadlines from
 * `TestBudgets`, never from a literal of its own.
 *
 * Every test there drives a real Fleck server and a real `ClientWebSocket` and
 * asserts delivery under a deadline. On a saturated box the process is
 * descheduled for seconds at a time, so the operation is correct and would
 * finish given CPU while the deadline expires anyway, and a DIFFERENT test
 * trips each run. `TestBudgets` is the answer that was written for it: budgets
 * sized as load headroom rather than timing assertions, every one overridable
 * by environment variable so a slow runner can be given more without a
 * rebuild.
 *
 * ## Why this is a gate and not a comment
 *
 * It was already written, and it reached nothing. `TestBudgets.Op`, `.Quiet`,
 * `.ReaderPoll` and `.FinalDrain` were referenced by no test in the suite for
 * three weeks while all 37 classes kept their own `TimeSpan.FromSeconds(10)`,
 * two of them at 5s. Only the `[ModuleInitializer]` thread-pool warm-up in that
 * file ran, because a module initializer needs no reference. So half the fix
 * was live, the half that had to be adopted was not, and nothing could say so:
 * an unused constant compiles, and the suite went on flaking with CI absorbing
 * it behind four retries.
 *
 * That is the failure this asks about, so it asks in two directions. A literal
 * budget is forbidden, AND the budgets must be REACHED: a suite that deleted
 * its deadlines entirely would satisfy the first on its own.
 */

const SUITE = "mod/Sitrep.Host.IntegrationTests";

/**
 * Which budget each known field means, used only to make the failure message
 * say what to write. It is NOT what the guard detects on: detection is every
 * `TimeSpan` field bound to a literal, so a field nobody thought of is caught
 * by the same rule as the six that exist.
 *
 * Written this way because the first draft of this guard did detect on a name
 * list, and the list was already short by two before it ever ran:
 * `TickTimeout` in the three fixture generators and `SettleWindow` in
 * `CommandRefusalTests` were sized by hand and matched nothing the list named.
 * A hand-maintained set with no gate on its own completeness is the failure
 * this file is about; it should not be the way the file works.
 */
const SUGGESTED: Record<string, string> = {
  Timeout: "TestBudgets.Op",
  TickTimeout: "TestBudgets.Op",
  Quiet: "TestBudgets.Quiet",
  SettleWindow: "TestBudgets.Quiet",
  ReaderPollTimeout: "TestBudgets.ReaderPoll",
  FinalDrainDelay: "TestBudgets.FinalDrain",
};

/** Every budget `TestBudgets` offers, read from the declaration itself. */
const BUDGET_MEMBERS = /public static readonly TimeSpan (\w+)\s*=/g;

/** A `TimeSpan` field sized by a literal instead of bound to a budget. */
const LITERAL_BUDGET = /readonly TimeSpan (\w+)\s*=\s*TimeSpan\.From/g;

/** The file that declares the budgets, which is allowed to compute them. */
const DECLARATION = `${SUITE}/TestBudgets.cs`;

function findRepoRoot(start: string): string {
  let dir = start;
  while (dir !== "/") {
    if (existsSync(join(dir, "pnpm-workspace.yaml"))) return dir;
    dir = dirname(dir);
  }
  throw new Error(`Could not locate workspace root from ${start}`);
}

const ROOT = findRepoRoot(dirname(fileURLToPath(import.meta.url)));

/**
 * The `TimeSpan` fields one source sizes with a literal.
 *
 * Matched on the declaration rather than the value, so raising a hardcoded
 * number does not slip past by looking different from the one written down.
 */
function literalBudgets(text: string): string[] {
  return [...text.matchAll(LITERAL_BUDGET)].map((m) => m[1]);
}

/** The suite's tracked C# sources, as git lists them. */
function suiteSources(): { path: string; text: string }[] {
  return execFileSync("git", ["ls-files", "-z", "--", SUITE], {
    cwd: ROOT,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  })
    .split("\0")
    .filter((rel) => rel.endsWith(".cs"))
    .map((rel) => ({ path: rel, text: readFileSync(join(ROOT, rel), "utf8") }));
}

const sources = suiteSources();

describe("the WS integration suite takes its deadlines from TestBudgets", () => {
  it("reads the suite at all, so an empty walk cannot pass for clean", () => {
    // Every assertion below is `toEqual([])`, and a walk that matched nothing
    // satisfies all of them.
    expect(sources.length).toBeGreaterThan(30);
    expect(sources.map((s) => s.path)).toContain(DECLARATION);
  });

  it("suggests only budgets TestBudgets actually offers", () => {
    /*
     * The suggestions are written here and the budgets there, so a renamed one
     * would otherwise send the next person to write a field that does not
     * compile.
     */
    const declaration = sources.find((s) => s.path === DECLARATION)?.text ?? "";
    const offered = new Set(
      [...declaration.matchAll(BUDGET_MEMBERS)].map((m) => m[1]),
    );
    expect(
      offered.size,
      `No budget parsed out of ${DECLARATION}, so this guard cannot check its own advice.`,
    ).toBeGreaterThan(3);
    const unknown = [...new Set(Object.values(SUGGESTED))].filter(
      (bound) => !offered.has(bound.slice("TestBudgets.".length)),
    );
    expect(unknown, `TestBudgets no longer offers these`).toEqual([]);
  });

  it("sizes no deadline with a literal of its own", () => {
    const offenders: string[] = [];
    for (const source of sources) {
      if (source.path === DECLARATION) continue;
      for (const field of literalBudgets(source.text)) {
        const bound = SUGGESTED[field] ?? "a TestBudgets budget";
        offenders.push(`${source.path}: ${field} should be ${bound}`);
      }
    }
    expect(
      offenders,
      [
        "A test class in the WS suite sized its own wall-clock deadline.",
        "",
        "These deadlines are load headroom, not timing assertions: a correct",
        "operation finishes in milliseconds and never pays them. A local",
        "literal is both tighter than the budget and not overridable by",
        "environment variable, so the runner that needs more headroom cannot",
        "be given it. Bind the field to a budget instead, and add one to",
        "TestBudgets if none of them is what you mean:",
        "",
        ...offenders.map((o) => `  ${o}`),
      ].join("\n"),
    ).toEqual([]);
  });

  it("actually reaches TestBudgets from the suite's own tests", () => {
    // The direction that was missed. Forbidding literals says nothing about
    // whether anything reads the budgets, and for three weeks nothing did.
    const readers = sources.filter(
      (s) => s.path !== DECLARATION && s.text.includes("TestBudgets."),
    );
    expect(
      readers.length,
      `No test in ${SUITE} references TestBudgets, so the budgets it declares ` +
        `reach nothing and only its module initializer runs.`,
    ).toBeGreaterThan(20);
  });

  it("can see each violation it forbids", () => {
    /*
     * A pattern that stopped matching reports a clean suite, and the suite is
     * held at zero, so there is no live subject to prove it against. Each
     * spelling is planted instead, and the bound form is shown to survive so a
     * tightened pattern fails here rather than flagging the fix.
     */
    for (const [field, bound] of Object.entries(SUGGESTED)) {
      expect(
        literalBudgets(
          `private static readonly TimeSpan ${field} = TimeSpan.FromSeconds(10);`,
        ),
        `the guard no longer catches a literal ${field}`,
      ).toEqual([field]);
      expect(
        literalBudgets(`private static readonly TimeSpan ${field} = ${bound};`),
        `the guard now rejects ${bound}, which is the form it asks for`,
      ).toEqual([]);
    }

    // A field nobody named, which is the case the first draft's name list
    // could not have caught.
    expect(
      literalBudgets(
        "private static readonly TimeSpan SomeNewWindow = TimeSpan.FromMilliseconds(250);",
      ),
    ).toEqual(["SomeNewWindow"]);
  });
});
