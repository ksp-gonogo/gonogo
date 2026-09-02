// @vitest-environment node
//
// Node realm: this reads three source files off disk and compares numbers.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { CONTRACT_MAJOR, CONTRACT_MINOR } from "@ksp-gonogo/sitrep-sdk";
import { UI_KIT_VERSION } from "@ksp-gonogo/ui-kit";
import { describe, expect, it } from "vitest";

/**
 * The published compat numbers must equal the things they mirror.
 *
 * Every one of these is a number written in one language and read in another,
 * and each pair had already drifted when this test was written:
 *
 *  - `packages/app/vite.config.ts` advertised contract 5.0, under a comment
 *    saying 4.7, while `ContractVersion.cs` had reached 12.22. Nothing compared
 *    them, and the mismatch is silent until the first Uplink ships a correctly
 *    generated manifest, at which point the app refuses it with a message about
 *    a contract mismatch rather than about a stale mirror
 *  - `UI_KIT_VERSION` and the kit's own `package.json` disagreed, carrying a
 *    `TODO(version)` in place of a check. Neither number was ever published:
 *    npm has only 0.1.0, so a bump written here is a claim about a release
 *    that has not happened
 *
 * It lives in core because core is where this repo keeps its cross-package
 * ratchets, and because the C# file is not reachable from either package being
 * checked.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, "..", "..", "..");

function readCsharpConst(file: string, name: string): number {
  const src = readFileSync(file, "utf8");
  const match = new RegExp(
    `public\\s+const\\s+int\\s+${name}\\s*=\\s*(-?\\d+)\\s*;`,
  ).exec(src);
  if (!match) {
    throw new Error(
      `contract-version-parity: no "public const int ${name}" in ${file}. ` +
        "The declaration was renamed or moved; point this test at it rather " +
        "than deleting the check, or the mirror goes back to being unchecked.",
    );
  }
  return Number(match[1]);
}

describe("published compat versions mirror their sources", () => {
  const contractVersionCs = join(
    REPO_ROOT,
    "mod",
    "Sitrep.Contract",
    "ContractVersion.cs",
  );

  it("CONTRACT_MAJOR equals ContractVersion.Major", () => {
    expect(CONTRACT_MAJOR).toBe(readCsharpConst(contractVersionCs, "Major"));
  });

  it("CONTRACT_MINOR equals ContractVersion.Minor", () => {
    expect(CONTRACT_MINOR).toBe(readCsharpConst(contractVersionCs, "Minor"));
  });

  it("UI_KIT_VERSION equals the kit's package version", () => {
    const pkg = JSON.parse(
      readFileSync(
        join(REPO_ROOT, "packages", "ui-kit", "package.json"),
        "utf8",
      ),
    ) as { version: string };
    expect(UI_KIT_VERSION).toBe(pkg.version);
  });

  it("the app advertises the sdk's contract pair, not its own copy", () => {
    // The app's compat identity is what an Uplink's manifest is gated against,
    // so a second hand-typed copy in the vite config is the drift this whole
    // file exists for. Asserted as an ABSENCE of the literal form, because the
    // config runs in raw Node and cannot be imported here.
    const config = readFileSync(
      join(REPO_ROOT, "packages", "app", "vite.config.ts"),
      "utf8",
    );
    expect(config).toMatch(/HOST_CONTRACT_MAJOR = readExportedNumberConst/);
    expect(config).toMatch(/HOST_CONTRACT_MINOR = readExportedNumberConst/);
  });
});
