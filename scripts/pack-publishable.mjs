#!/usr/bin/env node
/**
 * Pack a workspace package into the tarball a CONSUMER should receive.
 *
 * ## Why this exists
 *
 * `mod/sitrep-sdk` declares `"main": "src/index.ts"` with an `exports` map
 * pointing at `./src/*.ts`, because the workspace consumes the SDK as source,
 * and a `publishConfig` block that redirects both at `./dist/*.js` for
 * consumers. That is the pnpm convention and pnpm honours it.
 *
 * **npm does not.** `npm publish` treats `publishConfig` as *config* (registry,
 * tag, access) and flattens it into its own options; it never rewrites manifest
 * fields. Run `npm publish --dry-run` in that package and npm says so outright:
 *
 *     npm warn Unknown publishConfig config "main".
 *     npm warn Unknown publishConfig config "types".
 *     npm warn Unknown publishConfig config "exports".
 *
 * `release.yml` publishes with npm, for OIDC provenance. So the tarball it would
 * upload carries the SOURCE-pointing manifest, and `files` ships `src`, so the
 * package resolves and hands raw TypeScript to every consumer's bundler. It
 * would not fail at install time, which is the worst version of this: it fails
 * later, in somebody else's build, for a reason that points at their tooling.
 *
 * ## What it does
 *
 * `npm pack` the package, extract it, apply the `publishConfig` field overrides
 * to the extracted manifest, drop those keys, and re-tar. The FILE SET is
 * whatever npm chose, untouched: only the manifest changes, so nothing here can
 * quietly add or drop a file. `verify-package-artifact.mjs` then gates the
 * result, and its check 4 fails on exactly the manifest this script exists to
 * prevent, so the two are not redundant: one produces the tarball, the other
 * refuses to believe it.
 *
 * A package with no `publishConfig` field overrides (ui-kit, whose manifest
 * already points at `dist`) passes straight through, re-tarred but unchanged.
 *
 * Usage: node scripts/pack-publishable.mjs <package-dir> <out-dir>
 * Prints the resulting tarball path on stdout.
 */

import { execFileSync } from "node:child_process";
import {
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

/**
 * Manifest fields npm ignores inside `publishConfig` but pnpm applies.
 *
 * `registry`, `tag`, `access` and `provenance` are real npm CONFIG and must be
 * left where they are: moving one to the top level would change what npm does,
 * not what a consumer sees.
 */
const OVERRIDE_FIELDS = [
  "main",
  "module",
  "types",
  "typings",
  "browser",
  "exports",
  "bin",
  "files",
  "imports",
];

const [pkgDir, outDir] = process.argv.slice(2);
if (!pkgDir || !outDir) {
  console.error(
    "usage: node scripts/pack-publishable.mjs <package-dir> <out-dir>",
  );
  process.exit(2);
}

const staging = mkdtempSync(join(tmpdir(), "gonogo-pack-"));
try {
  execFileSync("npm", ["pack", "--pack-destination", staging], {
    cwd: resolve(pkgDir),
    stdio: ["ignore", "ignore", "inherit"],
  });
  const packed = readdirSync(staging).filter((f) => f.endsWith(".tgz"));
  if (packed.length !== 1) {
    throw new Error(
      `expected exactly one tarball from npm pack, got ${packed.length}`,
    );
  }
  const tarball = join(staging, packed[0]);

  const extracted = join(staging, "x");
  execFileSync("mkdir", ["-p", extracted]);
  execFileSync("tar", ["-xzf", tarball, "-C", extracted]);

  const manifestPath = join(extracted, "package", "package.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const publishConfig = manifest.publishConfig ?? {};

  const applied = [];
  for (const field of OVERRIDE_FIELDS) {
    if (field in publishConfig) {
      manifest[field] = publishConfig[field];
      delete publishConfig[field];
      applied.push(field);
    }
  }
  // Keep a `publishConfig` that still holds real npm config; drop an empty one
  // rather than shipping `"publishConfig": {}`.
  if (Object.keys(publishConfig).length > 0) {
    manifest.publishConfig = publishConfig;
  } else {
    delete manifest.publishConfig;
  }
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

  execFileSync("mkdir", ["-p", resolve(outDir)]);
  const out = join(resolve(outDir), packed[0]);
  execFileSync("tar", ["-czf", out, "-C", extracted, "package"]);

  console.error(
    applied.length > 0
      ? `pack-publishable: applied publishConfig -> ${applied.join(", ")} for ${manifest.name}@${manifest.version}`
      : `pack-publishable: ${manifest.name}@${manifest.version} declares no publishConfig field overrides, manifest unchanged`,
  );
  console.log(out);
} finally {
  rmSync(staging, { recursive: true, force: true });
}
