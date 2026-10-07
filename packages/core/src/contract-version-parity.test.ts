// @vitest-environment node
//
// Node realm: this reads three source files off disk and compares numbers.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import * as sdk from "@ksp-gonogo/sitrep-sdk";
import { CONTRACT_MAJOR, CONTRACT_MINOR } from "@ksp-gonogo/sitrep-sdk";
import * as uiKit from "@ksp-gonogo/ui-kit";
import { describe, expect, it } from "vitest";
import { readJsonObject } from "./ratchetBaseRef";

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
 *  - `UI_KIT_VERSION` was a hand-typed copy of the kit's package version that
 *    the app compared an Uplink's manifest against. A release stamps the
 *    package version onto the packed manifest and nothing else, so every
 *    published kit disagreed with its own constant and every client built
 *    against one was refused. The sdk's `SDK_VERSION` shipped as 0.0.1 in
 *    every release for the same reason. Both are gone: the surface an Uplink is
 *    built against has one number, `EXTENSION_API_VERSION`, which moves when
 *    the surface does, and the tests below keep a package version from being
 *    exported or compared again
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

  it("EXTENSION_API_VERSION is the version the surface ledger last recorded", () => {
    // The ledger is what moves this number, at a release, by what changed in the surface of the sdk and ui-kit: a break moves the major, an addition the minor.
    const ledger = readJsonObject(
      join(REPO_ROOT, "mod", "sitrep-sdk", "extension-api.ledger.json"),
    );
    const entries: unknown = ledger.entries;
    const last: unknown = Array.isArray(entries) ? entries.at(-1) : undefined;
    const recorded: unknown =
      typeof last === "object" && last !== null
        ? Reflect.get(last, "version")
        : undefined;
    expect(sdk.EXTENSION_API_VERSION).toBe(recorded);
  });

  it("neither published package exports a version of its own", () => {
    /*
     * A constant holding the package's version cannot be right once published:
     * a release stamps the version onto the packed manifest, after the build
     * that would have baked the constant. And anything compared against one
     * refuses a client for being built a release ago, with no surface changed.
     * The one version either package exports is the surface's.
     */
    const versions = (pkg: object) =>
      Object.keys(pkg).filter((name) => /VERSION$/.test(name));
    expect(versions(sdk)).toEqual(["EXTENSION_API_VERSION"]);
    expect(versions(uiKit)).toEqual([]);
  });

  it("the app gates an Uplink on the surface and the contract, and on no package version", () => {
    const hostCompat = readFileSync(
      join(REPO_ROOT, "packages", "app", "src", "uplinks", "hostCompat.ts"),
      "utf8",
    );
    const declared = /export interface HostCompat \{([\s\S]*?)\n\}/.exec(
      hostCompat,
    );
    if (!declared) {
      throw new Error(
        "contract-version-parity: no `export interface HostCompat` in hostCompat.ts. " +
          "Point this test at wherever the app's compat identity moved to.",
      );
    }
    const members = [...declared[1].matchAll(/^\s{2}(\w+)\??:/gm)].map(
      (match) => match[1],
    );
    expect(members).toEqual(["apiVersion", "contractMajor", "contractMinor"]);
  });

  it("every bundled Uplink manifest claims the contract now on the wire", () => {
    const manifests = readdirSync(join(REPO_ROOT, "mod"))
      .map((dir) => join(REPO_ROOT, "mod", dir, "client", "gonogo-uplink.json"))
      .filter((path) => existsSync(path));

    expect(manifests.length).toBeGreaterThan(0);

    /**
     * Read as `unknown` and checked, rather than asserted into shape. A
     * manifest that does not carry the pair AT ALL is not a manifest this test
     * has no opinion about: it is one the compat gate cannot read either, so
     * it is reported here as its own kind of stale rather than defaulted to a
     * number that would compare equal.
     */
    const pairOf = (path: string): string => {
      const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
      if (typeof parsed !== "object" || parsed === null) return "not an object";
      if (!("contractMajor" in parsed) || !("contractMinor" in parsed))
        return "carries no contract pair";
      const { contractMajor, contractMinor } = parsed;
      if (
        typeof contractMajor !== "number" ||
        typeof contractMinor !== "number"
      )
        return "carries no contract pair";
      if (contractMajor === CONTRACT_MAJOR && contractMinor === CONTRACT_MINOR)
        return "";
      return `${contractMajor}.${contractMinor}`;
    };

    const stale = manifests
      .map((path) => ({ path: relative(REPO_ROOT, path), pair: pairOf(path) }))
      .filter((m) => m.pair !== "")
      .map((m) => `${m.path}: ${m.pair}`);

    expect(
      stale,
      `These manifests are pinned to a contract the host no longer speaks, so ` +
        `bumping ContractVersion.cs strands every bundled Uplink until its ` +
        `manifest moves too. A stale MAJOR is refused at load with a message ` +
        `about a version mismatch; a stale MINOR loads, and under-claims what ` +
        `the Uplink was built against, which is the same file being wrong for ` +
        `a quieter reason. Expected ${CONTRACT_MAJOR}.${CONTRACT_MINOR}.\n` +
        `Rewrite every bundled page's prose, with no browser and no change ` +
        `under docs/assets: pnpm uplink-pages`,
    ).toEqual([]);
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
