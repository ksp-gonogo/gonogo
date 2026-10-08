import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { bakeUplink } from "../../../cli/bake";
import { PACKAGE_JSON, UPLINK_JSON, uplinkOn } from "../fixture";
import { type BuildClient, bakeRule, buildClient } from "./index";

const BIN = join(
  import.meta.dirname,
  "..",
  "..",
  "..",
  "..",
  "bin",
  "uplink-tools.mjs",
);

const ctx = (clientDir: string) => ({
  clientDir,
  scan: undefined as never,
  dynamicPrefixes: [],
});

const building =
  (bytes: string): BuildClient =>
  (_dir, outFile) => {
    writeFileSync(outFile, bytes);
    return { ok: true };
  };

/** An Uplink whose mod/ was baked from a bundle of `bytes`. */
const baked = (bytes: string) => {
  const made = uplinkOn({
    "uplink.json": UPLINK_JSON(),
    "client/package.json": PACKAGE_JSON(),
    "client/src/index.ts": "export const x = 1;\n",
    "mod/placeholder.txt": "",
  });
  const bundle = join(made.uplinkDir, "bundle.js");
  writeFileSync(bundle, bytes);
  bakeUplink({ uplinkDir: made.uplinkDir, bundle });
  return made;
};

describe("bake/stale", () => {
  it("passes when the committed files are what bake writes for the client", () => {
    const { clientDir } = baked("export const x = 1;\n");
    expect(
      bakeRule(building("export const x = 1;\n")).check(ctx(clientDir)),
    ).toEqual([]);
  });

  it("fails when the client builds to other bytes than the plugin vouches for", () => {
    const { clientDir, uplinkDir } = baked("export const x = 1;\n");
    const rule = bakeRule(building("export const x = 2;\n"));
    const [finding] = rule.check(ctx(clientDir));
    expect(finding.rule).toBe("bake/stale");
    expect(finding.severity).toBe("error");
    expect(finding.fixable).toBe(true);
    expect(finding.file).toBe(
      join(uplinkDir, "mod", "ExpectedClientHash.g.cs"),
    );
    const hash = (text: string) =>
      `sha256-${createHash("sha256").update(text).digest("hex")}`;
    expect(finding.message).toContain(hash("export const x = 1;\n"));
    expect(finding.message).toContain(hash("export const x = 2;\n"));
  });

  it("heals by writing what bake would, after which the check passes", () => {
    const { clientDir, uplinkDir } = baked("export const x = 1;\n");
    const rule = bakeRule(building("export const x = 2;\n"));
    for (const finding of rule.check(ctx(clientDir))) finding.apply?.();
    expect(rule.check(ctx(clientDir))).toEqual([]);
    expect(
      readFileSync(join(uplinkDir, "mod", "ExpectedClientHash.g.cs"), "utf8"),
    ).toContain(
      createHash("sha256").update("export const x = 2;\n").digest("hex"),
    );
  });

  it("fails a committed hash that is empty", () => {
    const { clientDir, uplinkDir } = baked("x");
    bakeUplink({ uplinkDir });
    const [finding] = bakeRule(building("x")).check(ctx(clientDir));
    expect(finding.message).toContain("vouches for no hash");
  });

  it("only warns about files that were never baked here", () => {
    const { clientDir } = uplinkOn({
      "uplink.json": UPLINK_JSON(),
      "client/package.json": PACKAGE_JSON(),
      "mod/placeholder.txt": "",
    });
    const findings = bakeRule(building("x")).check(ctx(clientDir));
    expect(findings.map((f) => f.rule)).toEqual([
      "bake/missing",
      "bake/missing",
      "bake/missing",
    ]);
    expect(findings.every((f) => f.severity === "warning" && f.fixable)).toBe(
      true,
    );
  });

  it("reports a client that does not bundle", () => {
    const { clientDir } = baked("x");
    const rule = bakeRule(() => ({ ok: false, message: "No matching export" }));
    const [finding] = rule.check(ctx(clientDir));
    expect(finding.rule).toBe("bake/bundle-failed");
    expect(finding.message).toContain("No matching export");
  });

  it("has nothing to say about a client with no plugin", () => {
    const { clientDir } = uplinkOn({
      "uplink.json": UPLINK_JSON(),
      "client/package.json": PACKAGE_JSON(),
    });
    expect(bakeRule(building("x")).check(ctx(clientDir))).toEqual([]);
  });
});

describe("the in-memory build", () => {
  it("is byte for byte what `bundle` writes, so the hash it compares is the one a release bakes", () => {
    const made = uplinkOn({
      "uplink.json": UPLINK_JSON(),
      "client/package.json": PACKAGE_JSON(),
      "client/src/index.ts": 'import "./a.css";\nexport const x = 1;\n',
      "client/src/a.css": ".a { color: red; }\n",
    });
    const memory = join(made.uplinkDir, "memory.js");
    expect(buildClient(made.clientDir, memory)).toEqual({ ok: true });

    execFileSync(
      process.execPath,
      [
        BIN,
        "bundle",
        "--client",
        made.clientDir,
        "--out",
        join(made.uplinkDir, "out"),
      ],
      { encoding: "utf8", cwd: made.clientDir },
    );
    const written = readFileSync(
      join(made.uplinkDir, "out", "demo", "demo.client.js"),
    );
    expect(readFileSync(memory).equals(written)).toBe(true);
  });

  it("fails with the message esbuild gives for a client that does not build", () => {
    const made = uplinkOn({
      "client/package.json": PACKAGE_JSON(),
      "client/src/index.ts": 'import "./missing";\n',
    });
    const built = buildClient(made.clientDir, join(made.uplinkDir, "out.js"));
    expect(built.ok).toBe(false);
  });
});
