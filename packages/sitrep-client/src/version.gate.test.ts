import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { CLIENT_VERSION } from "./index";

/**
 * Mirror of the sitrep-sdk version gate: `CLIENT_VERSION` is generated from
 * package.json by scripts/gen-version.mjs, and this fails if the two ever drift
 * (a bump without a regenerate, or a hand-edit of the generated file). Read the
 * manifest off disk so the assertion is against the real version, not a literal.
 */
describe("sitrep-client version marker", () => {
  it("matches the package.json version (no drift)", () => {
    const pkg = JSON.parse(
      readFileSync(resolve(process.cwd(), "package.json"), "utf8"),
    ) as { version: string };
    expect(CLIENT_VERSION).toBe(pkg.version);
  });
});
