#!/usr/bin/env node
/**
 * Applies a release's reword table to git-cliff's context.
 *
 * The table is literal static data for ONE release, a JSON file kept outside
 * the repository:
 *
 *   {
 *     "version": 1,
 *     "release": "1.1.0",
 *     "ops": {
 *       "<40-hex sha>": { "op": "drop" },
 *       "<40-hex sha>": { "op": "reword", "subject": "fix(comms): a new subject" },
 *       "<40-hex sha>": { "op": "absorb", "into": "<40-hex sha>", "subject": "optional new subject for the target" },
 *       "<40-hex sha>": { "op": "split", "lines": ["feat(app): one line", "fix(app): another"] }
 *     }
 *   }
 *
 * Every subject must pass the rules .githooks/commit-msg enforces. Anything
 * the table cannot apply throws; nothing is skipped quietly.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const MAX_SUBJECT = 100;
export const TABLE_VERSION = 1;
const FULL_SHA = /^[0-9a-f]{40}$/;
const TYPES = [
  "feat",
  "fix",
  "docs",
  "style",
  "refactor",
  "perf",
  "test",
  "build",
  "ci",
  "chore",
  "revert",
];
const CONVENTIONAL = new RegExp(`^(${TYPES.join("|")})(\\([^)]+\\))?!?: .`);
const SUBJECT_PARTS = /^([a-z]+)(?:\(([^)]*)\))?(!)?:\s*(.*)$/;
const TRACKER =
  /\bsaga\b|\bbatch [0-9]+|\bstage [0-9]+|\bdecision [0-9]+|#[0-9]+/i;
const LONG_DASH = /[\u2013\u2014]/;
const ATTRIBUTION = /^(co-authored-by|generated-with|assisted-by):/im;

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..");
const WIDGET_SOURCES = ["packages/components/src", "mod/*Uplink/client/src/*"];

/** The text between the bracket at `open` and its match. */
function braced(text, open) {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    if (text[i] === "{" || text[i] === "[") depth++;
    if (text[i] === "}" || text[i] === "]") depth--;
    if (depth === 0) return text.slice(open + 1, i);
  }
  throw new Error("unbalanced braces");
}

/**
 * The name every widget registers under, read from the `registerComponent`
 * calls in core's widgets and the bundled Uplinks, which is where the Uplink
 * pages read them too. A registration with no literal name throws, so a name
 * this cannot read is a failure and not a silent gap.
 */
export function widgetNames(root = REPO) {
  const files = execFileSync("git", ["ls-files", ...WIDGET_SOURCES], {
    cwd: root,
    encoding: "utf8",
  })
    .split("\n")
    .filter((f) => /\.tsx?$/.test(f) && !/\.test(-d)?\.tsx?$/.test(f));
  const names = new Set();
  for (const file of files) {
    const text = readFileSync(join(root, file), "utf8");
    for (const m of text.matchAll(/registerComponent(?:<[^>]*>)?\(\s*\{/g)) {
      const body = braced(text, (m.index ?? 0) + m[0].length - 1);
      const name = body.match(/^\s*name:\s*"([^"]+)"/m)?.[1];
      if (name === undefined)
        throw new Error(`${file}: a registration with no literal name`);
      names.add(name);
    }
  }
  return [...names].sort();
}

/**
 * The widget names a subject puts "the", "a" or "an" in front of. The player
 * says "Ground Track", never "the Ground Track", so a line that does is
 * refused. The article is matched in any case (a line can start with it) and
 * the name in its own case, so "a ground track" in plain prose passes.
 */
export function articleProblems(subject, names) {
  const problems = [];
  for (const name of names) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const m = subject.match(
      new RegExp(`\\b([Tt][Hh][Ee]|[Aa][Nn]?) (?=${escaped}(?![\\w]))`),
    );
    if (m)
      problems.push(
        `the subject puts "${m[1].toLowerCase()}" before the widget name "${name}", which is never given an article`,
      );
  }
  return problems;
}

