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
 *
 * A literal is forbidden in both of the places a deadline is written: bound to
 * a field, and passed inline as an argument. A rule that reads only field
 * declarations cannot see a deadline written straight into the call it bounds,
 * which is where most of them are written.
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
  // CommandRefusalTests' window: every refusal exit sets Done before the call
  // returns, so it bounds a dispatch completing, not a stretch of silence.
  SettleWindow: "TestBudgets.Op",
  ReaderPollTimeout: "TestBudgets.ReaderPoll",
  FinalDrainDelay: "TestBudgets.FinalDrain",
};

/** Every budget `TestBudgets` offers, read from the declaration itself. */
const BUDGET_MEMBERS = /public static readonly TimeSpan (\w+)\s*=/g;

/** A `TimeSpan` field sized by a literal instead of bound to a budget. */
const LITERAL_BUDGET = /readonly TimeSpan (\w+)\s*=\s*TimeSpan\.From/g;

/** A `TimeSpan` built from a numeric literal, wherever it is written. */
const INLINE_LITERAL =
  /TimeSpan\.From(?:Milliseconds|Seconds|Minutes|Hours|Ticks)\(\s*[\d_.]+\s*\)/;

/**
 * Call shapes whose literal is an ABSENCE window rather than a deadline.
 *
 * Each asserts that nothing happens within the window. Starvation can only make
 * such a window see less, which weakens the assertion toward a pass and never
 * fails it, so the literal is not load-sensitive the way a deadline is. Matched
 * on the whole call as written on one line, so the same literal passed to any
 * other call, or split across lines, is still reported.
 */
const ABSENCE_WINDOWS: RegExp[] = [
  // No text frame arrives on the socket within the window
  /\.AssertNoMessageArrivesAsync\(TimeSpan\.From\w+\([\d_.]+\)\)/,
  // No binary-lane frame arrives within the window
  /\.AssertNoBinaryFrameArrivesAsync\(TimeSpan\.From\w+\([\d_.]+\)\)/,
  // An event is shown still unset once the window has passed
  /Assert\.False\(\w+\.Wait\(TimeSpan\.From\w+\([\d_.]+\)\)/,
];

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

/**
 * The lines of one source that pass a literal `TimeSpan` inline, as 1-based
 * line numbers with their text.
 *
 * A field declaration is left to {@link literalBudgets}, which names the field,
 * and an {@link ABSENCE_WINDOWS} call is not a deadline.
 */
function inlineLiterals(text: string): { line: number; text: string }[] {
  return text
    .split("\n")
    .map((line, i) => ({ line: i + 1, text: line.trim() }))
    .filter(
      ({ text: line }) =>
        INLINE_LITERAL.test(line) &&
        !new RegExp(LITERAL_BUDGET.source).test(line) &&
        !ABSENCE_WINDOWS.some((shape) => shape.test(line)),
    );
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

  it("passes no deadline a literal inline", () => {
    const offenders: string[] = [];
    for (const source of sources) {
      if (source.path === DECLARATION) continue;
      for (const { line, text } of inlineLiterals(source.text)) {
        offenders.push(`${source.path}:${line}: ${text}`);
      }
    }
    expect(
      offenders,
      [
        "A test in the WS suite passed a literal TimeSpan inline.",
        "",
        "A deadline written into the call is the same load-sensitive literal as",
        "one bound to a field, only harder to see. Pass the budget it means",
        "(TestBudgets.Op for anything waited on to complete). If the value is",
        "an absence window, which asserts that nothing happens, use one of the",
        "call shapes in ABSENCE_WINDOWS or add the new shape there with a",
        "comment saying why its literal cannot fail under load:",
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

    /*
     * Every inline spelling a deadline is written in. The bare
     * `TimeSpan.FromMilliseconds(300));` line is the tail of a multi-line call,
     * and stands equally for an absence helper whose argument was split onto
     * its own line, which is not the one-line shape the allowlist names.
     */
    const inlineDeadlines = [
      "engine.TickAndWait(0.0, Uplink.Snapshot(), TimeSpan.FromMilliseconds(500));",
      "TimeSpan.FromMilliseconds(300));",
      "TimeSpan.FromMilliseconds(300),",
      "var ack = await SubscribeAsync(client, topic, TimeSpan.FromSeconds(2));",
      "var deadline = DateTime.UtcNow + TimeSpan.FromSeconds(3);",
      "Assert.True(stopped.Wait(TimeSpan.FromSeconds(15)),",
    ];
    for (const line of inlineDeadlines) {
      expect(
        inlineLiterals(line).map((hit) => hit.text),
        `the guard no longer catches ${line}`,
      ).toEqual([line]);
    }

    // The forms it asks for, and the absence windows it names, survive
    const permitted = [
      "engine.TickAndWait(0.0, Uplink.Snapshot(), TestBudgets.Op);",
      "await client.AssertNoMessageArrivesAsync(TimeSpan.FromMilliseconds(300));",
      "await client.AssertNoBinaryFrameArrivesAsync(TimeSpan.FromMilliseconds(300));",
      "Assert.False(resolved.Wait(TimeSpan.FromMilliseconds(300)),",
      // A field is reported once, by the field rule, which can name it
      "private static readonly TimeSpan Quiet = TimeSpan.FromMilliseconds(300);",
    ];
    for (const line of permitted) {
      expect(inlineLiterals(line), `the guard now rejects ${line}`).toEqual([]);
    }
  });
});
