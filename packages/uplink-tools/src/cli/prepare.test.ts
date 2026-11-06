import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { prepareRelease } from "./prepare";
import { fixture, put, scratch, writePage } from "./uplink-fixture";

afterEach(() => {
  for (const dir of scratch.splice(0))
    rmSync(dir, { recursive: true, force: true });
});

const git = (cwd: string, ...args: string[]) =>
  execFileSync("git", args, { cwd, encoding: "utf8" }).trim();

/** The fixture Uplink as a committed repository whose origin is a bare one beside it. */
function repo(version = "1.0.0-rc.4") {
  const dir = fixture(version);
  const origin = mkdtempSync(join(tmpdir(), "gonogo-origin-"));
  scratch.push(origin);
  git(origin, "init", "-q", "--bare", "-b", "main");
  git(dir, "init", "-q", "-b", "main");
  git(dir, "config", "user.email", "t@example.com");
  git(dir, "config", "user.name", "t");
  git(dir, "add", "-A");
  git(dir, "commit", "-q", "-m", "chore: seed");
  git(dir, "remote", "add", "origin", origin);
  return { dir, origin };
}

/** `run` answering every command with 0, except the ones named, and remembering what was asked. */
function runner(failing: string[] = []) {
  const asked: string[] = [];
  return {
    asked,
    run: async (argv: readonly string[]) => {
      asked.push(argv.join(" "));
      return failing.includes(argv[0]) ? 1 : 0;
    },
  };
}

const deps = (r: ReturnType<typeof runner>, tests = true) => ({
  run: r.run,
  runTests: () => tests,
  writePage,
  today: () => "2026-10-24",
});

describe("release prepare", () => {
  it("commits the release and tags it after every check", async () => {
    const { dir } = repo();
    const r = runner();
    const result = await prepareRelease(
      ["--bump", "rc", "--tag"],
      deps(r),
      dir,
    );
    expect(result).toMatchObject({ id: "demo", version: "1.0.0-rc.5" });
    expect(r.asked.map((a) => a.split(" ")[0])).toEqual([
      "codegen",
      "check",
      "docs",
      "release",
    ]);
    expect(r.asked.at(-1)).toMatch(/^release --out /);
    expect(git(dir, "log", "-1", "--format=%s")).toBe(
      "release: demo v1.0.0-rc.5",
    );
    expect(git(dir, "rev-parse", "demo-v1.0.0-rc.5")).toBe(
      git(dir, "rev-parse", "HEAD"),
    );
    expect(git(dir, "status", "--porcelain")).toBe("");
  });

  it("makes no commit and no tag, and restores the files, when a check fails", async () => {
    const { dir } = repo();
    const before = readFileSync(join(dir, "client/package.json"), "utf8");
    for (const failing of ["codegen", "check", "docs", "release"]) {
      const r = runner([failing]);
      await expect(
        prepareRelease(["--bump", "rc", "--tag"], deps(r), dir),
      ).rejects.toThrow(/was not made/);
      expect(git(dir, "status", "--porcelain")).toBe("");
      expect(git(dir, "tag", "--list")).toBe("");
      expect(git(dir, "rev-list", "--count", "HEAD")).toBe("1");
    }
    expect(readFileSync(join(dir, "client/package.json"), "utf8")).toBe(before);
    const failedTests = runner();
    await expect(
      prepareRelease(["--bump", "rc"], deps(failedTests, false), dir),
    ).rejects.toThrow(/tests failed/);
    expect(git(dir, "status", "--porcelain")).toBe("");
  });

  it("removes a changelog the failed attempt created", async () => {
    const { dir } = repo();
    const commits = join(dir, "..", "commits.json");
    put(dir, "../commits.json", JSON.stringify(["fix(demo): a fix"]));
    await expect(
      prepareRelease(
        ["--bump", "auto", "--rc", "--commits", commits],
        deps(runner(["check"])),
        dir,
      ),
    ).rejects.toThrow(/was not made/);
    expect(existsSync(join(dir, "CHANGELOG.md"))).toBe(false);
  });

  it("refuses a dirty tree before writing anything", async () => {
    const { dir } = repo();
    put(dir, "stray.txt", "x");
    const r = runner();
    await expect(
      prepareRelease(["--bump", "rc"], deps(r), dir),
    ).rejects.toThrow(/not clean/);
    expect(r.asked).toEqual([]);
  });

  it("refuses a tag already spent here or on origin", async () => {
    const { dir } = repo();
    git(dir, "tag", "demo-v1.0.0-rc.5");
    await expect(
      prepareRelease(["--bump", "rc"], deps(runner()), dir),
    ).rejects.toThrow(/already exists here/);
    git(dir, "tag", "-d", "demo-v1.0.0-rc.5");

    const other = repo();
    git(other.dir, "tag", "demo-v1.0.0-rc.5");
    git(other.dir, "push", "-q", "origin", "demo-v1.0.0-rc.5");
    git(other.dir, "tag", "-d", "demo-v1.0.0-rc.5");
    await expect(
      prepareRelease(["--bump", "rc"], deps(runner()), other.dir),
    ).rejects.toThrow(/already exists on origin/);
  });

  it("pushes the branch and the tag together only when asked", async () => {
    const { dir, origin } = repo();
    await prepareRelease(["--bump", "rc", "--tag"], deps(runner()), dir);
    expect(git(origin, "tag", "--list")).toBe("");

    await prepareRelease(
      ["--bump", "rc", "--tag", "--push"],
      deps(runner()),
      dir,
    );
    expect(git(origin, "tag", "--list")).toBe("demo-v1.0.0-rc.6");
    expect(git(origin, "rev-parse", "main")).toBe(
      git(dir, "rev-parse", "HEAD"),
    );
    await expect(
      prepareRelease(["--bump", "rc", "--push"], deps(runner()), dir),
    ).rejects.toThrow(/needs --tag/);
  });

  it("writes the Uplink's changelog into the release commit", async () => {
    const { dir } = repo("1.0.0");
    const commits = join(dir, "..", "commits.json");
    put(dir, "../commits.json", JSON.stringify(["feat(demo): a new widget"]));
    const result = await prepareRelease(
      ["--bump", "auto", "--commits", commits],
      deps(runner()),
      dir,
    );
    expect(result.version).toBe("1.1.0");
    expect(git(dir, "show", "HEAD:CHANGELOG.md")).toContain(
      "## 1.1.0 (2026-10-24)\n\n### Features\n\n- a new widget",
    );
  });
});

describe("release prepare with a client the plugin vouches for", () => {
  it("bundles and bakes the moved client before it is checked", async () => {
    const { dir } = repo();
    const declaration = JSON.parse(
      readFileSync(join(dir, "uplink.json"), "utf8"),
    );
    put(
      dir,
      "uplink.json",
      `${JSON.stringify({ ...declaration, gamedata: "GonogoDemoUplink" }, null, 2)}\n`,
    );
    git(dir, "commit", "-q", "-am", "chore: declare a plugin");
    const r = runner();
    await prepareRelease(["--bump", "rc"], deps(r), dir);
    expect(r.asked.map((a) => a.split(" ")[0])).toEqual([
      "codegen",
      "bundle",
      "bake",
      "check",
      "docs",
      "release",
    ]);
  });
});
