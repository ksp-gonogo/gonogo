import {
  existsSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { levelOf, parseSubject } from "./commits";
import {
  fixture,
  modOnlyFixture,
  put,
  scratch,
  writePage,
} from "./uplink-fixture";
import {
  moveVersion,
  nextVersion,
  PLACEHOLDER_VERSION,
  targetVersion,
  version,
} from "./version";

afterEach(() => {
  for (const dir of scratch.splice(0))
    rmSync(dir, { recursive: true, force: true });
});

/** Every file under `dir` that still names `needle`. */
function filesNaming(dir: string, needle: string): string[] {
  const found: string[] = [];
  const walk = (at: string) => {
    for (const entry of readdirSync(at)) {
      const path = join(at, entry);
      if (statSync(path).isDirectory()) {
        walk(path);
        continue;
      }
      if (readFileSync(path, "utf8").includes(needle)) {
        found.push(path.slice(dir.length + 1));
      }
    }
  };
  walk(dir);
  return found.sort();
}

const move = (dir: string, request: Parameters<typeof moveVersion>[1]) =>
  moveVersion(dir, request, { writePage });

const STAMPED = [
  "README.md",
  "client/gonogo-uplink.json",
  "client/docs/spec.json",
  "client/package-lock.json",
  "client/package.json",
  "client/src/uplink.ts",
  "uplink.json",
].sort();

describe("stamping a version", () => {
  it("commits the placeholder in every place a release writes the version", () => {
    const dir = fixture();
    expect(filesNaming(dir, PLACEHOLDER_VERSION)).toEqual(STAMPED);
  });

  it("writes the real version over the placeholder and leaves none behind", () => {
    const dir = fixture();
    const result = move(dir, { explicit: "1.0.0-rc.5", rc: false });
    expect(result.to).toBe("1.0.0-rc.5");
    expect(filesNaming(dir, PLACEHOLDER_VERSION)).toEqual([]);
    expect(filesNaming(dir, "1.0.0-rc.5")).toEqual(STAMPED);
    expect(readFileSync(join(dir, "uplink.json"), "utf8")).toContain(
      "/demo/1.0.0-rc.5/demo.client.js",
    );
  });

  it("stamps a copy and leaves the committed Uplink as it was", () => {
    const committed = fixture();
    const release = fixture();
    move(release, { explicit: "2.0.0", rc: false });
    expect(
      readFileSync(join(release, "client/package.json"), "utf8"),
    ).toContain('"version": "2.0.0"');
    expect(
      readFileSync(join(committed, "client/package.json"), "utf8"),
    ).toContain(`"version": "${PLACEHOLDER_VERSION}"`);
  });

  it("does not write a changelog", () => {
    const dir = fixture();
    move(dir, { explicit: "1.0.0", rc: false });
    expect(existsSync(join(dir, "CHANGELOG.md"))).toBe(false);
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

  it("takes the next version from the latest release, not from the files", () => {
    const dir = fixture();
    const result = move(dir, { bump: "rc", rc: false, from: "1.0.0-rc.4" });
    expect(result.from).toBe("1.0.0-rc.4");
    expect(result.to).toBe("1.0.0-rc.5");
    expect(filesNaming(dir, "1.0.0-rc.5")).toEqual(STAMPED);
  });

  it("needs the latest release to bump from", () => {
    const dir = fixture();
    expect(() => move(dir, { bump: "rc", rc: false })).toThrow(/needs --from/);
    expect(readFileSync(join(dir, "client/package.json"), "utf8")).toContain(
      PLACEHOLDER_VERSION,
    );
  });

  it("puts every file back when the page cannot be written", () => {
    const dir = fixture();
    const before = new Map(
      filesNaming(dir, PLACEHOLDER_VERSION).map((f) => [
        f,
        readFileSync(join(dir, f), "utf8"),
      ]),
    );
    expect(() =>
      moveVersion(
        dir,
        { explicit: "1.0.0", rc: false },
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
      `const UPLINK_VERSION = "${PLACEHOLDER_VERSION}";\nconst UPLINK_VERSION = "${PLACEHOLDER_VERSION}";\n`,
    );
    expect(() => move(dir, { explicit: "1.0.0", rc: false })).toThrow(
      /exactly once/,
    );
    expect(readFileSync(join(dir, "client/package.json"), "utf8")).toContain(
      PLACEHOLDER_VERSION,
    );
  });

  it("refuses a client.url with no version folder", () => {
    const dir = fixture();
    put(
      dir,
      "uplink.json",
      '{"id":"demo","client":{"url":"https://cdn.example/demo.client.js"}}\n',
    );
    expect(() => move(dir, { explicit: "1.0.0", rc: false })).toThrow(
      /names none/,
    );
  });
});

describe("choosing the version", () => {
  it("names a version with nothing to compare it to", () => {
    expect(targetVersion({ explicit: "1.0.0", rc: false })).toBe("1.0.0");
    expect(() =>
      targetVersion({ explicit: "1.0.0", bump: "patch", rc: false }),
    ).toThrow(/name a version, or use --bump/);
  });

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

  it("decides --bump auto from the commits file", () => {
    const dir = fixture();
    const commits = join(dir, "commits.json");
    writeFileSync(commits, JSON.stringify(["feat(demo): a new camera widget"]));
    const result = move(dir, {
      bump: "auto",
      rc: false,
      commits,
      from: "1.0.0",
    });
    expect(result.to).toBe("1.1.0");
  });
});

describe("the command", () => {
  it("names the Uplink and both versions", () => {
    const dir = fixture();
    const lines: string[] = [];
    const log = console.log;
    console.log = (line: string) => lines.push(line);
    try {
      version(["--bump", "rc", "--from", "1.0.0-rc.4", "--uplink", dir], dir, {
        writePage,
      });
    } finally {
      console.log = log;
    }
    expect(lines).toEqual(["demo: 1.0.0-rc.4 -> 1.0.0-rc.5"]);
  });
});

describe("an Uplink with no client", () => {
  it("works out the version and writes nothing", () => {
    const dir = modOnlyFixture();
    const before = filesNaming(dir, "demo");
    const result = moveVersion(dir, {
      bump: "minor",
      rc: false,
      from: "1.2.3",
    });
    expect(result).toEqual({
      id: "demo",
      from: "1.2.3",
      to: "1.3.0",
      files: [],
    });
    expect(filesNaming(dir, "demo")).toEqual(before);
    expect(existsSync(join(dir, "client"))).toBe(false);
  });

  it("still refuses a version that does not sort above the last release", () => {
    const dir = modOnlyFixture();
    expect(() =>
      moveVersion(dir, { explicit: "1.0.0", rc: false, from: "1.2.3" }),
    ).toThrow(/does not sort above/);
  });

  it("names the Uplink and both versions from the command", () => {
    const dir = modOnlyFixture();
    const lines: string[] = [];
    const log = console.log;
    console.log = (line: string) => lines.push(line);
    try {
      version(["--bump", "patch", "--from", "1.0.0", "--uplink", dir], dir);
    } finally {
      console.log = log;
    }
    expect(lines).toEqual(["demo: 1.0.0 -> 1.0.1"]);
  });
});
