import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * A CI step that must not be skipped, checked against the event shapes it has
 * to fire on.
 *
 * ## Why a condition needs a test at all
 *
 * A step whose `if:` cannot match reports as **skipped**, and a step that was
 * correctly skipped reports as skipped too. The two are the same line in the
 * run summary, so a condition that can never be true is invisible for as long
 * as nobody sits down and works out what `github.ref` holds on each trigger.
 *
 * That is what happened to the KSP-reference-assemblies check. It read
 * `github.ref == 'refs/heads/main' || github.ref == 'refs/heads/staging'`,
 * which is correct on a `push` and impossible on a `pull_request`: there
 * `github.ref` is `refs/pull/<n>/merge`. `ci.yml` triggers on
 * `pull_request: branches: [main]`, so the step never ran on the merge gate,
 * which is the one path where a silently-dropped test suite decides whether
 * code lands. The step it guards exists precisely because a missing checkout
 * removes the KSP-linked sources at BUILD time and the job then passes having
 * run none of them.
 *
 * ## Why an evaluator rather than a text assertion
 *
 * Asserting that the `if:` line CONTAINS `github.event_name` would pass on a
 * condition that mentions it and still cannot match. The question is what the
 * expression ANSWERS for a given event, so this evaluates it: a small reader
 * for the subset of GitHub's expression syntax the condition uses (`==`, `&&`,
 * `||`, parentheses, single-quoted strings, and context lookups), run against
 * four event shapes built to match what GitHub actually sends.
 *
 * If a future condition needs syntax this does not implement, the evaluator
 * THROWS on the unknown token rather than guessing, so the test fails loudly
 * instead of quietly answering `false` for everything.
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
const CI_YML = join(ROOT, ".github/workflows/ci.yml");

/**
 * The step this file is about, matched on the `- name:` line. Named rather
 * than indexed so the test survives steps moving around it, and so a RENAME
 * fails here (where the reason is legible) rather than silently checking
 * nothing.
 */
const STEP_NAME_FRAGMENT = "KSP reference assemblies are mandatory";

/**
 * The `if:` expression of the step whose name contains `fragment`, with a
 * block scalar (`>-`) folded back to one line.
 *
 * Hand-parsed rather than through a YAML library: `@ksp-gonogo/core` has no
 * YAML dependency and the two existing ci.yml ratchets next door
 * (`ci-test-project-coverage`, `styleguide-type-tests-gated`) read it as text
 * for the same reason. The shape being read is three lines of one file.
 */
function stepCondition(fragment: string): string {
  const lines = readFileSync(CI_YML, "utf8").split("\n");
  const start = lines.findIndex(
    (line) => line.includes("- name:") && line.includes(fragment),
  );
  if (start === -1) {
    throw new Error(
      `No step in ci.yml whose name contains ${JSON.stringify(fragment)}. ` +
        "If it was renamed, update STEP_NAME_FRAGMENT in the same commit: a " +
        "check that cannot find its subject is a check that passes on nothing.",
    );
  }
  const nameIndent = lines[start].search(/\S/);
  const parts: string[] = [];
  let inBlock = false;
  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim() === "") continue;
    const indent = line.search(/\S/);
    // Dedented back to the step list, or a sibling step: this step is over.
    if (indent <= nameIndent) break;
    if (inBlock) {
      // A folded block ends at the next key at the step's own key indent.
      if (/^\s*[a-z-]+:/.test(line) && indent <= nameIndent + 2) break;
      parts.push(line.trim());
      continue;
    }
    const match = /^\s*if:\s*(.*)$/.exec(line);
    if (!match) continue;
    const inline = match[1].trim();
    if (inline === ">-" || inline === ">" || inline === "|") {
      inBlock = true;
      continue;
    }
    return inline;
  }
  if (parts.length > 0) return parts.join(" ");
  throw new Error(
    `The step "${fragment}" has no if: condition. If it now runs ` +
      "unconditionally that is a stronger guarantee than this test checks, " +
      "and this test should be deleted rather than left passing on nothing.",
  );
}

type Ctx = Record<string, unknown>;

