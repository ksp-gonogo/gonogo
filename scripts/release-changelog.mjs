#!/usr/bin/env node
/**
 * Writes the player changelog for a release range to a file, so no workflow
 * ever carries it through an environment variable or a command line.
 *
 * cliff.toml keeps the conventional types a player reads. What it cannot do is
 * pair a revert with the commit it undid or collapse a subject that landed
 * twice, so this script works those out from the log and hands the ids to
 * git-cliff to skip. A reland is a later commit with the same subject, so it
 * survives, once.
 *
 *   node scripts/release-changelog.mjs --out changelog.md [--range A..B | --tag vX.Y.Z]
 *     [--table FILE --release X.Y.Z] [--max-bytes N] [--link URL]
 *   node scripts/release-changelog.mjs --out capped.md --from changelog.md [--plain] --max-bytes N
 *
 * --tag takes the range from the previous stable tag to that tag, and the
 * whole history when no stable tag precedes it: a pre-release tag is never
 * public, so fixes that landed in a candidate belong to the next stable one.
 * --from only caps a changelog already written; --plain, with --from or
 * without, turns the collapsed sections into plain headings, for a place that
 * cannot fold.
 *
 * With no --range or --tag the range is the previous stable tag to HEAD.
 * --table (or GONOGO_REWORD_TABLE) names a reword table kept outside the
 * repository; see release-reword.mjs for its format.
 *
 * With --max-bytes the file is cut at a line boundary and ends with a pointer
 * to --link, for the places that take a bounded field.
 */
import { execFileSync } from "node:child_process";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { applyTable, readParsers, readTable } from "./release-reword.mjs";
import { makeTempDir } from "./temp-dir.mjs";

const DEFAULT_CONFIG = fileURLToPath(new URL("../cliff.toml", import.meta.url));
const GIT_CLIFF_VERSION = "2.14.2";
const REVERT = /^revert(?:\([^)]*\))?!?:\s*(.*)$/i;
const REVERT_QUOTED = /^revert\s+"(.*)"$/i;
const TYPE_PREFIX = /^[a-z]+(?:\([^)]*\))?!?:\s*/;

const description = (subject) => subject.replace(TYPE_PREFIX, "").trim();

/**
 * Ids to leave out of the changelog, from commits oldest first
 * ({ id, subject, body }): every revert, every commit a revert names (by the
 * shas in its body, or by its description when it names none), and every
 * subject that appears again later.
 */
export function skippedIds(commits) {
  const skip = new Set();
  const byPrefix = (sha) => commits.filter((c) => c.id.startsWith(sha));

  commits.forEach((commit, index) => {
    const text =
      REVERT.exec(commit.subject)?.[1] ??
      REVERT_QUOTED.exec(commit.subject)?.[1];
    if (text === undefined) return;
    skip.add(commit.id);
    const named = [
      ...commit.body.matchAll(
        /(?:reverts?(?: commit)?|This reverts commit)\s+((?:[0-9a-f]{7,40}(?:,\s*)?)+)/gi,
      ),
    ].flatMap((m) => m[1].match(/[0-9a-f]{7,40}/g) ?? []);
    if (named.length > 0) {
      for (const sha of named) for (const c of byPrefix(sha)) skip.add(c.id);
      return;
    }
    const wanted = description(
      text.replace(/\s+and \d+ more$/, "").replace(/^"|"$/g, ""),
    );
    for (let i = index - 1; i >= 0; i--) {
      const prior = commits[i];
      if (skip.has(prior.id)) continue;
      const d = description(prior.subject);
      if (d === wanted || (wanted.length >= 40 && d.startsWith(wanted))) {
        skip.add(prior.id);
        break;
      }
    }
  });

  const newestOf = new Map();
  for (const c of commits)
    if (!skip.has(c.id)) newestOf.set(c.subject.trim(), c.id);
  for (const c of commits) {
    if (!skip.has(c.id) && newestOf.get(c.subject.trim()) !== c.id)
      skip.add(c.id);
  }
  return skip;
}

/** The text cut to `maxBytes` at a line boundary, ending with a pointer to the full changelog. */
export function capChangelog(text, maxBytes, link) {
  if (Buffer.byteLength(text) <= maxBytes) return text;
  const lines = text.split("\n");
  const tail = (omitted) =>
    `\n...and ${omitted} more changes. Full changelog: ${link}\n`;
  const kept = [];
  let size = 0;
  for (const line of lines) {
    const next = size + Buffer.byteLength(line) + 1;
    if (next + Buffer.byteLength(tail(lines.length)) > maxBytes) break;
    kept.push(line);
    size = next;
  }
  const omitted = lines
    .slice(kept.length)
    .filter((l) => l.startsWith("- ")).length;
  return `${kept.join("\n").trimEnd()}\n${tail(omitted)}`;
}

function gitIn(cwd, ...args) {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    maxBuffer: 1 << 28,
  });
}

function readCommits(range, cwd) {
  const raw = gitIn(
    cwd,
    "log",
    "--reverse",
    "--format=%x1e%H%x1f%s%x1f%b",
    ...(range ? [range] : []),
  );
  return raw
    .split("\x1e")
    .filter((r) => r.trim() !== "")
    .map((r) => {
      const [id, subject, body] = r.split("\x1f");
      return { id: id.trim(), subject: subject.trim(), body: body ?? "" };
    });
}

