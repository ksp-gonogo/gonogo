// @vitest-environment node
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { rangeForTag } from "../../../scripts/release-changelog.mjs";

/**
 * The SpaceDock changelog runs from the previous stable tag to the release
 * tag. A candidate's tag is never public, so a range that started at one
 * would drop every fix that landed in it. Held against a small fixture
 * history, through the range function the changelog script itself runs.
 */

let repo: string;

const git = (...args: string[]) =>
  execFileSync("git", args, { cwd: repo, encoding: "utf8" }).trim();

const commit = (subject: string) => {
  writeFileSync(join(repo, "f.txt"), `${subject}\n${Math.random()}`);
  git("add", "-A");
  git("commit", "-q", "-m", subject);
};

beforeAll(() => {
  repo = mkdtempSync(join(tmpdir(), "changelog-range-"));
  git("init", "-q");
  git("config", "user.email", "t@example.com");
  git("config", "user.name", "t");
  git("config", "commit.gpgsign", "false");
  commit("feat(app): first release feature");
  git("tag", "v0.1.0");
  commit("fix(mod): fixed in the candidate");
  git("tag", "v0.2.0-rc.1");
  commit("feat(mod): a feature after the candidate");
  commit("ci(mod): a job tweak");
  git("tag", "v0.2.0");
}, 60_000);

afterAll(() => {
  rmSync(repo, { recursive: true, force: true });
});

const range = (tag: string) => rangeForTag(tag, repo);

describe("the changelog range", () => {
  it("starts at the previous stable tag, skipping a release candidate", () => {
    expect(range("v0.2.0")).toBe("v0.1.0..v0.2.0");
  });

  it("is the whole history before the first stable tag", () => {
    expect(range("v0.1.0")).toBe("..v0.1.0");
  });
});
