#!/usr/bin/env node
/**
 * The verdict of one CI run, in three grades instead of two.
 *
 * Green: everything passed. Red: a job that gates the tree failed (build,
 * typecheck, unit tests, e2e, the mod). Amber: only a ratchet-style gate failed
 * (the face, render and minsize gates), which is a debt list or a baseline that
 * moved rather than a broken tree.
 *
 * Amber jobs carry `continue-on-error` on a push to `ci-dev`, so the run still
 * concludes success and the commit stays where it landed; this script is what
 * keeps that from reaching `staging`. It reads the real conclusion of every job
 * back from the API (a `continue-on-error` job that failed shows up there as a
 * failed step), posts the grade as the `ci/verdict` commit status, and fails
 * the run when the grade is red, or amber anywhere amber is not tolerated.
 * `ci-dev-forward-verdict.sh` reads the same status and refuses to forward an
 * amber commit.
 *
 * Usage:
 *   ci-verdict.mjs --repo <owner/repo> --run <id> --sha <sha> [--tolerate-amber] [--post]
 */

import { execFileSync } from "node:child_process";
import { appendFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

/** The commit status the grade is posted under. */
export const STATUS_CONTEXT = "ci/verdict";

/** The job that runs this script, left out of its own reading. */
export const OWN_JOB = "verdict";

/** Jobs whose failure is amber. Everything else that fails is red. */
export const AMBER_JOBS = [/^face-gate\b/, /^render-gate\b/, /^minsize-gate\b/];

/** Steps that report on a failure and never are one. */
const REPORTING_STEPS = [/^Find the commit/];

const FAILED = new Set(["failure", "timed_out", "startup_failure"]);

const isAmberJob = (name) => AMBER_JOBS.some((re) => re.test(name));

/**
 * Whether a job failed. A `continue-on-error` job concludes success whatever
 * its steps did, so an amber job is read by its steps too. A hard job is read
 * by its conclusion alone: several of them have a step that is allowed to fail.
 */
export function jobFailed(job) {
  if (FAILED.has(job.conclusion)) return true;
  if (!isAmberJob(job.name)) return false;
  return (job.steps ?? []).some(
    (step) =>
      FAILED.has(step.conclusion) &&
      !REPORTING_STEPS.some((re) => re.test(step.name ?? "")),
  );
}

/**
 * The grade of a run from its jobs: `{ grade, amber, red, label }`. A job that
 * was skipped or cancelled says nothing either way.
 */
export function classify(jobs) {
  const amber = [];
  const red = [];
  for (const job of jobs) {
    if (job.name === OWN_JOB || !jobFailed(job)) continue;
    (isAmberJob(job.name) ? amber : red).push(job.name);
  }
  const grade = red.length ? "red" : amber.length ? "amber" : "green";
  const text =
    grade === "red"
      ? `red: ${red.join(", ")}`
      : grade === "amber"
        ? `amber: ${amber.join(", ")}`
        : "green";
  const mark = { red: "\u{1F534}", amber: "\u{1F7E0}", green: "\u{1F7E2}" }[
    grade
  ];
  return { grade, amber, red, text, label: `${mark} ${text}` };
}

/** Whether the run must fail on this grade. */
export function failsRun(grade, tolerateAmber) {
  return grade === "red" || (grade === "amber" && !tolerateAmber);
}

function gh(args) {
  return execFileSync("gh", args, { encoding: "utf8" });
}

function readJobs(repo, run) {
  const out = gh([
    "api",
    `repos/${repo}/actions/runs/${run}/jobs?per_page=100`,
  ]);
  const body = JSON.parse(out);
  if (body.total_count !== body.jobs.length) {
    throw new Error(
      `${body.total_count} jobs exist but ${body.jobs.length} were listed`,
    );
  }
  return body.jobs;
}

function flag(argv, name) {
  const at = argv.indexOf(name);
  return at === -1 ? undefined : argv[at + 1];
}

function main(argv) {
  const repo = flag(argv, "--repo");
  const run = flag(argv, "--run");
  const sha = flag(argv, "--sha");
  if (!repo || !run || !sha) {
    console.error(
      "usage: ci-verdict.mjs --repo <owner/repo> --run <id> --sha <sha> [--tolerate-amber] [--post]",
    );
    process.exit(2);
  }
  const tolerateAmber = argv.includes("--tolerate-amber");
  const { grade, label, text, amber, red } = classify(readJobs(repo, run));
  console.log(label);
  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(
      process.env.GITHUB_STEP_SUMMARY,
      `### ${label}\n\n${
        grade === "amber"
          ? `${amber.join(", ")} failed. ${tolerateAmber ? "The commit stays on this branch and is not forwarded until the next run is green." : "Amber is only tolerated on a push to ci-dev, so this run fails."}\n`
          : grade === "red"
            ? `${red.join(", ")} failed.\n`
            : "Every job passed.\n"
      }`,
    );
  }
  if (argv.includes("--post")) {
    gh([
      "api",
      `repos/${repo}/statuses/${sha}`,
      "-f",
      `state=${grade === "red" ? "failure" : "success"}`,
      "-f",
      `context=${STATUS_CONTEXT}`,
      "-f",
      // a status description refuses a 4-byte character, so the posted text is the plain one
      `description=${text}`.slice(0, 140),
    ]);
  }
  process.exit(failsRun(grade, tolerateAmber) ? 1 : 0);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main(process.argv.slice(2));
}
