import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * The repo is public, so the private working notes and assistant tool config
 * stay on disk and out of git: an assistant instructions file, its twins for
 * other assistants, the tool server config and the whole `.claude/` folder.
 * `.gitignore` keeps them out of a casual `git add`; this guard catches one
 * that was forced in, at any depth.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, "..", "..", "..");

const PRIVATE_PATH =
  /(^|\/)(CLAUDE\.md|AGENTS\.md|GEMINI\.md|\.mcp\.json)$|(^|\/)\.claude\//;

const privatePaths = (paths: readonly string[]) =>
  paths.filter((p) => PRIVATE_PATH.test(p));

const trackedPaths = () =>
  execFileSync("git", ["ls-files", "-z"], {
    cwd: REPO_ROOT,
    encoding: "utf-8",
    maxBuffer: 64 * 1024 * 1024,
  })
    .split("\0")
    .filter(Boolean);

describe("private notes and tool config are untracked", () => {
  it("sees every private path shape it exists to refuse", () => {
    const planted = [
      "CLAUDE.md",
      "packages/app/CLAUDE.md",
      "AGENTS.md",
      "mod/Some/GEMINI.md",
      ".mcp.json",
      "packages/x/.mcp.json",
      ".claude/settings.json",
      "packages/x/.claude/commands/a.md",
    ];
    expect(
      privatePaths(planted),
      "The matcher no longer recognises a private path, so the tree check below would pass over a violation.",
    ).toEqual(planted);
    expect(privatePaths(["docs/CLAUDE.mdx", "src/notclaude.md"])).toEqual([]);
  });

  it("actually listed the tracked tree", () => {
    expect(trackedPaths().length).toBeGreaterThan(1000);
  });

  it("tracks none of them", () => {
    expect(
      privatePaths(trackedPaths()),
      "A private working-notes or tool-config file is tracked. The repo is public: `git rm --cached` it and keep it on disk.",
    ).toEqual([]);
  });
});
