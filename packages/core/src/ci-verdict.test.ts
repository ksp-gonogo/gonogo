// @vitest-environment node
import { execFileSync, spawnSync } from "node:child_process";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import {
  AMBER_JOBS,
  classify,
  failsRun,
  jobFailed,
  OWN_JOB,
} from "../../../scripts/ci-verdict.mjs";

/**
 * A run has three grades. A ratchet-style gate failing is amber and the commit
 * stays; anything else failing is red. The workflow tolerates amber only on a
 * push to ci-dev, and the forwarder refuses an amber commit.
 */

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const ci = readFileSync(join(repoRoot, ".github/workflows/ci.yml"), "utf8");
const forward = readFileSync(
  join(repoRoot, "scripts/ci-dev-forward-verdict.sh"),
  "utf8",
);

const ok = (name: string) => ({ name, conclusion: "success", steps: [] });
const failed = (name: string) => ({ name, conclusion: "failure", steps: [] });
/** A `continue-on-error` job that failed: the job concludes success, a step failed. */
const tolerated = (name: string) => ({
  name,
  conclusion: "success",
  steps: [
    { name: "Set up job", conclusion: "success" },
    { name: "Run face-gate", conclusion: "failure" },
  ],
});

describe("the grade of a run", () => {
  it("is green when every job passed", () => {
    expect(classify([ok("lint-typecheck"), ok("face-gate (1/2)")]).grade).toBe(
      "green",
    );
  });

  it("is amber when only a ratchet-style gate failed, even though the job concluded success", () => {
    const got = classify([
      ok("unit-test (core)"),
      tolerated("face-gate (2/2)"),
    ]);
    expect(got.grade).toBe("amber");
    expect(got.amber).toEqual(["face-gate (2/2)"]);
    expect(got.label).toBe("\u{1F7E0} amber: face-gate (2/2)");
  });

  it("is red when a job that gates the tree failed, whatever else is amber", () => {
    const got = classify([
      failed("mod-integration (2/2)"),
      tolerated("render-gate (1/2)"),
    ]);
    expect(got.grade).toBe("red");
    expect(got.red).toEqual(["mod-integration (2/2)"]);
  });

  it("reads a hard job by its conclusion alone, since several have a step that may fail", () => {
    const job = {
      name: "mod",
      conclusion: "success",
      steps: [{ name: "Optional", conclusion: "failure" }],
    };
    expect(jobFailed(job)).toBe(false);
  });

  it("ignores a skipped or cancelled job and the verdict job itself", () => {
    expect(
      classify([
        { name: "visual (chromium)", conclusion: "skipped", steps: [] },
        { name: "e2e", conclusion: "cancelled", steps: [] },
        failed(OWN_JOB),
      ]).grade,
    ).toBe("green");
  });

  it("does not count the step that reports a culprit as a failure of the gate", () => {
    const job = {
      name: "face-gate (1/2)",
      conclusion: "success",
      steps: [{ name: "Find the commit", conclusion: "failure" }],
    };
    expect(jobFailed(job)).toBe(false);
  });

  it("fails the run on red, and on amber only where amber is not tolerated", () => {
    expect(failsRun("red", true)).toBe(true);
    expect(failsRun("amber", true)).toBe(false);
    expect(failsRun("amber", false)).toBe(true);
    expect(failsRun("green", false)).toBe(false);
  });
});

