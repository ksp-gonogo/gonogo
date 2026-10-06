// @vitest-environment node
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createLocalUplinks, parseLocalUplinkPaths } from "./local-uplinks";

const sha = (text: string) =>
  `sha256-${createHash("sha256").update(text).digest("hex")}`;

const scratch: string[] = [];
afterEach(() => {
  for (const dir of scratch.splice(0))
    rmSync(dir, { recursive: true, force: true });
});

/** An Uplink checkout: `uplink.json` at the root, the client one level below. */
function checkout(id = "fixture") {
  const root = mkdtempSync(join(tmpdir(), "gonogo-local-"));
  scratch.push(root);
  writeFileSync(join(root, "uplink.json"), JSON.stringify({ id }));
  const bundleDir = join(root, "client", "dist", id);
  mkdirSync(bundleDir, { recursive: true });
  writeFileSync(join(root, "client", "package.json"), "{}");
  const build = (
    source: string,
    sidecar: Record<string, unknown> = {},
    status?: Record<string, unknown>,
  ) => {
    writeFileSync(join(bundleDir, `${id}.client.js`), source);
    writeFileSync(
      join(bundleDir, "gonogo-uplink.json"),
      JSON.stringify({
        id,
        name: "Fixture",
        author: "someone",
        repo: "https://example.invalid/fixture",
        version: "1.2.3",
        minAppVersion: "0.0.0",
        apiVersion: "7.7.0",
        uiKitVersion: "5.5.0",
        contractMajor: 9,
        contractMinor: 4,
        bundleUrl: `${id}.client.js`,
        integrity: sha(source),
        sdkVersion: "0.0.1",
        ...sidecar,
      }),
    );
    if (status) {
      writeFileSync(
        join(bundleDir, "watch-status.json"),
        JSON.stringify(status),
      );
    }
  };
  return { root, bundleDir, build };
}

describe("local Uplinks", () => {
  it("indexes a built bundle by the hash of the bytes it will serve, with compat read from its own sidecar", () => {
    const { root, build } = checkout();
    build("export const marker = 1;\n");

    const local = createLocalUplinks([root]);
    const [entry] = local.index();

    expect(entry.id).toBe("fixture");
    expect(entry.source).toBe("local");
    const [version] = entry.versions;
    expect(version.integrity).toBe(sha("export const marker = 1;\n"));
    expect(version.apiVersion).toBe("7.7.0");
    expect(version.uiKitVersion).toBe("5.5.0");
    expect(version.contractMajor).toBe(9);
    expect(version.bundleUrl).toBe(
      `/uplinks/local/fixture/fixture.client.js?h=${version.integrity}`,
    );
    expect(local.bundle("fixture", version.integrity)?.toString()).toBe(
      "export const marker = 1;\n",
    );
  });

  it("keeps serving the bytes an earlier index named after the bundle changes", () => {
    const { root, build } = checkout();
    build("export const marker = 1;\n");
    const local = createLocalUplinks([root]);
    const oldHash = local.index()[0].versions[0].integrity;

    build("export const marker = 2;\n");
    const newHash = local.index()[0].versions[0].integrity;

    expect(newHash).toBe(sha("export const marker = 2;\n"));
    expect(newHash).not.toBe(oldHash);
    expect(local.bundle("fixture", oldHash)?.toString()).toBe(
      "export const marker = 1;\n",
    );
    expect(local.bundle("fixture", newHash)?.toString()).toBe(
      "export const marker = 2;\n",
    );
    expect(local.bundle("fixture", "sha256-nothing")).toBeUndefined();
  });

  it("reads waiting, and offers nothing to load, before the first build", () => {
    const { root } = checkout();
    const local = createLocalUplinks([root]);

    expect(local.index()).toEqual([]);
    expect(local.statuses()).toMatchObject([
      { id: "fixture", state: "waiting", error: null },
    ]);
  });

  it("reports a failed rebuild with its error while the last good bundle stays on offer", () => {
    const { root, build } = checkout();
    build(
      "export const marker = 1;\n",
      {},
      {
        state: "failed",
        builtAt: "2026-10-06T10:00:00.000Z",
        integrity: sha("export const marker = 1;\n"),
        error: 'Unexpected ";" (src/index.ts:1)',
      },
    );
    const local = createLocalUplinks([root]);

    expect(local.index()).toHaveLength(1);
    expect(local.statuses()[0]).toMatchObject({
      state: "failed",
      error: 'Unexpected ";" (src/index.ts:1)',
      version: "1.2.3",
      path: root,
    });
  });

  it("refuses a path that is not an Uplink, naming the path", () => {
    const missing = join(tmpdir(), "gonogo-local-no-such-uplink");
    expect(() => createLocalUplinks([missing])).toThrow(missing);
  });

  it("splits the environment value into its paths", () => {
    expect(parseLocalUplinkPaths(undefined)).toEqual([]);
    expect(parseLocalUplinkPaths("/a\n\n/b\n")).toEqual(["/a", "/b"]);
  });
});
