// @vitest-environment node
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  avcVersion,
  GAME_VERSIONS,
} from "../../../scripts/write-avc-version.mjs";

/**
 * CKAN reads a mod's game-version compatibility from the `.version` file
 * (`$vref: #/ckan/ksp-avc`). KSP-AVC's form for a game version is an object of
 * numbers; a dotted string is the shape the format does not define.
 */

const WORKFLOW = join(
  __dirname,
  "../../../.github/workflows/_build-uplink-mod.yml",
);

let work: string;
beforeEach(() => {
  work = mkdtempSync(join(tmpdir(), "avc-version-"));
});
afterEach(() => {
  rmSync(work, { recursive: true, force: true });
});

const numberObject = (dotted: string) => {
  const [MAJOR, MINOR, PATCH] = dotted.split(".").map(Number);
  return { MAJOR, MINOR, PATCH };
};

describe("avcVersion", () => {
  it("writes every game version in KSP-AVC's object form", () => {
    const file = avcVersion("Gonogo", "v0.2.0");
    expect(file.KSP_VERSION).toEqual(numberObject(GAME_VERSIONS.KSP_VERSION));
    expect(file.KSP_VERSION_MIN).toEqual(
      numberObject(GAME_VERSIONS.KSP_VERSION_MIN),
    );
    expect(file.KSP_VERSION_MAX).toEqual(
      numberObject(GAME_VERSIONS.KSP_VERSION_MAX),
    );
    for (const value of [
      file.KSP_VERSION,
      file.KSP_VERSION_MIN,
      file.KSP_VERSION_MAX,
    ]) {
      expect(Object.keys(value)).toEqual(["MAJOR", "MINOR", "PATCH"]);
    }
  });

  it("splits a release tag into the mod's own version and gives an rc 0.0.0", () => {
    expect(avcVersion("Gonogo", "v0.2.0").VERSION).toEqual({
      MAJOR: 0,
      MINOR: 2,
      PATCH: 0,
    });
    expect(avcVersion("Gonogo", "rc-abc1234").VERSION).toEqual({
      MAJOR: 0,
      MINOR: 0,
      PATCH: 0,
    });
  });

  it("names a compatible range that contains the declared game version", () => {
    const { KSP_VERSION, KSP_VERSION_MIN, KSP_VERSION_MAX } = avcVersion(
      "Gonogo",
      "v0.2.0",
    );
    const n = (v: { MAJOR: number; MINOR: number; PATCH: number }) =>
      v.MAJOR * 1e6 + v.MINOR * 1e3 + v.PATCH;
    expect(n(KSP_VERSION_MIN)).toBeLessThanOrEqual(n(KSP_VERSION));
    expect(n(KSP_VERSION)).toBeLessThanOrEqual(n(KSP_VERSION_MAX));
  });
});

describe("the CLI", () => {
  it("writes the same file avcVersion returns", () => {
    const out = join(work, "Gonogo.version");
    execFileSync("node", [
      join(__dirname, "../../../scripts/write-avc-version.mjs"),
      out,
      "Gonogo",
      "v0.2.0",
    ]);
    expect(JSON.parse(readFileSync(out, "utf8"))).toEqual(
      avcVersion("Gonogo", "v0.2.0"),
    );
  });
});

describe("the SpaceDock game-version field", () => {
  it("is read out of the written .version file, never a second hardcoded copy", () => {
    const workflow = readFileSync(WORKFLOW, "utf8");
    expect(workflow).not.toMatch(/GAME_VERSION="\d/);
    expect(workflow).toMatch(/\.version/);
    expect(workflow).toMatch(/GAME_VERSION="\$\(jq/);
  });
});
