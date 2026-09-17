// @vitest-environment node
//
// Node realm: this resolves and imports modules off disk.
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadRenderHosts } from "./page-check";

/**
 * `loadRenderHosts` is the THIRD consumer of `gonogo.renderWith`, and the only
 * one that has to turn a value back into a file itself: the render path hands
 * the list to esbuild and `--with` goes through the same resolver, but a test
 * suite has no bundler.
 *
 * It was a bare `pathToFileURL(host)`, which is right for the relative form and
 * produces `<client dir>/@ksp-gonogo/uplink-tools/hosts` (the client directory
 * with the package name glued on the end) the moment a bare specifier became
 * legal. Nothing caught it, because the render path and this path had different
 * coverage: the specifier was tested through `resolveUplinkPackage` and
 * `generateEntry`, and never through here.
 *
 * So both shapes are exercised through THIS function, and the specifier case
 * plants a real installed package rather than mocking resolution.
 */
const scratch: string[] = [];
const workdir = () => {
  const dir = mkdtempSync(join(tmpdir(), "gonogo-hosts-"));
  scratch.push(dir);
  return dir;
};

afterEach(() => {
  for (const dir of scratch.splice(0))
    rmSync(dir, { recursive: true, force: true });
});

/** A client package declaring `renderWith`, plus a marker the module writes. */
function client(renderWith: string[]): { dir: string; marker: string } {
  const dir = workdir();
  const marker = join(dir, "loaded.txt");
  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify({
      name: "an-uplink-client",
      version: "1.0.0",
      gonogo: { renderWith },
    }),
  );
  mkdirSync(join(dir, "src"), { recursive: true });
  writeFileSync(join(dir, "src", "index.ts"), "export {};\n");
  return { dir, marker };
}

const writesMarker = (marker: string) =>
  `import { writeFileSync } from "node:fs";\n` +
  `writeFileSync(${JSON.stringify(marker)}, "yes");\n`;

describe("loadRenderHosts imports what renderWith names", () => {
  it("loads a RELATIVE path entry", async () => {
    const { dir, marker } = client(["./hosts.mjs"]);
    writeFileSync(join(dir, "hosts.mjs"), writesMarker(marker));

    await loadRenderHosts({ root: dir });

    expect(existsSync(marker)).toBe(true);
  });

  it("loads a bare SPECIFIER entry, resolved from the client", async () => {
    const { dir, marker } = client(["@example/hosts-pkg/hosts"]);
    // A real installed package, exports map and all: the defect was in
    // resolution, so mocking resolution would have tested nothing.
    const pkgDir = join(dir, "node_modules", "@example", "hosts-pkg");
    mkdirSync(join(pkgDir, "dist"), { recursive: true });
    writeFileSync(
      join(pkgDir, "package.json"),
      JSON.stringify({
        name: "@example/hosts-pkg",
        type: "module",
        version: "1.0.0",
        exports: { "./hosts": { import: "./dist/hosts.js" } },
      }),
    );
    writeFileSync(join(pkgDir, "dist", "hosts.js"), writesMarker(marker));

    await loadRenderHosts({ root: dir });

    expect(existsSync(marker)).toBe(true);
  });

  it("names the package when a specifier's package is not installed", async () => {
    const { dir } = client(["@example/absent/hosts"]);
    await expect(loadRenderHosts({ root: dir })).rejects.toThrow(
      /@example\/absent.*not installed/s,
    );
  });

  it("is a no-op for an Uplink that declares no hosts", async () => {
    const { dir } = client([]);
    await expect(loadRenderHosts({ root: dir })).resolves.toBeUndefined();
  });
});
