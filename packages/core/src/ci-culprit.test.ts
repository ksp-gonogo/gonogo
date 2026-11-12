// @vitest-environment node
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import {
  failingWidgets,
  search,
  widgetDirs,
} from "../../../scripts/ci-culprit.mjs";

/**
 * A gate that reports widgets is re-run for those widgets alone at the commits
 * of the push, and bisected to the first commit where they fail.
 */

const script = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../../scripts/ci-culprit.mjs",
);

describe("the widgets a gate names", () => {
  it("reads the render and minsize finding lines and nothing else", () => {
    const log = [
      "face-gate: 2 finding(s)",
      '  space-center-status @ full-6x4 (nominal): button "Upgrade" is clipped',
      '  navball @ min-3x3 (nominal): button "Go" is clipped',
      "minsize-gate: 1 widget(s) are unusable at the size",
      "  vessel-catalog  title-clipped  (new)",
      "  old-widget  clipped  (known)",
    ].join("\n");
    expect(failingWidgets(log)).toEqual([
      "space-center-status",
      "navball",
      "vessel-catalog",
    ]);
  });

  it("maps a widget id onto the folder it lives in", () => {
    expect(
      widgetDirs(
        ["space-center-status", "navball"],
        ["SpaceCenterStatus", "Navball", "CommSignal"],
      ),
    ).toEqual(["SpaceCenterStatus", "Navball"]);
  });
});

describe("the search", () => {
  it("finds the first commit where the gate fails, in log2 of the push", () => {
    const commits = ["a", "b", "c", "d", "e", "f", "g", "h"];
    const broken = new Set(["e", "f", "g", "h"]);
    const tried: string[] = [];
    const got = search(commits, (sha: string) => {
      tried.push(sha);
      return broken.has(sha);
    });
    expect(got.culprit).toBe("e");
    expect(tried.length).toBeLessThanOrEqual(3);
  });

  it("names the last commit when every earlier one passes", () => {
    expect(search(["a", "b", "c"], (sha: string) => sha === "c").culprit).toBe(
      "c",
    );
  });
});

describe("the script in a real repository", () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const dir of dirs.splice(0))
      rmSync(dir, { recursive: true, force: true });
  });

  const sh = (cwd: string, ...args: string[]) =>
    execFileSync("git", args, { cwd, encoding: "utf8" }).trim();

  it("names the commit that added what the gate refuses, and leaves the checkout on the head", () => {
    const root = mkdtempSync(join(tmpdir(), "ci-culprit-"));
    dirs.push(root);
    const origin = join(root, "origin.git");
    const work = join(root, "work");
    mkdirSync(work);
    sh(root, "init", "--bare", "--quiet", origin);
    sh(work, "init", "--quiet", "-b", "main");
    sh(work, "config", "user.email", "ci@example.test");
    sh(work, "config", "user.name", "ci");
    sh(work, "remote", "add", "origin", origin);
    const commit = (file: string, subject: string) => {
      writeFileSync(join(work, file), "x\n");
      sh(work, "add", ".");
      sh(work, "commit", "--quiet", "-m", subject);
      return sh(work, "rev-parse", "HEAD");
    };
    const base = commit("base.txt", "base");
    commit("one.txt", "one");
    const bad = commit("broken", "adds the thing the gate refuses");
    commit("three.txt", "three");
    const head = commit("four.txt", "four");
    sh(work, "push", "--quiet", "origin", "main");
    writeFileSync(join(work, "gate.log"), "");

    const out = execFileSync(
      "node",
      [
        script,
        "--log",
        "gate.log",
        "--repo",
        "o/r",
        "--before",
        base,
        "--head",
        head,
        "--command",
        "test ! -e broken",
      ],
      { cwd: work, encoding: "utf8" },
    );
    expect(out).toContain(`culprit: ${bad.slice(0, 7)} adds the thing`);
    expect(sh(work, "rev-parse", "HEAD")).toBe(head);
  });
});
