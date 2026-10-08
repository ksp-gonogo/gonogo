#!/usr/bin/env node
/**
 * Writes `dist/reads-index.json` for the package in the current directory: what
 * each exported hook and component reads, found by running the `uplink-tools
 * check` scanner over the package's own source.
 *
 * The scanner is bundled from `packages/uplink-tools/src/check` on the spot
 * instead of imported from that package's build. `uplink-tools` depends on the
 * sdk and the kit, so the two builds that need this cannot wait for it.
 *
 * Usage, from a package directory:
 *   node <repo>/scripts/build-reads-index.mjs <package name> <entry,entry,...> [--framework-reads <export>]
 */
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { makeTempDir } from "./temp-dir.mjs";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const [packageName, entryList, ...rest] = process.argv.slice(2);
if (!packageName || !entryList) {
  console.error(
    "usage: build-reads-index.mjs <package name> <entry,entry,...> [--framework-reads <export>]",
  );
  process.exit(2);
}
const flag = rest.indexOf("--framework-reads");
const frameworkReadsExport = flag >= 0 ? rest[flag + 1] : undefined;

/* esbuild is a dependency of the package being built, not of the repo root. */
const { build } = await import(
  pathToFileURL(
    createRequire(join(process.cwd(), "package.json")).resolve("esbuild"),
  ).href
);

const work = makeTempDir("reads-index-");
try {
  const bundle = join(work, "scanner.mjs");
  await build({
    entryPoints: [
      join(repo, "packages/uplink-tools/src/check/reads-index-build.ts"),
    ],
    outfile: bundle,
    bundle: true,
    format: "esm",
    platform: "node",
    target: "node20",
    external: ["typescript"],
    logLevel: "error",
  });
  const { writeReadsIndex } = await import(pathToFileURL(bundle).href);
  const packageDir = process.cwd();
  const index = await writeReadsIndex({
    packageDir,
    packageName,
    entries: entryList.split(","),
    frameworkReadsExport,
    outFile: join(packageDir, "dist", "reads-index.json"),
  });
  console.log(
    `reads-index: ${Object.keys(index.entries).length} exports indexed for ${packageName}`,
  );
} catch (err) {
  console.error(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
}