/** The reasons a subject fails the commit-msg rules, empty when it passes. */
export function subjectProblems(subject) {
  if (typeof subject !== "string" || subject.trim() === "")
    return ["the subject is empty"];
  const problems = [];
  if (/[\r\n]/.test(subject))
    problems.push("the subject is more than one line");
  if (!CONVENTIONAL.test(subject))
    problems.push(
      "the subject is not a Conventional Commit (type(scope): description)",
    );
  if (subject.length > MAX_SUBJECT)
    problems.push(
      `the subject is ${subject.length} characters (the limit is ${MAX_SUBJECT})`,
    );
  if (TRACKER.test(subject))
    problems.push("the subject names a tracker ticket");
  if (LONG_DASH.test(subject))
    problems.push("the subject contains an em dash or an en dash");
  if (ATTRIBUTION.test(subject))
    problems.push("the subject carries an attribution trailer");
  return problems;
}

const unescapeToml = (s) => s.replace(/\\(["\\])/g, "$1");

/**
 * The commit_parsers of a cliff.toml as { re, group?, skip? } in order.
 * Reads the one-inline-table-per-line form the file is written in.
 */
export function readParsers(tomlText) {
  const block = /commit_parsers = \[([\s\S]*?)\n\]/.exec(tomlText);
  if (!block) throw new Error("cliff.toml has no commit_parsers");
  const parsers = [];
  for (const line of block[1].split("\n")) {
    const message = /message = "((?:[^"\\]|\\.)*)"/.exec(line);
    if (!message) continue;
    const group = /group = "((?:[^"\\]|\\.)*)"/.exec(line);
    parsers.push({
      re: new RegExp(unescapeToml(message[1])),
      group: group ? unescapeToml(group[1]) : undefined,
      skip: /skip = true/.test(line),
    });
  }
  return parsers;
}

/** The cliff group a subject lands in, or null when cliff.toml leaves it out. */
export function groupOf(subject, parsers) {
  const hit = parsers.find((p) => p.re.test(subject));
  if (!hit || hit.skip) return null;
  return hit.group ?? null;
}

/** A context commit rewritten to carry `subject`, regrouped by cliff.toml's parsers. */
function withSubject(commit, subject, parsers) {
  const parts = SUBJECT_PARTS.exec(subject);
  const group = groupOf(subject, parsers);
  if (!parts || group === null)
    throw new Error(
      `${commit.id}: "${subject}" would be left out of the changelog by cliff.toml; use a type and scope it lists`,
    );
  return {
    ...commit,
    raw_message: subject,
    message: parts[4],
    scope: parts[2] ?? null,
    group,
    breaking: Boolean(parts[3]),
  };
}

/** The table read from `path` and checked for shape; ops are not yet checked against a release. */
export function readTable(path) {
  let raw;
  try {
    raw = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw new Error(
      `the reword table ${path} cannot be read: ${error.message}`,
    );
  }
  return checkTableShape(raw);
}

export function checkTableShape(table) {
  const fail = (m) => {
    throw new Error(`reword table: ${m}`);
  };
  if (table === null || typeof table !== "object" || Array.isArray(table))
    fail("it is not an object");
  if (table.version !== TABLE_VERSION) fail(`version must be ${TABLE_VERSION}`);
  if (
    typeof table.release !== "string" ||
    !/^\d+\.\d+\.\d+$/.test(table.release)
  )
    fail("release must be an X.Y.Z string");
  if (
    table.ops === null ||
    typeof table.ops !== "object" ||
    Array.isArray(table.ops)
  )
    fail("ops must be an object keyed by full commit sha");
  for (const [sha, op] of Object.entries(table.ops)) {
    if (!FULL_SHA.test(sha)) fail(`"${sha}" is not a full 40-hex sha`);
    if (op === null || typeof op !== "object")
      fail(`${sha}: the op is not an object`);
    switch (op.op) {
      case "drop":
        break;
      case "reword":
        if (typeof op.subject !== "string")
          fail(`${sha}: reword needs a subject`);
        break;
      case "absorb":
        if (typeof op.into !== "string" || !FULL_SHA.test(op.into))
          fail(`${sha}: absorb needs "into" as a full 40-hex sha`);
        if (op.subject !== undefined && typeof op.subject !== "string")
          fail(`${sha}: absorb subject must be a string`);
        break;
      case "split":
        if (!Array.isArray(op.lines) || op.lines.length < 2)
          fail(`${sha}: split needs "lines" with at least two subjects`);
        break;
      default:
        fail(`${sha}: unknown op "${op.op}"`);
    }
  }
  return table;
}

