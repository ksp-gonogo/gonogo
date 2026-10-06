import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const HOOK = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
  ".githooks",
  "commit-msg",
);

let repo: string;

const git = (...args: string[]) =>
  spawnSync("git", args, { cwd: repo, encoding: "utf8" });

function runHook(message: string) {
  const file = join(repo, "MSG");
  writeFileSync(file, message);
  const r = spawnSync("bash", [HOOK, file], { cwd: repo, encoding: "utf8" });
  return { code: r.status, stderr: r.stderr };
}

const subjectOf = (length: number) => {
  const prefix = "fix(x): ";
  return prefix + "a".repeat(length - prefix.length);
};

beforeAll(() => {
  repo = mkdtempSync(join(tmpdir(), "commit-msg-hook-"));
  git("init", "-q", "-b", "main");
  git("config", "user.email", "a@b.c");
  git("config", "user.name", "a");
  git("config", "core.hooksPath", "/nonexistent");
});

afterAll(() => rmSync(repo, { recursive: true, force: true }));

describe(".githooks/commit-msg subject length", () => {
  it("accepts a 100-character subject", () => {
    expect(runHook(`${subjectOf(100)}\n`).code).toBe(0);
  });

  it("refuses a 101-character subject and names the limit and the way out", () => {
    const r = runHook(`${subjectOf(101)}\n`);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain("101 characters");
    expect(r.stderr).toContain("limit is 100");
    expect(r.stderr).toContain("one-line body");
  });

  it("still refuses a long subject with no type, on the type", () => {
    const r = runHook(`${"a".repeat(150)}\n`);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain("no Conventional Commits type");
  });

  it("accepts a short subject with a one-line body", () => {
    expect(runHook("fix(x): short\n\nThe detail, flat.\n").code).toBe(0);
  });

  it("still refuses a two-line body", () => {
    const r = runHook("fix(x): short\n\nOne.\nTwo.\n");
    expect(r.code).toBe(1);
    expect(r.stderr).toContain("body of 2 lines");
  });

  it("leaves a git-written merge or revert subject alone", () => {
    expect(runHook(`Revert "${subjectOf(150)}"\n`).code).toBe(0);
    expect(
      runHook(`Merge remote-tracking branch '${"a".repeat(150)}'\n`).code,
    ).toBe(0);
  });

  it("lets an existing long subject through when it is carried over unchanged", () => {
    const long = subjectOf(160);
    git("commit", "-q", "--allow-empty", "-m", long, "--no-verify");
    expect(runHook(`${long}\n`).code).toBe(0);
    expect(runHook(`${subjectOf(161)}\n`).code).toBe(1);
  });
});
