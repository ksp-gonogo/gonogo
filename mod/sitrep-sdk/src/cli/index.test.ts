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
const BIN = join(import.meta.dirname, "../../bin/gonogo-uplink.mjs");
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

describe("gonogo-uplink bake-hash", () => {
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

/**
 * The top-level help says "Run a command with --help for its options", and for
 * a while no command honoured it: `bundle --help` started a build and
 * `render --help` came back with `unknown flag "--help"`, which is the tool
 * refusing what its own help had just told the author to type.
 */
describe("every command answers --help", () => {
  for (const verb of ["bundle", "bake-hash"]) {
    it(`${verb} prints its options rather than running`, () => {
      const out = execFileSync(process.execPath, [BIN, verb, "--help"], {
        stdio: "pipe",
        encoding: "utf8",
      });
      expect(out).toContain(`gonogo-uplink ${verb}`);
      expect(out).toContain("--");
    });
  }
});

/**
 * The browser verbs are forwarded to `@ksp-gonogo/uplink-tools`, and WHOSE copy
 * of it is the whole question.
 *
 * A bare `await import("@ksp-gonogo/uplink-tools")` inside this package resolves
 * against THIS package's own directory, and this package deliberately does not
 * depend on it (it would be a cycle: it depends on the sdk). Under npm's flat
 * layout an author gets away with it, because both packages sit side by side at
 * the top of `node_modules` and Node's walk-up finds one from the other. Under
 * pnpm they are in separate isolated stores and it can never resolve, so `docs`
 * and `render` failed for every author on pnpm with a message saying the package
 * was not installed while it sat installed in their client.
 *
 * The fixture builds an author package the way pnpm would: the tools package
 * reachable from the AUTHOR and unreachable from the sdk. It also gives it an
 * `exports` map with no `require` condition, which is what it really ships and
 * what makes `createRequire().resolve` the wrong instrument here.
 *
 * It was ui-kit until ticket 221 moved the harness out. The fixture names the
 * package the CLI actually looks for: a stale one here would pass by planting
 * the wrong thing and prove nothing about what an author has installed.
 */
describe("gonogo-uplink forwards a browser verb to the AUTHOR's tools", () => {
  const author = () => {
    const dir = workdir();
    writeFileSync(
      join(dir, "package.json"),
      JSON.stringify({ name: "an-uplink-client", private: true }),
    );
    const tools = join(dir, "node_modules", "@ksp-gonogo", "uplink-tools");
    mkdirSync(tools, { recursive: true });
    writeFileSync(
      join(tools, "package.json"),
      JSON.stringify({
        name: "@ksp-gonogo/uplink-tools",
        type: "module",
        version: "9.9.9",
        exports: {
          ".": {
            types: "./dist/index.d.ts",
            import: "./dist/index.js",
          },
        },
      }),
    );
    mkdirSync(join(tools, "dist"), { recursive: true });
    writeFileSync(
      join(tools, "dist", "index.js"),
      "export async function run(argv) {\n" +
        '  console.log("REACHED uplink-tools 9.9.9 with " + argv.join(" "));\n' +
        "  return 0;\n" +
        "}\n",
    );
    return dir;
  };

  it("resolves it from --root, not from its own module graph", () => {
    const dir = author();
    const out = execFileSync(
      process.execPath,
      [BIN, "docs", "--root", dir, "--check"],
      { encoding: "utf8" },
    );
    expect(out).toContain("REACHED uplink-tools 9.9.9 with docs --root");
  });

  it("resolves it from the working directory when no --root is given", () => {
    const dir = author();
    const out = execFileSync(process.execPath, [BIN, "render"], {
      cwd: dir,
      encoding: "utf8",
    });
    expect(out).toContain("REACHED uplink-tools 9.9.9 with render");
  });

  it("still says the tools package is missing when it really is", () => {
    const dir = workdir();
    writeFileSync(
      join(dir, "package.json"),
      JSON.stringify({ name: "no-tools-here", private: true }),
    );
    let combined = "";
    expect(() => {
      try {
        execFileSync(process.execPath, [BIN, "docs"], {
          cwd: dir,
          encoding: "utf8",
          stdio: "pipe",
        });
      } catch (err) {
        const stderr: unknown =
          typeof err === "object" && err !== null
            ? Reflect.get(err, "stderr")
            : undefined;
        combined = String(stderr ?? "");
        throw err;
      }
    }).toThrow();
    expect(combined).toContain("@ksp-gonogo/uplink-tools");
    expect(combined).toContain("npm i -D @ksp-gonogo/uplink-tools playwright");
  });
});

/**
 * `bundle --watch` keeps one esbuild context alive and reports each outcome in
 * `watch-status.json` beside the bundle, which is what the app's dev server
 * reads to say "waiting", "built" or "failed" without parsing a log.
 */
describe("gonogo-uplink bundle --watch", () => {
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