function stableTagBefore(rev, cwd) {
  let tags = "";
  try {
    tags = gitIn(cwd, "tag", "--sort=-creatordate", "--merged", rev);
  } catch {
    // a root commit has no parent, so nothing precedes it
  }
  return tags.split("\n").find((t) => /^v\d+\.\d+\.\d+$/.test(t));
}

/** The previous stable tag to `tag`, or `..tag` (the whole history, spelled as a range because git-cliff rejects a bare revision) when no stable tag precedes it. */
export function rangeForTag(tag, cwd) {
  const stable = stableTagBefore(`${tag}^`, cwd);
  return stable ? `${stable}..${tag}` : `..${tag}`;
}

/** The previous stable tag to HEAD: what the next release would hold. */
export function rangeForUnreleased(cwd) {
  const stable = stableTagBefore("HEAD", cwd);
  return stable ? `${stable}..HEAD` : "..HEAD";
}

function cliffCommand() {
  const bin = process.env.GIT_CLIFF;
  return bin ? [bin, []] : ["npx", ["--yes", `git-cliff@${GIT_CLIFF_VERSION}`]];
}

function runCliff(args, cwd) {
  const [cmd, pre] = cliffCommand();
  return execFileSync(cmd, [...pre, ...args], {
    cwd,
    encoding: "utf8",
    maxBuffer: 1 << 28,
    stdio: ["ignore", "pipe", "pipe"],
  });
}

const skipArgs = (ids) => ids.flatMap((id) => ["--skip-commit", id]);

/**
 * The changelog text for `range`. With a reword `table` the commits are read
 * as git-cliff's context, the table is applied to that JSON, and the same
 * template renders it with --from-context; without one git-cliff renders the
 * range directly.
 */
export function buildChangelog({ range, table, cwd, config = DEFAULT_CONFIG }) {
  const configPath = resolve(cwd ?? ".", config);
  const skip = skipArgs([...skippedIds(readCommits(range, cwd))]);
  const base = ["--config", configPath, "--strip", "all"];
  if (!table)
    return runCliff([...base, ...skip, ...(range ? [range] : [])], cwd);

  const releases = JSON.parse(
    runCliff([...base, "--context", ...skip, ...(range ? [range] : [])], cwd),
  );
  const rangeShas = gitIn(cwd, "rev-list", ...(range ? [range] : ["HEAD"]))
    .split("\n")
    .filter(Boolean);
  const applied = applyTable(
    releases,
    table,
    rangeShas,
    readParsers(readFileSync(configPath, "utf8")),
  );
  const dir = makeTempDir("reword-context-");
  try {
    const contextFile = join(dir, "context.json");
    writeFileSync(contextFile, JSON.stringify(applied));
    return runCliff([...base, "--from-context", contextFile], cwd);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * The same notes for a place with no folding (SpaceDock): each collapsed
 * section becomes a plain heading, in the order it already has.
 */
export function plainSections(markdown) {
  return markdown
    .replace(
      /<details>\s*<summary>(.*?)<\/summary>/gs,
      (_, title) => `## ${title.replace(/<[^>]+>/g, "")}\n`,
    )
    .replace(/<\/details>\n?/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .concat("\n");
}

export function main(argv) {
  const opt = (name) => {
    const i = argv.indexOf(name);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const out = opt("--out");
  if (!out) {
    process.stderr.write(
      "usage: release-changelog.mjs --out FILE [--range A..B | --tag vX.Y.Z]\n" +
        "         [--table FILE --release X.Y.Z] [--plain] [--max-bytes N] [--link URL]\n" +
        "       release-changelog.mjs --out FILE --from FILE [--plain] [--max-bytes N] [--link URL]\n",
    );
    return 2;
  }
  const max = opt("--max-bytes");
  const link = opt("--link") ?? "the GitHub Releases page";
  const from = opt("--from");
  let text;
  if (from) {
    text = readFileSync(from, "utf8");
  } else {
    const tag = opt("--tag");
    const range =
      opt("--range") ?? (tag ? rangeForTag(tag) : rangeForUnreleased());
    const tablePath = opt("--table") ?? process.env.GONOGO_REWORD_TABLE;
    let table;
    if (tablePath) {
      table = readTable(tablePath);
      const release = opt("--release");
      if (release !== table.release) {
        process.stderr.write(
          `the reword table is for release ${table.release}, and --release says ${release ?? "nothing"}\n`,
        );
        return 2;
      }
    }
    try {
      text = `${buildChangelog({ range, table }).trim()}\n`;
    } catch (error) {
      process.stderr.write(`${error.message}\n`);
      return 1;
    }
  }
  if (argv.includes("--plain")) text = plainSections(text);
  if (max) text = capChangelog(text, Number(max), link);
  writeFileSync(out, text);
  process.stdout.write(
    `wrote ${out}: ${text.split("\n").length - 1} lines, ${Buffer.byteLength(text)} bytes\n`,
  );
  return 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url))
  process.exit(main(process.argv.slice(2)));
