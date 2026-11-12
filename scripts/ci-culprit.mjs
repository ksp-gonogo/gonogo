#!/usr/bin/env node
/**
 * Finds the commit of a push that made a gate fail, in the runner the gate just
 * failed in.
 *
 * A gate that reports widgets (`<widget> @ <size> (<fixture>): <finding>`) names
 * what failed, so the search re-runs the gate for those widgets alone at the
 * commits of the push, oldest first, and bisects to the first commit where they
 * fail. The checkout, the installed dependencies and the build cache are the
 * ones the failed run already has, so each step costs one scoped run and not a
 * whole job.
 *
 * It never fails the job: it prints the answer, writes it to the step summary
 * and, with `--post`, posts it as the `ci/culprit` commit status for whoever
 * reads the commit. A push it cannot search (too many commits, the base
 * missing, the gate already failing before the push) says so and names no one.
 *
 * Usage:
 *   ci-culprit.mjs --log <file> --repo <owner/repo> --before <sha> --head <sha>
 *     --command <cmd> [--prepare <cmd>] [--max <n>] [--post]
 *
 * `{widgets}` in the command becomes the comma-joined directories under
 * `packages/components/src` that the failing widgets live in; a command without
 * it runs whole at each step. `--prepare` runs after each checkout (a build).
 */

import { execFileSync, spawnSync } from "node:child_process";
import { appendFileSync, existsSync, readdirSync, readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

/** The commit status the answer is posted under. */
export const STATUS_CONTEXT = "ci/culprit";

const WIDGETS_DIR = "packages/components/src";

const RENDER_FINDING =
  /^[ \t]*([a-z][a-z0-9]*(?:[-.][a-z0-9]+)*) @ [^\n(]+\([^\n)]*\): /gm;
const MINSIZE_FINDING =
  /^[ \t]+([a-z][a-z0-9]*(?:[-.][a-z0-9]+)*)[ \t]{2,}[\w-]+[ \t]+\(new\)[ \t]*$/gm;

/** The widget ids a gate's output reports a finding for, in order of appearance. */
export function failingWidgets(log) {
  const ids = [];
  for (const re of [RENDER_FINDING, MINSIZE_FINDING]) {
    for (const match of log.matchAll(re)) {
      if (!ids.includes(match[1])) ids.push(match[1]);
    }
  }
  return ids;
}

const squash = (text) => text.toLowerCase().replace(/[^a-z0-9]/g, "");

/** The directories, from `dirs`, that the widget ids name (a widget id is its folder in kebab case). */
export function widgetDirs(ids, dirs) {
  const wanted = new Set(ids.map(squash));
  return dirs.filter((dir) => wanted.has(squash(dir)));
}

/**
 * The first commit at which `fails` is true, when it stays true from there to
 * the last commit. `commits` is oldest first and its last entry is known to
 * fail. `{ culprit, steps }`; `steps` is how many commits were tried.
 */
export function search(commits, fails) {
  let low = 0;
  let high = commits.length - 1;
  let steps = 0;
  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    steps += 1;
    if (fails(commits[mid])) high = mid;
    else low = mid + 1;
  }
  return { culprit: commits[low], steps };
}

function git(...args) {
  return execFileSync("git", args, { encoding: "utf8" }).trim();
}

function run(command) {
  return spawnSync("bash", ["-c", command], { stdio: "inherit" }).status === 0;
}

function flag(argv, name) {
  const at = argv.indexOf(name);
  return at === -1 ? undefined : argv[at + 1];
}

function report(answer, argv) {
  console.log(answer);
  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, `### ${answer}\n`);
  }
  if (argv.includes("--post")) {
    try {
      execFileSync(
        "gh",
        [
          "api",
          `repos/${flag(argv, "--repo")}/statuses/${flag(argv, "--head")}`,
          "-f",
          "state=success",
          "-f",
          `context=${STATUS_CONTEXT}`,
          "-f",
          `description=${answer}`.slice(0, 140),
        ],
        { stdio: "inherit" },
      );
    } catch (error) {
      console.log(`could not post the status: ${error.message}`);
    }
  }
}

function main(argv) {
  const log = flag(argv, "--log");
  const before = flag(argv, "--before");
  const head = flag(argv, "--head");
  const command = flag(argv, "--command");
  const prepare = flag(argv, "--prepare");
  const max = Number(flag(argv, "--max") ?? 16);
  if (!log || !head || !command) {
    console.error(
      "usage: ci-culprit.mjs --log <file> --repo <r> --before <sha> --head <sha> --command <cmd> [--prepare <cmd>] [--max <n>] [--post]",
    );
    return;
  }
  const ids = existsSync(log) ? failingWidgets(readFileSync(log, "utf8")) : [];
  const dirs = widgetDirs(
    ids,
    existsSync(WIDGETS_DIR) ? readdirSync(WIDGETS_DIR) : [],
  );
  if (command.includes("{widgets}") && !dirs.length) {
    report(
      "culprit: not searched, the output names no widget the gate can scope to",
      argv,
    );
    return;
  }
  const scoped = command.replace("{widgets}", dirs.join(","));

  let commits = [];
  try {
    git("fetch", "--no-tags", "--depth=200", "origin", head);
    commits = git("rev-list", "--reverse", `${before}..${head}`)
      .split("\n")
      .filter(Boolean);
  } catch {
    report("culprit: not searched, the push's commits could not be read", argv);
    return;
  }
  if (commits.length < 2 || commits.length > max) {
    report(
      commits.length < 2
        ? `culprit: ${head.slice(0, 7)} is the only commit of the push`
        : `culprit: not searched, the push has ${commits.length} commits (the limit is ${max})`,
      argv,
    );
    return;
  }

  const fails = (sha) => {
    git("checkout", "--quiet", "--detach", sha);
    if (prepare && !run(prepare)) throw new Error(`prepare failed at ${sha}`);
    return !run(scoped);
  };
  try {
    if (fails(before)) {
      report(
        `culprit: not in this push, the gate already fails at ${before.slice(0, 7)}`,
        argv,
      );
      return;
    }
    const { culprit, steps } = search(commits, fails);
    const subject = git("log", "-1", "--format=%s", culprit);
    report(
      `culprit: ${culprit.slice(0, 7)} ${subject} (found in ${steps + 1} runs)`,
      argv,
    );
  } catch (error) {
    report(`culprit: not searched, ${error.message}`, argv);
  } finally {
    git("checkout", "--quiet", "--detach", head);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main(process.argv.slice(2));
}