describe("the workflow", () => {
  it("tolerates amber only on a push to ci-dev, for every amber job", () => {
    const tolerant = `continue-on-error: \${{ github.event_name == 'push' && github.ref == 'refs/heads/ci-dev' }}`;
    for (const name of ["face-gate", "render-gate", "minsize-gate"]) {
      const at = ci.indexOf(`\n  ${name}:`);
      expect(at, name).toBeGreaterThan(-1);
      const next = ci.indexOf("\n  # ", at + 1);
      expect(ci.slice(at, next === -1 ? undefined : next), name).toContain(
        tolerant,
      );
    }
    expect(AMBER_JOBS).toHaveLength(3);
  });

  it("grades the run in a job that sees every other job and posts the status", () => {
    const at = ci.indexOf("\n  verdict:");
    expect(at).toBeGreaterThan(-1);
    const job = ci.slice(at);
    expect(job).toContain("if: always()");
    expect(job).toContain("statuses: write");
    expect(job).toContain("scripts/ci-verdict.mjs");
    expect(job).toContain("--tolerate-amber");
  });

  it("is forwarded by a script that refuses an amber commit", () => {
    expect(forward).toContain("ci/verdict");
    expect(forward).toContain("amber");
  });
});

describe("the forwarder in a repository", () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const dir of dirs.splice(0))
      rmSync(dir, { recursive: true, force: true });
  });

  const git = (cwd: string, ...args: string[]) =>
    execFileSync("git", args, { cwd, encoding: "utf8" }).trim();

  /**
   * A repository whose `origin/staging` is its first commit, with a middle and a head commit on top, and a `gh` that
   * answers the three calls the forwarder makes: the runs of the head, its verdict status, and each commit's hold.
   */
  const setup = (held: "none" | "middle" | "base", verdict = "") => {
    const root = mkdtempSync(join(tmpdir(), "forward-"));
    dirs.push(root);
    const work = join(root, "work");
    mkdirSync(work);
    git(work, "init", "--quiet", "-b", "main");
    git(work, "config", "user.email", "ci@example.test");
    git(work, "config", "user.name", "ci");
    const commit = (name: string) => {
      writeFileSync(join(work, name), "x\n");
      git(work, "add", ".");
      git(work, "commit", "--quiet", "-m", name);
      return git(work, "rev-parse", "HEAD");
    };
    const base = commit("base");
    git(work, "update-ref", "refs/remotes/origin/staging", base);
    const middle = commit("middle");
    const head = commit("head");
    const bin = join(root, "bin");
    mkdirSync(bin);
    const heldSha = held === "middle" ? middle : held === "base" ? base : "";
    writeFileSync(
      join(bin, "gh"),
      `#!/usr/bin/env bash
args="$*"
case "$args" in
  *actions/workflows/ci.yml/runs*)
    echo '{"total_count":1,"workflow_runs":[{"id":1,"event":"push","head_branch":"ci-dev","status":"completed","conclusion":"success"}]}'
    ;;
  *ci/verdict*) echo '${verdict}' ;;
  *ci/hold*)
    case "$args" in
      *commits/${heldSha || "none"}/*) echo 'hold: navball baselines held' ;;
    esac
    ;;
esac
`,
    );
    chmodSync(join(bin, "gh"), 0o755);
    return { work, bin, head, middle };
  };

  const run = (work: string, bin: string, sha: string) =>
    spawnSync(
      "bash",
      [join(repoRoot, "scripts/ci-dev-forward-verdict.sh"), "o/r", sha],
      {
        cwd: work,
        encoding: "utf8",
        env: { ...process.env, PATH: `${bin}:${process.env.PATH}` },
      },
    );

  it("forwards a head none of whose commits is held and whose verdict is not amber", () => {
    const { work, bin, head } = setup("none");
    expect(run(work, bin, head).status).toBe(0);
  });

  it("refuses a head that contains a held commit, and names the commit", () => {
    const { work, bin, head, middle } = setup("middle");
    const out = run(work, bin, head);
    expect(out.status).toBe(1);
    expect(out.stdout).toContain(middle);
  });

  it("does not count a commit staging already has, held or not", () => {
    const { work, bin, head } = setup("base");
    expect(run(work, bin, head).status).toBe(0);
  });

  it("refuses an amber head", () => {
    const { work, bin, head } = setup(
      "none",
      "\u{1F7E0} amber: face-gate (2/2)",
    );
    expect(run(work, bin, head).status).toBe(1);
  });
});
