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
process.exit(
  run("git", ["push", ...process.argv.slice(2)], { GONOGO_GATE_DONE: "1" }),
);
