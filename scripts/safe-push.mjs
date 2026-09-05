#!/usr/bin/env node
/*
 * `pnpm push` - run the gate, THEN open the connection to GitHub.
 *
 * The pre-push hook runs after git has already opened its connection, and on a
 * cold turbo cache it takes long enough that GitHub closes the socket first:
 * git dies with SIGPIPE (141) while the hook prints "all checks passed", so the
 * push reports success and nothing reaches the remote. That happened twice on
 * 2026-09-02 and is indistinguishable from a flake unless you read the exit code.
 *
 * Running the gate first means the connection is opened only for the seconds the
 * transfer actually needs. The hook stays in place as a backstop for anyone who
 * runs `git push` directly.
 */
import { spawnSync } from "node:child_process";

const run = (cmd, args, env) =>
  spawnSync(cmd, args, { stdio: "inherit", env: { ...process.env, ...env } })
    .status ?? 1;

const skipE2e = process.env.SKIP_E2E === "1";

const capture0 = (args) =>
  spawnSync("git", args, { encoding: "utf8" }).stdout?.trim() ?? "";

/**
 * True when everything the remote has gained is the docs bot regenerating
 * Uplink pages, and nothing else.
 *
 * `uplink-docs.yml` pushes "chore: regenerate Uplink pages" on its own
 * schedule, so it lands mid-gate and rejects a push that took fifteen minutes
 * to earn. Four rejections on 2026-09-04. Rebasing over it is safe in a way
 * that rebasing over a person is not: the commits are authored by
 * github-actions[bot] and touch only generated doc assets under
 * mod/<Uplink>/client/, never source, so nothing the gate just tested changes
 * underneath it. Anything else, including one human commit mixed in, falls
 * through to the normal rejection.
 */
const incomingIsOnlyDocsBot = (branch) => {
  const range = `HEAD..origin/${branch}`;
  const authors = capture0(["log", "--format=%an", range]).split("\n");
  if (authors.length === 0 || authors.some((a) => a !== "github-actions[bot]"))
    return false;
  // THREE dots. `diff A..B` compares the two TREES, so once this branch has any
  // commit of its own — which is the only situation in which we are pushing —
  // it lists our files alongside the remote's and the every-file test below
  // fails on our own work. `A...B` is the changes on the REMOTE side since the
  // merge base, which is what "everything the remote has gained" means. The
  // two-dot form made this helper report false in every real push: measured at
  // 28 files against 3 on the run that found it, which is why five rejections
  // in one night each cost a full gate despite the rebase existing.
  const files = capture0([
    "diff",
    "--name-only",
    `HEAD...origin/${branch}`,
  ]).split("\n");
  return (
    files.length > 0 &&
    files.every((f) =>
      /^mod\/[^/]+\/client\/(docs\/|README\.md|gonogo-uplink\.json)/.test(f),
    )
  );
};

/**
 * Refuse to spend the gate on a branch the remote has already moved past.
 *
 * `uplink-docs.yml` heals the generated Uplink pages by pushing a
 * "chore: regenerate Uplink pages" commit, and it lands whenever it likes,
 * including in the middle of the fifteen minutes this gate takes. Three pushes
 * on 2026-09-04 passed 46/46 and were then rejected non-fast-forward, each
 * costing a full suite run. Checking first turns a quarter-hour into a second
 * and says exactly what to do about it.
 */
{
  const capture = (args) =>
    spawnSync("git", args, { encoding: "utf8" }).stdout?.trim() ?? "";
  const branch = capture(["rev-parse", "--abbrev-ref", "HEAD"]);
  // A force flag is the caller stating that the remote deliberately differs,
  // which is exactly what a rebased branch looks like. Checking "behind" here
  // refused a legitimate `--force-with-lease` push and advised rebasing onto
  // the branch's own pre-rebase remote, which would have replayed the commits
  // back onto the base they had just been moved off and undone the rebase.
  // A wrong remedy is worse than no check.
  const forced = process.argv
    .slice(2)
    .some(
      (a) =>
        a === "-f" || a === "--force" || a.startsWith("--force-with-lease"),
    );
  if (branch !== "HEAD" && !forced) {
    const remote = capture(["ls-remote", "origin", branch]).split(/\s+/)[0];
    // An absent branch is a first push, which cannot be behind anything.
    if (remote && spawnSync("git", ["cat-file", "-e", remote]).status === 0) {
      const behind =
        spawnSync("git", ["merge-base", "--is-ancestor", remote, "HEAD"])
          .status !== 0;
      if (behind) {
        // Behind by ONLY the docs bot is the common case and it is not a
        // reason to make someone re-run a quarter-hour gate by hand: the
        // commits are generated doc assets, so rebasing over them changes
        // nothing the gate is about to test. Do it here and carry on. Five
        // rejections on 2026-09-05 each cost a full gate run, because this
        // check aborted BEFORE the gate while the identical rebase already
        // existed for the AFTER case further down.
        spawnSync("git", ["fetch", "origin", "--quiet"]);
        if (
          incomingIsOnlyDocsBot(branch) &&
          spawnSync("git", ["rebase", `origin/${branch}`], {
            stdio: "inherit",
          }).status === 0
        ) {
          console.log(
            `push: ${branch} was behind only the docs bot's regenerated pages; rebased over them, continuing.`,
          );
        } else {
          console.error(
            `push: ${branch} is behind the remote (${remote.slice(0, 9)}); ` +
              "the gate would pass and the push would be rejected.\n" +
              `  Rebase first:  git fetch origin && git rebase origin/${branch}`,
          );
          process.exit(1);
        }
      }
    }
  }
}

