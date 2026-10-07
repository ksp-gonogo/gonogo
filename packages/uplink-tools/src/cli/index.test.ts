import { execFileSync, spawn } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

/**
 * `bake-hash` is exercised through the BIN, not the exported function, because
 * the bin is what an author's release script calls and what a template's
 * getting-started names. A test that imports `run` would pass with a broken
 * shim, an absent `bin` entry, or a dist that does not load.
 */
const BIN = join(import.meta.dirname, "../../bin/uplink-tools.mjs");
const scratch: string[] = [];
const workdir = () => {
  const dir = mkdtempSync(join(tmpdir(), "gonogo-cli-"));
  scratch.push(dir);
  return dir;
};

afterEach(() => {
  for (const dir of scratch.splice(0))
    rmSync(dir, { recursive: true, force: true });
});

describe("uplink-tools bake-hash", () => {
  it("writes the bundle's sha256 into a C# const the mod can vouch with", () => {
    const dir = workdir();
    const bundle = join(dir, "x.client.js");
    writeFileSync(bundle, "export const marker = 1;\n");
    const out = join(dir, "ExpectedClientHash.g.cs");

    execFileSync(process.execPath, [
      BIN,
      "bake-hash",
      "--bundle",
      bundle,
      "--out",
      out,
      "--namespace",
      "Gonogo.X",
    ]);

    const written = readFileSync(out, "utf8");
    expect(written).toContain("namespace Gonogo.X");
    // The value the loader compares against, so its SHAPE is the contract: an `sha256-<64 hex>` it can match, never a bare digest or an empty string.
    expect(written).toMatch(
      /public const string Value = "sha256-[0-9a-f]{64}";/,
    );
  });

  it("refuses a bundle that does not exist rather than baking a hash of nothing", () => {
    const dir = workdir();
    expect(() =>
      execFileSync(
        process.execPath,
        [
          BIN,
          "bake-hash",
          "--bundle",
          join(dir, "absent.js"),
          "--out",
          join(dir, "out.cs"),
          "--namespace",
          "Gonogo.X",
        ],
        { stdio: "pipe" },
      ),
    ).toThrow();
  });
});

const runBin = (args: readonly string[], cwd?: string) => {
  try {
    const stdout = execFileSync(process.execPath, [BIN, ...args], {
      cwd,
      encoding: "utf8",
      stdio: "pipe",
    });
    return { code: 0, out: stdout };
  } catch (err) {
    const field = (key: string) =>
      String(
        (typeof err === "object" && err !== null
          ? Reflect.get(err, key)
          : "") ?? "",
      );
    return {
      code: Number(field("status")) || 1,
      out: `${field("stdout")}${field("stderr")}`,
    };
  }
};

describe("the top-level help", () => {
  it("names every command and how to run one without an install", () => {
    const { code, out } = runBin(["--help"]);
    expect(code).toBe(0);
    for (const verb of ["new", "bundle", "bake-hash", "render", "docs"]) {
      expect(out).toMatch(new RegExp(`^  ${verb} `, "m"));
    }
    expect(out).toContain("npx @ksp-gonogo/uplink-tools <command>");
  });

  it("refuses a command it does not have", () => {
    const { code, out } = runBin(["publish"]);
    expect(code).toBe(1);
    expect(out).toContain('unknown command "publish"');
  });
});

/**
 * The top-level help says "Run a command with --help for its options", so every
 * command must print its own options rather than run, and must not reach its
 * flag parser with `--help` as an unknown flag.
 */
describe("every command answers --help", () => {
  for (const verb of ["new", "bundle", "bake-hash", "render", "docs"]) {
    it(`${verb} prints its own options rather than running`, () => {
      const { code, out } = runBin([verb, "--help"]);
      expect(code).toBe(0);
      expect(out).toContain(`uplink-tools ${verb}`);
      expect(out).toContain("--");
    });
  }
});

/**
 * A flag that belongs to another command is the likeliest typo there is, and a
 * command that ignored it would run and quietly do something else.
 */
describe("every command refuses a flag it does not read", () => {
  const cases: ReadonlyArray<[string, string[]]> = [
    ["new", ["new", "fresh", "--scene", "x"]],
    ["bundle", ["bundle", "--check"]],
    ["bake-hash", ["bake-hash", "--watch"]],
    ["render", ["render", "--check"]],
    ["docs", ["docs", "--scene", "x"]],
  ];
  for (const [verb, args] of cases) {
    it(verb, () => {
      const dir = workdir();
      const { code, out } = runBin(args, dir);
      expect(code).toBe(1);
      expect(out).toMatch(/is not an option of|only applies to/);
      expect(out).toContain(`uplink-tools ${verb}`);
    });
  }
});

