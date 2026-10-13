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
    expect(r.stderr).toContain("the rest on the ticket");
  });

  it("still refuses a long subject with no type, on the type", () => {
    const r = runHook(`${"a".repeat(150)}\n`);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain("no Conventional Commits type");
  });

  it("accepts a plain subject", () => {
    expect(runHook("fix(x): short\n").code).toBe(0);
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

describe(".githooks/commit-msg body", () => {
  it("refuses a one-line body and says what to do", () => {
    const r = runHook("fix(x): short\n\nThe detail, flat.\n");
    expect(r.code).toBe(1);
    expect(r.stderr).toContain("refusing a commit body");
    expect(r.stderr).toContain("put the rest on the ticket");
  });

  it("refuses a longer body", () => {
    expect(runHook("fix(x): short\n\nOne.\nTwo.\n").code).toBe(1);
  });

  it("refuses a co-author trailer", () => {
    const r = runHook("fix(x): short\n\nCo-Authored-By: A <a@b.c>\n");
    expect(r.code).toBe(1);
    expect(r.stderr).toContain("attribution trailer");
  });

  it("refuses a footer the release tooling does not read", () => {
    expect(runHook("fix(x): short\n\nReviewed-by: A\n").code).toBe(1);
  });

  it("lets the release footers through", () => {
    expect(
      runHook(
        "fix(x): short\n\nBREAKING CHANGE: the old call is gone\nRefs: #12\nFixes: #13, #14\n",
      ).code,
    ).toBe(0);
  });

  it("lets a footer name a URL", () => {
    expect(
      runHook("fix(x): short\n\nFixes: https://github.com/o/r/issues/1\n").code,
    ).toBe(0);
  });

  it("lets git's own revert body through", () => {
    expect(
      runHook(
        'Revert "fix(x): short"\n\nThis reverts commit 0123456789abcdef0123456789abcdef01234567.\n',
      ).code,
    ).toBe(0);
  });

  it("lets an amend keep the body it already had, and refuses a new one", () => {
    git(
      "commit",
      "-q",
      "--allow-empty",
      "-m",
      "fix(x): kept",
      "-m",
      "Old body.",
      "--no-verify",
    );
    expect(runHook("fix(x): kept\n\nOld body.\n").code).toBe(0);
    expect(runHook("fix(x): kept\n\nOld body.\nMore.\n").code).toBe(1);
  });
});

describe(".githooks/commit-msg tracker references", () => {
  const forms = [
    "Saga",
    "saga 911",
    "(Saga 911)",
    "Saga #911",
    "batch 2",
    "stage 5.2",
    "decision 220",
    "#123",
  ];

  for (const form of forms) {
    it(`refuses "${form}" in the subject`, () => {
      const r = runHook(`fix(x): tidy ${form}\n`);
      expect(r.code).toBe(1);
      expect(r.stderr).toContain("tracker ticket");
    });

    it(`refuses "${form}" in a footer`, () => {
      const r = runHook(`fix(x): tidy\n\nBREAKING CHANGE: ${form}\n`);
      expect(r.code).toBe(1);
      expect(r.stderr).toContain("tracker ticket");
    });
  }

  it("refuses a Refs or Fixes footer naming a private ticket", () => {
    expect(runHook("fix(x): tidy\n\nRefs: Saga 911\n").code).toBe(1);
    expect(runHook("fix(x): tidy\n\nFixes: T-12\n").code).toBe(1);
  });

  it("does not mistake ordinary words for a ticket", () => {
    expect(runHook("fix(x): stage the batch of decisions\n").code).toBe(0);
  });
});