console.log("push: lint...");
if (run("pnpm", ["exec", "biome", "check", "."]) !== 0) {
  console.error("push: lint failed, nothing pushed.");
  process.exit(1);
}

console.log("push: tests...");
if (
  run(
    "pnpm",
    ["exec", "turbo", "run", "test", "test:scans", "--concurrency=1"],
    { CI: "true" },
  ) !== 0
) {
  console.error("push: tests failed, nothing pushed.");
  process.exit(1);
}

if (!skipE2e)
  console.log(
    "push: (set SKIP_E2E=1 to skip Playwright; CI runs the matrix regardless)",
  );

console.log("push: gate green, opening the connection...");
// GONOGO_GATE_DONE tells the hook the work is already done, so it does not repeat it
// and hold the socket open for the length of a second full run.
let pushStatus = run("git", ["push", ...process.argv.slice(2)], {
  GONOGO_GATE_DONE: "1",
});

if (pushStatus !== 0) {
  const branch = capture0(["rev-parse", "--abbrev-ref", "HEAD"]);
  spawnSync("git", ["fetch", "origin", "--quiet"]);
  if (branch !== "HEAD" && incomingIsOnlyDocsBot(branch)) {
    console.log(
      "push: rejected by the docs bot's regenerated pages; rebasing over them and retrying once.",
    );
    if (
      spawnSync("git", ["rebase", `origin/${branch}`], { stdio: "inherit" })
        .status === 0
    ) {
      pushStatus = run("git", ["push", ...process.argv.slice(2)], {
        GONOGO_GATE_DONE: "1",
      });
    } else {
      console.error(
        "push: rebase over the docs bot hit a conflict; resolve it by hand.",
      );
      spawnSync("git", ["rebase", "--abort"]);
    }
  }
}
if (pushStatus !== 0) process.exit(pushStatus);

/**
 * Ask the REMOTE whether the push landed, rather than believing git's exit code.
 *
 * Exit 0 is not evidence the branch reached GitHub. A dropped connection prints
 * "all checks passed" and exits 0; piping the command through `tail` reports
 * tail's status instead of the gate's. Between them those two cost four false
 * "pushed" reports on 2026-09-04 alone, to three agents and to the orchestrator,
 * and every one was caught by this comparison and by nothing else. The check
 * belongs here rather than in a habit, because the habit demonstrably does not
 * hold under a long session.
 */
const capture = (args) =>
  spawnSync("git", args, { encoding: "utf8" }).stdout?.trim() ?? "";

const branch = capture(["rev-parse", "--abbrev-ref", "HEAD"]);
const explicitRefspec = process.argv
  .slice(2)
  .some((a) => !a.startsWith("-") && a !== "origin" && a !== branch);

if (branch === "HEAD" || explicitRefspec) {
  // A detached HEAD or a hand-written refspec means local HEAD is not what was
  // pushed, so the comparison below would be meaningless rather than reassuring.
  console.log("push: done (landing not verified: non-default refspec).");
  process.exit(0);
}

const local = capture(["rev-parse", "HEAD"]);
const remote = capture(["ls-remote", "origin", branch]).split(/\s+/)[0] ?? "";

if (local !== remote) {
  console.error(
    `push: git exited 0 but ${branch} did NOT land.\n` +
      `  local:  ${local}\n  remote: ${remote || "(absent)"}\n` +
      "Nothing reached the remote. Re-run the push; do not report this as pushed.",
  );
  process.exit(1);
}

console.log(`push: landed, ${branch} at ${local.slice(0, 9)} on the remote.`);