/**
 * `bundle --watch` keeps one esbuild context alive and reports each outcome in
 * `watch-status.json` beside the bundle, which is what the app's dev server
 * reads to say "waiting", "built" or "failed" without parsing a log.
 */
describe("uplink-tools bundle --watch", () => {
  const children: Array<ReturnType<typeof spawn>> = [];
  afterEach(() => {
    for (const child of children.splice(0)) child.kill("SIGKILL");
  });

  const client = (source: string) => {
    const dir = workdir();
    writeFileSync(
      join(dir, "uplink.json"),
      JSON.stringify({
        id: "fixture",
        name: "Fixture",
        author: "someone",
        repo: "https://example.invalid/fixture",
        minAppVersion: "0.0.0",
      }),
    );
    writeFileSync(
      join(dir, "package.json"),
      JSON.stringify({ name: "fixture-client", version: "1.2.3" }),
    );
    mkdirSync(join(dir, "src"));
    writeFileSync(join(dir, "src", "index.ts"), source);
    return dir;
  };

  const statusPath = (dir: string) =>
    join(dir, "dist", "fixture", "watch-status.json");
  const bundlePath = (dir: string) =>
    join(dir, "dist", "fixture", "fixture.client.js");
  const stringField = (record: object, key: string): string | null => {
    const value: unknown = Reflect.get(record, key);
    return typeof value === "string" ? value : null;
  };
  const readStatus = (dir: string) => {
    try {
      const parsed: unknown = JSON.parse(readFileSync(statusPath(dir), "utf8"));
      if (typeof parsed !== "object" || parsed === null) return undefined;
      return {
        state: stringField(parsed, "state") ?? "",
        builtAt: stringField(parsed, "builtAt"),
        integrity: stringField(parsed, "integrity"),
        error: stringField(parsed, "error"),
      };
    } catch {
      return undefined;
    }
  };
  const until = async <Reading>(
    read: () => Reading | undefined,
  ): Promise<Reading> => {
    const deadline = Date.now() + 15_000;
    for (;;) {
      const value = read();
      if (value !== undefined) return value;
      if (Date.now() > deadline) throw new Error("timed out waiting");
      await new Promise((r) => setTimeout(r, 50));
    }
  };

  const watch = (dir: string) => {
    const child = spawn(
      process.execPath,
      [BIN, "bundle", "--watch", "--client", dir],
      {
        stdio: "pipe",
      },
    );
    children.push(child);
    return child;
  };

  it("rebuilds on an edit, and says failed with the old bundle intact when the source breaks", async () => {
    const dir = client("export const marker = 'one';\n");
    const child = watch(dir);

    const first = await until(() => {
      const status = readStatus(dir);
      return status?.state === "built" ? status : undefined;
    });
    expect(first.integrity).toMatch(/^sha256-[0-9a-f]{64}$/);
    const firstBytes = readFileSync(bundlePath(dir), "utf8");
    expect(firstBytes).toContain("one");

    writeFileSync(
      join(dir, "src", "index.ts"),
      "export const marker = 'two';\n",
    );
    const second = await until(() => {
      const status = readStatus(dir);
      return status?.state === "built" && status.integrity !== first.integrity
        ? status
        : undefined;
    });
    const secondBytes = readFileSync(bundlePath(dir), "utf8");
    expect(secondBytes).toContain("two");
    expect(readFileSync(`${bundlePath(dir)}.sha256`, "utf8").trim()).toBe(
      second.integrity,
    );
    expect(
      JSON.parse(
        readFileSync(
          join(dir, "dist", "fixture", "gonogo-uplink.json"),
          "utf8",
        ),
      ).integrity,
    ).toBe(second.integrity);

    writeFileSync(join(dir, "src", "index.ts"), "export const marker = ;\n");
    const failed = await until(() => {
      const status = readStatus(dir);
      return status?.state === "failed" ? status : undefined;
    });
    expect(failed.error).toBeTruthy();
    expect(failed.error).not.toContain("\n");
    expect(readFileSync(bundlePath(dir), "utf8")).toBe(secondBytes);

    const exited = new Promise<number | null>((resolveExit) =>
      child.once("exit", (code) => resolveExit(code)),
    );
    child.kill("SIGINT");
    expect(await exited).toBe(0);
  }, 30_000);

  it("reads waiting before the first build has finished", async () => {
    const dir = client("export const marker = 'one';\n");
    mkdirSync(join(dir, "dist", "fixture"), { recursive: true });
    watch(dir);
    const status = await until(() => readStatus(dir));
    expect(["waiting", "built"]).toContain(status.state);
    expect(existsSync(statusPath(dir))).toBe(true);
  }, 30_000);
});
