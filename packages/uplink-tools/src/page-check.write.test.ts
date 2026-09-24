// @vitest-environment node
//
// Node realm: this plants a client package on disk and writes files into it.
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defineUplinkClient } from "@ksp-gonogo/sitrep-sdk/spine";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  checkUplinkPage,
  expectUplinkPageCurrent,
  PAGE_UPDATE_ENV,
  writeUplinkPage,
} from "./page-check";

/**
 * The browserless writer, which is the half that makes the gate affordable.
 *
 * The check has always been able to say a page is stale. The only way to act on
 * that was `gonogo-uplink docs`, which rasterises every fixture on the way past,
 * so an additive contract bump (one markdown line, in every bundled Uplink at
 * once) cost a full render run and a diff of pictures nobody had touched.
 *
 * A planted client rather than a real Uplink, because the interesting cases are
 * a page that does not exist yet, a page one line out of date, and a manifest
 * carrying a release hash that must survive the rewrite. None of those is a
 * state a bundled Uplink is ever committed in.
 */

const scratch: string[] = [];

afterEach(() => {
  for (const dir of scratch.splice(0))
    rmSync(dir, { recursive: true, force: true });
  vi.unstubAllEnvs();
});

/** The manifest on disk, refused rather than asserted when it is not an object. */
function readManifest(file: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(readFileSync(file, "utf8"));
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error(`${file} is not a JSON object`);
  }
  return { ...parsed };
}

/** A client package with one declared Uplink and nothing registered. */
function plantClient(): string {
  const dir = mkdtempSync(join(tmpdir(), "gonogo-page-write-"));
  scratch.push(dir);
  writeFileSync(
    join(dir, "package.json"),
    `${JSON.stringify({ name: "planted-client", version: "1.2.3" }, null, 2)}\n`,
  );
  mkdirSync(join(dir, "src"), { recursive: true });
  writeFileSync(join(dir, "src", "index.ts"), "export {};\n");
  return dir;
}

// One client per FILE, not per test: the registry is global and `readInventory`
// refuses to guess between two declared clients.
defineUplinkClient({
  id: "planted",
  version: "1.2.3",
  name: "Planted",
  description: "A client that exists to be written about.",
});

describe("writeUplinkPage", () => {
  it("writes a page where there was none, and the check then passes", () => {
    const dir = plantClient();
    expect(checkUplinkPage({ root: dir }).differences).toHaveLength(2);

    const { written } = writeUplinkPage({ root: dir });

    expect(written.sort()).toEqual(["README.md", "gonogo-uplink.json"]);
    expect(checkUplinkPage({ root: dir }).differences).toEqual([]);
  });

  it("heals a page whose only staleness is one generated line", () => {
    const dir = plantClient();
    writeUplinkPage({ root: dir });
    const readmePath = join(dir, "README.md");
    const current = readFileSync(readmePath, "utf8");

    // Literally a contract Minor bump: the "Built against" row moves and
    // nothing else on the page does.
    const stale = current.replace(
      /contract (\d+)\.(\d+)/,
      (_, major: string, minor: string) =>
        `contract ${major}.${Number(minor) + 1}`,
    );
    expect(stale).not.toBe(current);
    writeFileSync(readmePath, stale);
    expect(checkUplinkPage({ root: dir }).differences).toHaveLength(1);

    expect(writeUplinkPage({ root: dir }).written).toEqual(["README.md"]);
    expect(checkUplinkPage({ root: dir }).differences).toEqual([]);
  });

  it("reports nothing written when the page is already current", () => {
    const dir = plantClient();
    writeUplinkPage({ root: dir });

    expect(writeUplinkPage({ root: dir }).written).toEqual([]);
  });

  it("keeps the integrity a release stamped into the manifest", () => {
    const dir = plantClient();
    const manifestPath = join(dir, "gonogo-uplink.json");
    writeUplinkPage({ root: dir });
    const released = readManifest(manifestPath);
    released.integrity = "sha256-anAlreadyPublishedBundle";
    released.name = "A name the registrations no longer say";
    writeFileSync(manifestPath, `${JSON.stringify(released, null, 2)}\n`);

    writeUplinkPage({ root: dir });

    const rewritten = readManifest(manifestPath);
    expect(rewritten.integrity).toBe("sha256-anAlreadyPublishedBundle");
    expect(rewritten.name).toBe("Planted");
  });
});

describe("expectUplinkPageCurrent", () => {
  it("names the browserless remedy rather than the rasterising one", () => {
    const dir = plantClient();

    expect(() => expectUplinkPageCurrent({ root: dir })).toThrow(
      /pnpm uplink-pages/,
    );
  });

  it("rewrites the page instead of throwing when asked to", () => {
    const dir = plantClient();
    vi.stubEnv(PAGE_UPDATE_ENV, "1");
    vi.stubEnv("CI", "");

    expectUplinkPageCurrent({ root: dir });

    expect(checkUplinkPage({ root: dir }).differences).toEqual([]);
  });

  it("refuses to rewrite in CI, where a self-healing gate measures nothing", () => {
    const dir = plantClient();
    vi.stubEnv(PAGE_UPDATE_ENV, "1");
    vi.stubEnv("CI", "true");

    expect(() => expectUplinkPageCurrent({ root: dir })).toThrow(
      new RegExp(`${PAGE_UPDATE_ENV}=1 is set in CI`),
    );
    expect(checkUplinkPage({ root: dir }).differences).toHaveLength(2);
  });
});
