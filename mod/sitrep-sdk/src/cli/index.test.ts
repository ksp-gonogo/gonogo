import { execFileSync } from "node:child_process";
import {
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
    // The value the loader compares against, so its SHAPE is the contract: an
    // `sha256-<64 hex>` it can match, never a bare digest or an empty string.
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
 * The browser verbs are forwarded to ui-kit, and WHOSE ui-kit is the whole
 * question.
 *
 * A bare `await import("@ksp-gonogo/ui-kit/render")` inside this package
 * resolves against THIS package's own directory, and this package deliberately
 * does not depend on ui-kit (it would be a cycle). Under npm's flat layout an
 * author gets away with it, because both packages sit side by side at the top of
 * `node_modules` and Node's walk-up finds one from the other. Under pnpm they
 * are in separate isolated stores and it can never resolve, so `docs` and
 * `render` failed for every author on pnpm with the message that says ui-kit is
 * not installed while it sat installed in their client.
 *
 * The fixture builds an author package the way pnpm would: ui-kit reachable from
 * the AUTHOR and unreachable from the sdk. It also gives its fake ui-kit an
 * `exports` map with no `require` condition, which is what ui-kit really ships
 * and what makes `createRequire().resolve` the wrong instrument here.
 */
describe("gonogo-uplink forwards a browser verb to the AUTHOR's ui-kit", () => {
  const author = () => {
    const dir = workdir();
    writeFileSync(
      join(dir, "package.json"),
      JSON.stringify({ name: "an-uplink-client", private: true }),
    );
    const kit = join(dir, "node_modules", "@ksp-gonogo", "ui-kit");
    mkdirSync(kit, { recursive: true });
    writeFileSync(
      join(kit, "package.json"),
      JSON.stringify({
        name: "@ksp-gonogo/ui-kit",
        type: "module",
        version: "9.9.9",
        exports: {
          "./render": {
            types: "./dist/render.d.ts",
            import: "./dist/render.js",
          },
        },
      }),
    );
    mkdirSync(join(kit, "dist"), { recursive: true });
    writeFileSync(
      join(kit, "dist", "render.js"),
      "export async function run(argv) {\n" +
        '  console.log("REACHED ui-kit 9.9.9 with " + argv.join(" "));\n' +
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
    expect(out).toContain("REACHED ui-kit 9.9.9 with docs --root");
  });

  it("resolves it from the working directory when no --root is given", () => {
    const dir = author();
    const out = execFileSync(process.execPath, [BIN, "render"], {
      cwd: dir,
      encoding: "utf8",
    });
    expect(out).toContain("REACHED ui-kit 9.9.9 with render");
  });

  it("still says ui-kit is missing when it really is", () => {
    const dir = workdir();
    writeFileSync(
      join(dir, "package.json"),
      JSON.stringify({ name: "no-kit-here", private: true }),
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
        combined = String((err as { stderr?: string }).stderr ?? "");
        throw err;
      }
    }).toThrow();
    expect(combined).toContain("@ksp-gonogo/ui-kit");
    expect(combined).toContain("npm i -D @ksp-gonogo/ui-kit playwright");
  });
});
