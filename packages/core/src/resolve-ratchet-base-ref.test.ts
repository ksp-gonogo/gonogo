// @vitest-environment node
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const SCRIPT = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
  "scripts",
  "resolve-ratchet-base-ref.sh",
);

/**
 * The ci-dev branch of the base resolver, run against a throwaway clone.
 *
 * The case that broke CI: a ci-dev run is re-run after the forwarder has carried
 * its sha onto staging, so the merge base with staging is the commit under test.
 */
describe("resolve-ratchet-base-ref.sh on a ci-dev push", () => {
  let root: string;
  let origin: string;
  let work: string;
  let first: string;

  const git = (cwd: string, ...args: string[]) =>
    execFileSync("git", args, { cwd, encoding: "utf8" }).trim();

  function resolve(pushBefore: string) {
    const r = spawnSync("bash", [SCRIPT], {
      cwd: work,
      encoding: "utf8",
      env: {
        PATH: process.env.PATH,
        GITHUB_EVENT_NAME: "push",
        PUSH_BRANCH: "ci-dev",
        PUSH_BEFORE: pushBefore,
      },
    });
    return { status: r.status, stdout: r.stdout.trim(), stderr: r.stderr };
  }

  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), "resolve-base-ref-"));
    origin = join(root, "origin.git");
    work = join(root, "work");
    git(root, "init", "--bare", "-b", "staging", origin);
    git(root, "clone", origin, work);
    git(work, "config", "user.email", "t@example.com");
    git(work, "config", "user.name", "t");
    git(work, "config", "commit.gpgsign", "false");
    git(work, "checkout", "-b", "staging");
    writeFileSync(join(work, "a"), "1");
    git(work, "add", "a");
    git(work, "commit", "-m", "first");
    first = git(work, "rev-parse", "HEAD");
    git(origin, "fetch", "-q", work, "+HEAD:refs/heads/staging");
    writeFileSync(join(work, "a"), "2");
    git(work, "commit", "-am", "second");
  });

  afterAll(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("grades a fresh push against the merge base with staging", () => {
    const r = resolve(first);
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toBe(first);
  });

  it("falls back to the push's before sha once staging holds the commit", () => {
    git(origin, "fetch", "-q", work, "+HEAD:refs/heads/staging");
    const r = resolve(first);
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toBe(first);
  });

  it("still refuses when there is no usable before sha", () => {
    const r = resolve("0000000000000000000000000000000000000000");
    expect(r.status).toBe(1);
  });
});
