import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";

// mod/sitrep-sdk/ -> mod/scripts/bake-client-hash.mjs
const SCRIPT = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "scripts",
  "bake-client-hash.mjs",
);

it("bakes sha256-<hex> of the bundle into the generated const", () => {
  const dir = mkdtempSync(join(tmpdir(), "bake-"));
  const bundle = join(dir, "index.js");
  writeFileSync(bundle, "export const marker = 1;");
  const out = join(dir, "ExpectedClientHash.g.cs");

  execFileSync("node", [SCRIPT, bundle, out, "Demo"]);

  const expected = `sha256-${createHash("sha256")
    .update(readFileSync(bundle))
    .digest("hex")}`;
  const generated = readFileSync(out, "utf8");
  expect(generated).toContain(`public const string Value = "${expected}";`);
  expect(generated).toContain("namespace Demo");
});
