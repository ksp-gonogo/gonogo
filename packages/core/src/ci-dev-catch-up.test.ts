// @vitest-environment node
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const SCRIPT = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../../scripts/ci-dev-catch-up.sh",
);

/**
 * ci-dev-forward.yml refuses to forward while staging holds a commit ci-dev
 * lacks, so a commit that reaches staging some other way (a merged pull
 * request, a release commit) has to reach ci-dev too. Run against a throwaway
 * origin: ci-dev ends containing the staging commit, or is left untouched.
 */
describe("ci-dev-catch-up.sh", () => {
  let root: string;
  let work: string;

  const git = (cwd: string, ...args: string[]) =>
    execFileSync("git", args, { cwd, encoding: "utf8" }).trim();

  const commit = (file: string, text: string) => {
    writeFileSync(join(work, file), text);
    git(work, "add", file);
    git(work, "commit", "-q", "-m", `${file} ${text}`);
    return git(work, "rev-parse", "HEAD");
  };

  const remote = (branch: string) =>
    git(work, "ls-remote", "origin", `refs/heads/${branch}`).split("\t")[0];

  const catchUp = (sha: string) =>
    spawnSync("bash", [SCRIPT, sha], {
      cwd: work,
      encoding: "utf8",
      env: { PATH: process.env.PATH, HOME: root },
    });

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "ci-dev-catch-up-"));
    const origin = join(root, "origin.git");
    work = join(root, "work");
    git(root, "init", "-q", "--bare", "-b", "staging", origin);
    git(root, "clone", "-q", origin, work);
    git(work, "config", "user.email", "t@example.com");
    git(work, "config", "user.name", "t");
    git(work, "config", "commit.gpgsign", "false");
    git(work, "checkout", "-q", "-b", "staging");
    commit("a", "1");
    git(work, "push", "-q", "origin", "staging", "staging:ci-dev");
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("fast-forwards ci-dev when it has nothing staging lacks", () => {
    const merged = commit("b", "1");
    expect(catchUp(merged).status).toBe(0);
    expect(remote("ci-dev")).toBe(merged);
  });

  it("merges staging into ci-dev when ci-dev holds work of its own", () => {
    git(work, "checkout", "-q", "-b", "dev", "origin/ci-dev");
    const own = commit("c", "1");
    git(work, "push", "-q", "origin", "dev:ci-dev");
    git(work, "checkout", "-q", "staging");
    const merged = commit("b", "1");

    expect(catchUp(merged).status).toBe(0);
    git(work, "fetch", "-q", "origin");
    const head = remote("ci-dev");
    git(work, "merge-base", "--is-ancestor", merged, head);
    git(work, "merge-base", "--is-ancestor", own, head);
  });

  it("does nothing when ci-dev already contains the commit", () => {
    const before = remote("ci-dev");
    const r = catchUp(before);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("already contains");
    expect(remote("ci-dev")).toBe(before);
  });

  it("leaves ci-dev untouched and fails when the merge conflicts", () => {
    git(work, "checkout", "-q", "-b", "dev", "origin/ci-dev");
    const own = commit("a", "ci-dev side");
    git(work, "push", "-q", "origin", "dev:ci-dev");
    git(work, "checkout", "-q", "staging");
    const merged = commit("a", "staging side");

    const r = catchUp(merged);
    expect(r.status).toBe(1);
    expect(r.stdout).toContain("by hand");
    expect(remote("ci-dev")).toBe(own);
  });
});
