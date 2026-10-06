// @vitest-environment node
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { isReleaseTag } from "../../../scripts/mod-release-tag.mjs";

/**
 * A release candidate never reaches SpaceDock, CKAN or the GitHub release's
 * mod asset. SpaceDock feeds CKAN, and a player who ticks Upgrade All takes
 * the newest version CKAN lists. The rule is one function and each publishing
 * path asks it for itself.
 */

const ROOT = join(__dirname, "../../..");
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");
const PUBLISH_MODS = read(".github/workflows/publish-mods.yml");
const BUILD = read(".github/workflows/_build-uplink-mod.yml");
const RELEASE = read(".github/workflows/release.yml");

const assertCli = (tag: string) =>
  spawnSync(
    "node",
    [join(ROOT, "scripts/mod-release-tag.mjs"), "assert", tag],
    {
      encoding: "utf8",
    },
  );

describe("isReleaseTag", () => {
  it("accepts exactly v<MAJOR>.<MINOR>.<PATCH>", () => {
    for (const tag of ["v0.2.0", "v1.0.0", "v10.20.30"]) {
      expect(isReleaseTag(tag), tag).toBe(true);
    }
  });

  it("rejects every version with a prerelease or build part, or without the v", () => {
    for (const tag of [
      "v0.2.0-rc.1",
      "v0.2.0-rc",
      "v0.2.0-beta.3",
      "v0.2.0-0",
      "v0.2.0+7",
      "v0.2.0-rc.1+7",
      "0.2.0",
      "0.2.0-rc.1",
      "rc-abc1234",
      "v0.2",
      "v0.2.0.1",
      "v0.2.0 ",
      "",
    ]) {
      expect(isReleaseTag(tag), JSON.stringify(tag)).toBe(false);
    }
  });
});

describe("the assert step the workflows run", () => {
  it("passes a release and fails a release candidate", () => {
    expect(assertCli("v0.2.0").status).toBe(0);
    const rejected = assertCli("v0.2.0-rc.1");
    expect(rejected.status).toBe(1);
    expect(rejected.stderr).toMatch(/not a release version/);
  });
});

describe("every path that puts a mod zip in front of a player asks the rule", () => {
  it("the version job stops a non-release before any zip is built", () => {
    const job = PUBLISH_MODS.slice(
      PUBLISH_MODS.indexOf("\n  version:"),
      PUBLISH_MODS.indexOf("\n  build-mod:"),
    );
    expect(job).toMatch(/mod-release-tag\.mjs assert "\$\{GITHUB_REF_NAME\}"/);
    expect(job).toMatch(/sparse-checkout: scripts/);
  });

  it("the SpaceDock decision asks before it reads the version or the listing", () => {
    const step = BUILD.slice(BUILD.indexOf("id: sd"));
    const assertAt = step.indexOf("mod-release-tag.mjs assert");
    expect(assertAt).toBeGreaterThan(-1);
    expect(assertAt).toBeLessThan(step.indexOf("bare-version"));
    expect(assertAt).toBeLessThan(step.indexOf("api/mod/"));
    expect(BUILD).toMatch(
      /- name: Decide whether[^\n]*\n\s+id: sd\n\s+if: \$\{\{ inputs\.channel == 'release' \}\}/,
    );
  });

  it("the SpaceDock steps that follow run only on that decision", () => {
    for (const name of ["Write the SpaceDock player changelog", "Publish "]) {
      const at = BUILD.indexOf(`- name: ${name}`);
      expect(BUILD.slice(at, at + 200), name).toMatch(
        /steps\.sd\.outputs\.upload == 'true'/,
      );
    }
  });

  it("the release attach asks first and runs only on the release channel", () => {
    const job = PUBLISH_MODS.slice(
      PUBLISH_MODS.indexOf("\n  attach-to-release:"),
    );
    expect(job).toMatch(/if: \$\{\{ inputs\.channel == 'release' \}\}/);
    const assertAt = job.indexOf("mod-release-tag.mjs assert");
    expect(assertAt).toBeGreaterThan(-1);
    expect(assertAt).toBeLessThan(job.indexOf("gh release upload"));
  });

  it("the RC channel reaches neither: the SpaceDock decision is release-only", () => {
    expect(PUBLISH_MODS).not.toMatch(/channel: release/);
    expect(
      BUILD.match(/inputs\.channel == 'release'/g)?.length,
    ).toBeGreaterThanOrEqual(1);
  });

  it("the package RC mode never dispatches the mod publisher", () => {
    const releaseJob = RELEASE.slice(
      RELEASE.indexOf("\n  release:"),
      RELEASE.indexOf("\n  rc-plan:"),
    );
    expect(releaseJob).toMatch(/inputs\.packages_only \|\| inputs\.rc/);
    expect(releaseJob).toMatch(/gh workflow run publish-mods\.yml/);
    const elsewhere = RELEASE.replace(releaseJob, "")
      .split("\n")
      .filter((line) => !line.trimStart().startsWith("#"))
      .join("\n");
    expect(elsewhere).not.toMatch(/publish-mods\.yml/);
  });

  it("the netkan lists no prerelease", () => {
    expect(read("mod/Gonogo.KSP/GonogoCore.netkan")).toMatch(
      /"prereleases": false/,
    );
  });
});
