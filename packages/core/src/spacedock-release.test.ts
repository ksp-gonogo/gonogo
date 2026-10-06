// @vitest-environment node
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  bareVersion,
  listingHolds,
} from "../../../scripts/spacedock-release.mjs";

/**
 * SpaceDock feeds CKAN, and CKAN takes its version from the SpaceDock version
 * string. What holds here: the listing only ever gets a bare version, a
 * version the listing already holds is never uploaded again, and a lookup that
 * cannot be read stops the upload rather than reading as "absent".
 */

const ROOT = join(__dirname, "../../..");
const SCRIPT = join(ROOT, "scripts/spacedock-release.mjs");
const LISTING = join(ROOT, "scripts/__fixtures__/spacedock-mod-4366.json");
const BUILD = readFileSync(
  join(ROOT, ".github/workflows/_build-uplink-mod.yml"),
  "utf8",
);

let work: string;
beforeEach(() => {
  work = mkdtempSync(join(tmpdir(), "spacedock-release-"));
});
afterEach(() => {
  rmSync(work, { recursive: true, force: true });
});

const run = (...args: string[]) =>
  spawnSync("node", [SCRIPT, ...args], { encoding: "utf8" });

describe("bareVersion", () => {
  it("strips the leading v the release tag carries", () => {
    expect(bareVersion("v0.2.0")).toBe("0.2.0");
    expect(bareVersion("V0.2.0")).toBe("0.2.0");
    expect(bareVersion("0.2.0")).toBe("0.2.0");
  });

  it("is what the CLI prints", () => {
    expect(
      execFileSync("node", [SCRIPT, "bare-version", "v0.2.0"], {
        encoding: "utf8",
      }).trim(),
    ).toBe("0.2.0");
  });
});

describe("the saved reply for mod 4366", () => {
  const listing = JSON.parse(readFileSync(LISTING, "utf8"));

  it("is a real listing reply, so the guard is tested against the shape SpaceDock sends", () => {
    expect(listing.id).toBe(4366);
    expect(listing.versions.length).toBeGreaterThan(3);
    expect(listing.versions[0]).toHaveProperty("friendly_version");
  });

  it("holds every version it lists, and none it does not", () => {
    for (const v of listing.versions) {
      expect(listingHolds(listing, v.friendly_version)).toBe(true);
    }
    expect(listingHolds(listing, "99.0.0")).toBe(false);
  });

  it("matches the whole version string, never a prefix of one", () => {
    expect(listingHolds(listing, "1.9")).toBe(false);
    expect(listingHolds(listing, "1.9.10")).toBe(false);
    expect(listingHolds(listing, "v1.9.1")).toBe(false);
  });

  it("answers through the CLI the way the workflow reads it", () => {
    expect(run("holds", LISTING, "1.9.1").stdout.trim()).toBe("held");
    expect(run("holds", LISTING, "1.9.2").stdout.trim()).toBe("absent");
  });
});

describe("a lookup that cannot be read", () => {
  it("stops rather than reading as absent", () => {
    expect(() => listingHolds({ error: true, reason: "no" }, "1.0.0")).toThrow(
      /no versions list/,
    );
    const broken = join(work, "broken.json");
    writeFileSync(broken, '{"error": true}');
    const result = run("holds", broken, "1.0.0");
    expect(result.status).toBe(2);
    expect(result.stdout).toBe("");
    writeFileSync(broken, "<html>502</html>");
    expect(run("holds", broken, "1.0.0").status).toBe(2);
  });
});

describe("the upload workflow", () => {
  it("hands SpaceDock the bare version, never the tag", () => {
    expect(BUILD).toMatch(/spacedock-release\.mjs bare-version/);
    expect(BUILD).toMatch(/VERSION: \$\{\{ steps\.sd\.outputs\.version \}\}/);
    expect(BUILD).not.toMatch(/-F version="\$\{\{ inputs\.version \}\}"/);
    expect(BUILD).not.toMatch(/VERSION="\$\{\{ inputs\.version \}\}"/);
  });

  it("asks SpaceDock what it holds before uploading, and uploads only when absent", () => {
    expect(BUILD).toMatch(/spacedock-release\.mjs holds sd-listing\.json/);
    const publish = BUILD.slice(BUILD.indexOf("- name: Publish "));
    expect(publish).toMatch(/steps\.sd\.outputs\.upload == 'true'/);
  });

  it("says so in the job summary when a run that should have uploaded did not", () => {
    expect(BUILD).toMatch(/SpaceDock was NOT updated/);
    expect(BUILD).toMatch(/SpaceDock already holds/);
    expect(BUILD).toMatch(/SpaceDock updated:/);
  });

  it("keeps the player changelog in one named step of its own", () => {
    const names = BUILD.match(/- name: Write the SpaceDock player changelog/g);
    expect(names).toHaveLength(1);
    expect(BUILD.match(/sd-changelog\.md/g)?.length).toBeGreaterThanOrEqual(2);
    expect(BUILD.match(/git log --oneline/g)).toHaveLength(1);
  });
});
