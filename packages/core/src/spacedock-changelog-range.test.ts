// @vitest-environment node
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * The SpaceDock changelog runs from the previous STABLE tag to the release
 * tag. A candidate's tag is never public, so a range that started at one
 * would drop every fix that landed in it. Held against a small fixture
 * history rather than the workflow text, with the workflow's own range
 * command read back out of the file so the two cannot drift. The saved
 * cliff-output.md is git-cliff's own output for that history.
 */

const ROOT = join(__dirname, "../../..");
const BUILD = readFileSync(
  join(ROOT, ".github/workflows/_build-uplink-mod.yml"),
  "utf8",
);

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

function range(tag: string): string {
  const line = BUILD.split("\n").find((l) => l.includes("--merged"));
  const grep = BUILD.split("\n").find((l) => l.includes("grep -E '^v"));
  expect(line).toBeTruthy();
  const script = `TAG=${tag}\nPREV_STABLE="$(git tag --sort=-creatordate --merged "\${TAG}^" ${(
    grep ?? ""
  )
    .trim()
    .replace(/\)"$/, "")
    .replace(/ \|\| true$/, "")} || true)"\necho "$PREV_STABLE"`;
  return execFileSync("bash", ["-c", script], {
    cwd: repo,
    encoding: "utf8",
  }).trim();
}

describe("the changelog range", () => {
  it("starts at the previous stable tag, skipping a release candidate", () => {
    expect(range("v0.2.0")).toBe("v0.1.0");
  });

  it("is empty before the first stable tag", () => {
    expect(range("v0.1.0")).toBe("");
  });
});

describe("the player text from git-cliff's real output for the fixture history", () => {
  it("keeps the candidate's fix and the later feature, and leaves CI and docs out", () => {
    const cliff = readFileSync(
      join(ROOT, "scripts/__fixtures__/cliff-output.md"),
      "utf8",
    );
    const text = execFileSync(
      "python3",
      [join(ROOT, "scripts/spacedock-changelog.py")],
      { input: cliff, encoding: "utf8" },
    );
    expect(text).toContain("**Features**\n\n- A feature after the candidate");
    expect(text).toContain("**Bug Fixes**\n\n- Fixed in the candidate");
    expect(text).not.toContain("job tweak");
    expect(text).not.toContain("Reword a page");
    expect(text).toContain("Other changes: CI, Documentation");
  });
});
