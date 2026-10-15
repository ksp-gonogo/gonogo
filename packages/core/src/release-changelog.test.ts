// @vitest-environment node
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  capChangelog,
  skippedIds,
} from "../../../scripts/release-changelog.mjs";

/**
 * The release changelog is built from commit subjects. What holds here: a
 * revert drops itself and the commits it undid, a reland survives once, a
 * subject that landed twice shows once, no changelog crosses a workflow in an
 * environment variable, and the GitHub Release body is that same changelog.
 */

const ROOT = join(__dirname, "../../..");
const read = (path: string) => readFileSync(join(ROOT, path), "utf8");

const sha = (n: number) => n.toString(16).padEnd(40, "0");
const commit = (n: number, subject: string, body = "") => ({
  id: sha(n),
  subject,
  body,
});

describe("skippedIds", () => {
  it("drops a revert and the commits its body names by sha", () => {
    const commits = [
      commit(0xaaa1111, "fix(app): one"),
      commit(0xaaa2222, "fix(app): two"),
      commit(0xbbb3333, "revert: one and 1 more", "reverts aaa1111, aaa2222."),
      commit(0xccc4444, "fix(app): three"),
    ];
    const skipped = skippedIds(commits);
    expect([...skipped].sort()).toEqual(
      [commits[0].id, commits[1].id, commits[2].id].sort(),
    );
  });

  it("keeps a reland once, after the original and its revert are dropped", () => {
    const commits = [
      commit(0xaaa1111, "feat(app): a thing"),
      commit(0xbbb2222, "revert: a thing", "reverts aaa1111."),
      commit(0xccc3333, "feat(app): a thing"),
    ];
    const skipped = skippedIds(commits);
    expect(skipped.has(commits[0].id)).toBe(true);
    expect(skipped.has(commits[1].id)).toBe(true);
    expect(skipped.has(commits[2].id)).toBe(false);
  });

  it("pairs a revert that names no sha with the earlier commit of that description", () => {
    const commits = [
      commit(0xaaa1111, "fix(app): the gauge reads feet"),
      commit(0xbbb2222, "fix(app): other"),
      commit(0xccc3333, "revert: the gauge reads feet"),
    ];
    const skipped = skippedIds(commits);
    expect(skipped.has(commits[0].id)).toBe(true);
    expect(skipped.has(commits[1].id)).toBe(false);
  });

  it("shows an identical subject once, as its newest commit", () => {
    const commits = [
      commit(0xaaa1111, "fix(app): same"),
      commit(0xbbb2222, "fix(app): same"),
    ];
    const skipped = skippedIds(commits);
    expect(skipped.has(commits[0].id)).toBe(true);
    expect(skipped.has(commits[1].id)).toBe(false);
  });
});

describe("capChangelog", () => {
  const long = `**Features**\n${Array.from({ length: 500 }, (_, i) => `- Change number ${i} (abc1234)`).join("\n")}\n`;

  it("leaves a changelog under the cap untouched", () => {
    expect(capChangelog("- one\n", 1000, "https://x")).toBe("- one\n");
  });

  it("cuts at a line and ends with the link, inside the cap", () => {
    const out = capChangelog(long, 2000, "https://example.test/full");
    expect(Buffer.byteLength(out)).toBeLessThanOrEqual(2000);
    expect(out).toMatch(
      /more changes\. Full changelog: https:\/\/example\.test\/full\n$/,
    );
    expect(
      out
        .split("\n")
        .every(
          (l) =>
            l === "" ||
            l.startsWith("**") ||
            l.startsWith("- ") ||
            l.startsWith("...and"),
        ),
    ).toBe(true);
  });
});

describe("cliff.toml", () => {
  const toml = read("cliff.toml");

  it("filters commits and skips the types a player does not read", () => {
    expect(toml).toMatch(/^filter_commits = true$/m);
    expect(toml).toMatch(/^filter_unconventional = true$/m);
    const skip = toml.match(/message = "\^\(([^)]*)\)[^"]*", skip = true/);
    expect(skip?.[1].split("|").sort()).toEqual(
      ["build", "chore", "ci", "refactor", "revert", "style", "test"].sort(),
    );
  });
});

describe("the workflows that publish the changelog", () => {
  const build = read(".github/workflows/_build-uplink-mod.yml");
  const release = read(".github/workflows/release.yml");

  it("never pass a changelog through an environment variable", () => {
    expect(build).not.toMatch(/git-cliff-action/);
    expect(build).not.toMatch(/steps\.git-cliff\.outputs\.content/);
    expect(build).not.toMatch(/CLIFF_CHANGELOG/);
  });

  it("cap the SpaceDock changelog in a file, linking the full one", () => {
    expect(build).toMatch(
      /release-changelog\.mjs --from sd-filtered\.md --out sd-changelog\.md --max-bytes \d+ --link/,
    );
  });

  it("build the GitHub Release notes from the same script", () => {
    expect(release).not.toMatch(/--generate-notes/);
    expect(release).toMatch(
      /release-changelog\.mjs --out release-notes\.md --tag/,
    );
    expect(release).toMatch(/--notes-file release-notes\.md/);
  });
});
