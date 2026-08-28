import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