/** Why an absorb cannot be applied, or null when it can. */
function absorbFault(sha, op, ops, inRange, held) {
  const into = op.into;
  if (into === sha) return `${sha}: absorbs into itself`;
  if (!inRange.has(into))
    return `${sha}: absorb target ${into} is outside the release`;
  if (!held.has(into))
    return `${sha}: absorb target ${into} is not in the changelog`;
  const target = ops[into];
  if (!target) return null;
  if (target.op === "drop" || target.op === "absorb")
    return `${sha}: absorb target ${into} is itself ${target.op === "drop" ? "dropped" : "absorbed"}; a chain or cycle is refused`;
  if (op.subject === undefined) return null;
  if (target.op === "split")
    return `${sha}: absorb target ${into} is split, so the absorb cannot give it a subject`;
  if (target.op === "reword")
    return `${sha}: absorb target ${into} is reworded twice (its own reword and this absorb's subject)`;
  return null;
}

/**
 * The context releases ({ commits: [...] }) with the table applied.
 *
 * `rangeShas` is every sha in the release range. Throws on a sha outside the
 * range, an absorb target outside the range, a sha the changelog does not
 * hold, an absorb into a dropped or absorbed commit (a chain, which includes
 * a cycle), an absorb with a subject into a split or reworded commit, and a
 * subject that fails the rules.
 */
export function applyTable(
  releases,
  table,
  rangeShas,
  parsers,
  names = widgetNames(),
) {
  checkTableShape(table);
  const inRange = new Set(rangeShas);
  const held = new Set(releases.flatMap((r) => r.commits.map((c) => c.id)));
  const ops = table.ops;
  const errors = [];
  const problemsOf = (sha, what, subject) => {
    const found =
      typeof subject === "string"
        ? [...subjectProblems(subject), ...articleProblems(subject, names)]
        : subjectProblems(subject);
    for (const p of found) errors.push(`${sha}: ${what}: ${p}`);
  };

  for (const [sha, op] of Object.entries(ops)) {
    if (!inRange.has(sha)) {
      errors.push(`${sha}: outside the release range`);
      continue;
    }
    if (!held.has(sha)) {
      errors.push(
        `${sha}: in the release range but not in the changelog (cliff.toml, a revert or a duplicate subject already leaves it out)`,
      );
      continue;
    }
    if (op.op === "reword") problemsOf(sha, "reword", op.subject);
    if (op.op === "split")
      for (const [i, line] of op.lines.entries())
        problemsOf(sha, `split line ${i + 1}`, line);
    if (op.op === "absorb") {
      if (op.subject !== undefined)
        problemsOf(sha, "absorb subject", op.subject);
      const fault = absorbFault(sha, op, ops, inRange, held);
      if (fault) errors.push(fault);
    }
  }
  if (errors.length > 0)
    throw new Error(`reword table refused:\n  ${errors.join("\n  ")}`);

  const retitled = new Map();
  for (const [sha, op] of Object.entries(ops)) {
    if (op.op !== "absorb" || op.subject === undefined) continue;
    if (retitled.has(op.into))
      throw new Error(
        `reword table refused:\n  ${sha}: absorb target ${op.into} is given two subjects`,
      );
    retitled.set(op.into, op.subject);
  }

  return releases.map((release) => ({
    ...release,
    commits: release.commits.flatMap((commit) => {
      const op = ops[commit.id];
      if (op === undefined) {
        const subject = retitled.get(commit.id);
        return [subject ? withSubject(commit, subject, parsers) : commit];
      }
      if (op.op === "drop" || op.op === "absorb") return [];
      if (op.op === "reword") return [withSubject(commit, op.subject, parsers)];
      return op.lines.map((line) => withSubject(commit, line, parsers));
    }),
  }));
}
