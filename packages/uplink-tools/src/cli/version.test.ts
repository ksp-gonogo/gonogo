import {
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { levelOf, parseSubject, prependSection } from "./commits";
import { fixture, put, scratch, writePage } from "./uplink-fixture";
import { moveVersion, nextVersion, version } from "./version";

afterEach(() => {
  for (const dir of scratch.splice(0))
    rmSync(dir, { recursive: true, force: true });
});

/** Every file under `dir` that still names `needle`, apart from the changelog, which names past versions on purpose. */
function filesNaming(dir: string, needle: string): string[] {
  const found: string[] = [];
  const walk = (at: string) => {
    for (const entry of readdirSync(at)) {
      const path = join(at, entry);
      if (statSync(path).isDirectory()) {
        walk(path);
        continue;
      }
      if (entry === "CHANGELOG.md") continue;
      if (readFileSync(path, "utf8").includes(needle)) {
        found.push(path.slice(dir.length + 1));
      }
    }
  };
  walk(dir);
  return found.sort();
}

const move = (dir: string, request: Parameters<typeof moveVersion>[1]) =>
  moveVersion(dir, request, { writePage, today: () => "2026-10-24" });

describe("moving a version", () => {
  it("leaves no file of the Uplink naming the old version", () => {
    const dir = fixture();
    expect(filesNaming(dir, "1.0.0-rc.4").length).toBe(7);
    const result = move(dir, { bump: "rc", rc: false });
    expect(result.to).toBe("1.0.0-rc.5");
    expect(filesNaming(dir, "1.0.0-rc.4")).toEqual([]);
    expect(filesNaming(dir, "1.0.0-rc.5")).toEqual(
      [
        "README.md",
        "client/gonogo-uplink.json",
        "client/docs/spec.json",
        "client/package-lock.json",
        "client/package.json",
        "client/src/uplink.ts",
        "uplink.json",
      ].sort(),
    );
    expect(readFileSync(join(dir, "uplink.json"), "utf8")).toContain(
      "/demo/1.0.0-rc.5/demo.client.js",
    );
  });

  it("keeps the lockfile's two version lines and its indentation", () => {
    const dir = fixture();
    move(dir, { explicit: "1.0.0", rc: false });
    const lock = JSON.parse(
      readFileSync(join(dir, "client/package-lock.json"), "utf8"),
    );
    expect(lock.version).toBe("1.0.0");
    expect(lock.packages[""].version).toBe("1.0.0");
    expect(readFileSync(join(dir, "client/package.json"), "utf8")).toMatch(
      /^{\n {2}"name"/,
    );
  });

  it("puts every file back when the page cannot be written", () => {
    const dir = fixture();
    const before = new Map(
      filesNaming(dir, "1.0.0-rc.4").map((f) => [
        f,
        readFileSync(join(dir, f), "utf8"),
      ]),
    );
    expect(() =>
      moveVersion(
        dir,
        { bump: "rc", rc: false },
        {
          writePage: (client) => {
            put(client, "gonogo-uplink.json", "half");
            throw new Error("the page check failed");
          },
        },
      ),
    ).toThrow("the page check failed");
    for (const [file, text] of before) {
      expect(readFileSync(join(dir, file), "utf8")).toBe(text);
    }
  });

  it("refuses a source that does not declare the version exactly once", () => {
    const dir = fixture();
    put(
      dir,
      "client/src/uplink.ts",
      'const UPLINK_VERSION = "1.0.0-rc.4";\nconst UPLINK_VERSION = "1.0.0-rc.4";\n',
    );
    expect(() => move(dir, { bump: "rc", rc: false })).toThrow(/exactly once/);
    expect(readFileSync(join(dir, "client/package.json"), "utf8")).toContain(
      "1.0.0-rc.4",
    );
  });

  it("refuses a client.url with no version folder", () => {
    const dir = fixture();
    put(
      dir,
      "uplink.json",
      '{"id":"demo","client":{"url":"https://cdn.example/demo.client.js"}}\n',
    );
    expect(() => move(dir, { bump: "rc", rc: false })).toThrow(/names none/);
  });
});

describe("choosing the next version", () => {
  it("steps a candidate", () => {
    expect(nextVersion("1.0.0-rc.4", { bump: "rc", rc: false })).toBe(
      "1.0.0-rc.5",
    );
  });

  it("promotes a candidate only by naming its release", () => {
    expect(nextVersion("1.0.0-rc.4", { explicit: "1.0.0", rc: false })).toBe(
      "1.0.0",
    );
    expect(() =>
      nextVersion("1.0.0-rc.4", { bump: "minor", rc: false }),
    ).toThrow(/candidate for 1.0.0/);
  });

  it("needs a target for the first candidate of a full release", () => {
    expect(() => nextVersion("1.0.0", { bump: "rc", rc: false })).toThrow(
      /full release/,
    );
    expect(nextVersion("1.0.0", { bump: "minor", rc: true })).toBe(
      "1.1.0-rc.1",
    );
  });

  it("refuses a version that does not sort above the current one", () => {
    expect(() =>
      nextVersion("1.0.0", { explicit: "1.0.0-rc.9", rc: false }),
    ).toThrow(/does not sort above/);
    expect(() =>
      nextVersion("1.0.0-rc.4", { explicit: "1.0.0-rc.4", rc: false }),
    ).toThrow(/does not sort above/);
  });

  it("takes the bump from the commits", () => {
    expect(
      nextVersion("1.2.3", { bump: "auto", rc: false, level: "minor" }),
    ).toBe("1.3.0");
    expect(
      nextVersion("1.2.3", { bump: "auto", rc: true, level: "major" }),
    ).toBe("2.0.0-rc.1");
    expect(
      nextVersion("1.2.3", { bump: "auto", rc: false, level: "patch" }),
    ).toBe("1.2.4");
    expect(() => nextVersion("1.2.3", { bump: "auto", rc: false })).toThrow(
      /nothing in the commits/,
    );
  });
});

describe("the commits of one Uplink", () => {
  it("reads a Conventional Commit subject", () => {
    expect(parseSubject("feat(demo)!: a widget")).toEqual({
      type: "feat",
      scope: "demo",
      description: "a widget",
      breaking: true,
    });
    expect(parseSubject("tidy things")).toBeUndefined();
  });

  it("calls a bump only for what reaches a player", () => {
    const change = (s: string) => parseSubject(s) ?? expect.fail(s);
    expect(
      levelOf([change("docs: words"), change("chore: x")]),
    ).toBeUndefined();
    expect(levelOf([change("fix: a"), change("perf: b")])).toBe("patch");
    expect(levelOf([change("fix: a"), change("feat: b")])).toBe("minor");
    expect(levelOf([change("fix!: a")])).toBe("major");
  });

  it("writes the version's section, newest first", () => {
    const dir = fixture("1.0.0");
    const commits = join(dir, "commits.json");
    writeFileSync(
      commits,
      JSON.stringify([
        "feat(demo): a new camera widget",
        { subject: "fix(demo): the feed no longer drops", breaking: true },
        "docs(demo): reword",
      ]),
    );
    const result = move(dir, { bump: "auto", rc: false, commits });
    expect(result.to).toBe("2.0.0");
    move(dir, { explicit: "2.0.1", rc: false, commits });
    const log = readFileSync(join(dir, "CHANGELOG.md"), "utf8");
    expect(log.startsWith("# Changelog\n\n## 2.0.1 (2026-10-24)")).toBe(true);
    expect(log).toContain("### Breaking changes\n\n- the feed no longer drops");
    expect(log).toContain("### Features\n\n- a new camera widget");
    expect(log).not.toContain("reword");
    expect(log.indexOf("## 2.0.1")).toBeLessThan(log.indexOf("## 2.0.0"));
  });
});

describe("the changelog file", () => {
  it("holds one section for a version however often it is written", () => {
    const dir = fixture();
    prependSection(dir, "1.0.0", "## 1.0.0 (2026-10-01)\n\n- a\n\n");
    prependSection(dir, "1.0.1", "## 1.0.1 (2026-10-02)\n\n- b\n\n");
    prependSection(dir, "1.0.1", "## 1.0.1 (2026-10-03)\n\n- c\n\n");
    const log = readFileSync(join(dir, "CHANGELOG.md"), "utf8");
    expect(log.match(/## 1\.0\.1/g)).toHaveLength(1);
    expect(log).toContain("- c");
    expect(log).not.toContain("- b");
    expect(log).toContain("## 1.0.0 (2026-10-01)");
  });
});

describe("the command", () => {
  it("names the Uplink and both versions", () => {
    const dir = fixture();
    const lines: string[] = [];
    const log = console.log;
    console.log = (line: string) => lines.push(line);
    try {
      version(["--bump", "rc", "--uplink", dir], dir, { writePage });
    } finally {
      console.log = log;
    }
    expect(lines).toEqual(["demo: 1.0.0-rc.4 -> 1.0.0-rc.5"]);
  });
});