/** `github.event.pull_request.head.repo.full_name` -> the value, or undefined. */
function lookup(ctx: Ctx, path: string): unknown {
  let current: unknown = ctx;
  for (const key of path.split(".")) {
    if (typeof current !== "object" || current === null) return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

/**
 * Evaluates the subset of GitHub's expression language these conditions use.
 * Recursive descent over `||` then `&&` then a comparison, with parentheses.
 * Anything outside that subset throws.
 */
function evaluate(expression: string, ctx: Ctx): boolean {
  const tokens = expression.match(
    /\(|\)|\|\||&&|==|!=|'[^']*'|[A-Za-z0-9_.-]+/g,
  );
  if (!tokens) throw new Error(`Unreadable expression: ${expression}`);
  let at = 0;

  function peek(): string | undefined {
    return tokens?.[at];
  }
  function take(): string {
    const token = tokens?.[at++];
    if (token === undefined)
      throw new Error(`Expression ended early: ${expression}`);
    return token;
  }

  function operand(): unknown {
    const token = take();
    if (token.startsWith("'")) return token.slice(1, -1);
    if (token === "true") return true;
    if (token === "false") return false;
    if (/^-?\d+$/.test(token)) return Number(token);
    if (token === "(" || token === ")") {
      throw new Error(
        `Unexpected ${token} where a value belongs: ${expression}`,
      );
    }
    return lookup(ctx, token);
  }

  function comparison(): boolean {
    if (peek() === "(") {
      take();
      const inner = disjunction();
      const close = take();
      if (close !== ")") throw new Error(`Expected ) in: ${expression}`);
      return inner;
    }
    const left = operand();
    const operator = peek();
    if (operator === "==" || operator === "!=") {
      take();
      const right = operand();
      return operator === "==" ? left === right : left !== right;
    }
    // A bare operand is truthy-tested, which is how `if: failure()` -style
    // conditions read. Explicitly not implemented: a function call would parse
    // as a lookup here and answer undefined, so refuse rather than answer.
    if (typeof left === "boolean") return left;
    throw new Error(
      `Not a boolean and not a comparison: ${JSON.stringify(left)} in ${expression}`,
    );
  }

  function conjunction(): boolean {
    let result = comparison();
    while (peek() === "&&") {
      take();
      // No short-circuit: the right side must still PARSE, so an expression
      // this evaluator cannot read is caught rather than skipped over.
      const right = comparison();
      result = result && right;
    }
    return result;
  }

  function disjunction(): boolean {
    let result = conjunction();
    while (peek() === "||") {
      take();
      const right = conjunction();
      result = result || right;
    }
    return result;
  }

  const value = disjunction();
  if (at !== tokens.length) {
    throw new Error(
      `Trailing tokens after the expression (${tokens.slice(at).join(" ")}): ` +
        `${expression}. The evaluator does not implement something this ` +
        "condition uses; extend it rather than trusting this result.",
    );
  }
  return value;
}

/** A `push` event, as GitHub sends it. */
function pushTo(branch: string): Ctx {
  return {
    github: {
      event_name: "push",
      ref: `refs/heads/${branch}`,
      base_ref: "",
      repository: "ksp-gonogo/gonogo",
      event: {},
    },
  };
}

/**
 * A `pull_request` event. `ref` is the MERGE ref, never the base branch, which
 * is the whole point of this file; `base_ref` carries the bare base branch
 * name; `head.repo.full_name` is what separates a fork from a same-repo PR and
 * therefore what separates "has the secret" from "cannot".
 */
function pullRequest(opts: { base: string; headRepo: string }): Ctx {
  return {
    github: {
      event_name: "pull_request",
      ref: "refs/pull/412/merge",
      base_ref: opts.base,
      repository: "ksp-gonogo/gonogo",
      event: {
        pull_request: { head: { repo: { full_name: opts.headRepo } } },
      },
    },
  };
}

const OWN_REPO = "ksp-gonogo/gonogo";

describe("the KSP-assemblies check fires on every path that gates a merge", () => {
  const condition = stepCondition(STEP_NAME_FRAGMENT);

  it("reads the condition it is about, so a pass means something", () => {
    // Guard on the guard: a parser that silently returned "" would answer
    // every case below and answer all of them the same way.
    expect(condition).toContain("github.");
    expect(condition.length).toBeGreaterThan(20);
  });

  it("fires on a push to main and to staging", () => {
    expect(evaluate(condition, pushTo("main"))).toBe(true);
    expect(evaluate(condition, pushTo("staging"))).toBe(true);
  });

  it("fires on a same-repo pull request into main, the merge gate itself", () => {
    expect(
      evaluate(condition, pullRequest({ base: "main", headRepo: OWN_REPO })),
    ).toBe(true);
  });

  it("fires on a same-repo pull request into staging", () => {
    expect(
      evaluate(condition, pullRequest({ base: "staging", headRepo: OWN_REPO })),
    ).toBe(true);
  });

  it("stays out of the way of a fork PR, which cannot hold the secret", () => {
    expect(
      evaluate(
        condition,
        pullRequest({ base: "main", headRepo: "someone-else/gonogo" }),
      ),
    ).toBe(false);
  });

  it("stays out of the way of a push to a throwaway branch", () => {
    expect(evaluate(condition, pushTo("ci-dev"))).toBe(false);
    expect(evaluate(condition, pushTo("fleet/whatever"))).toBe(false);
  });
});
