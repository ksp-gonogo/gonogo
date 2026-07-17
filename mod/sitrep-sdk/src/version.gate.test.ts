import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { SDK_VERSION } from "./index";

/**
 * The gate that makes any future `apiVersion` claim trustworthy.
 *
 * `SDK_VERSION` is generated from package.json by scripts/gen-version.mjs. If a
 * version bump lands without regenerating (or someone hand-edits the generated
 * file), the exported marker no longer matches the manifest — exactly the
 * "0.0.0 vs 0.0.1" drift this replaces. Read the manifest straight off disk so
 * the comparison is against the real published version, not a second literal.
 */
describe("sitrep-sdk version marker", () => {
  it("matches the package.json version (no drift)", () => {
    const pkg = JSON.parse(
      readFileSync(resolve(process.cwd(), "package.json"), "utf8"),
    ) as { version: string };
    expect(SDK_VERSION).toBe(pkg.version);
  });
});
