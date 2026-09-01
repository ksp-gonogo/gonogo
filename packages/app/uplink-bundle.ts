import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { UPLINK_BUNDLE_EXTERNALS } from "@ksp-gonogo/sitrep-sdk/uplink-externals";

/**
 * The bytes of one Uplink client bundle, and the hash three parties compare.
 *
 * `integrity` is `sha256-<hex>` of exactly what was written to `outFile`: the
 * form the registry index records, the loader checks fetched bytes against, and
 * `ExpectedClientHash.g.cs` bakes into the mod.
 */
export interface UplinkClientBundle {
  outFile: string;
  integrity: string;
  bytes: Buffer;
}

/**
 * Build one Uplink client into the standalone ESM bundle the app `import()`s.
 *
 * This is the ONLY bundler in the repo for these bytes, and that is the point.
 * Three parties compare a hash of this output: the registry index the app's
 * build writes, the bytes the loader fetches, and the `ExpectedClientHash` the
 * mod bakes at release. A second bundler with its own esbuild options makes the
 * mod vouch for bytes nobody serves, and a hash that cannot match is worse than
 * no hash at all: it fails as tampering, on every load, for a correctly
 * installed mod.
 *
 * esbuild is resolved from the CLIENT rather than from the app, so the bundle a
 * release hashes is built by the version that client has pinned.
 */
export async function buildUplinkClientBundle({
  clientDir,
  outFile,
}: {
  clientDir: string;
  outFile: string;
}): Promise<UplinkClientBundle> {
  const clientRequire = createRequire(resolve(clientDir, "package.json"));
  const { build } = clientRequire("esbuild") as typeof import("esbuild");

  mkdirSync(dirname(outFile), { recursive: true });
  await build({
    entryPoints: [resolve(clientDir, "src/index.ts")],
    outfile: outFile,
    bundle: true,
    format: "esm",
    platform: "browser",
    target: "es2022",
    jsx: "automatic",
    external: [...UPLINK_BUNDLE_EXTERNALS],
    plugins: [cssInjectPlugin],
    logLevel: "warning",
  });

  const bytes = readFileSync(outFile);
  const integrity = `sha256-${createHash("sha256").update(bytes).digest("hex")}`;
  writeFileSync(`${outFile}.sha256`, `${integrity}\n`);
  return { outFile, integrity, bytes };
}

/**
 * Inline every CSS import as a self-injecting `<style>`, folded INTO the single
 * hashed JS bundle, mirroring what Vite does for the app's own static imports.
 *
 * Without this esbuild emits a sibling `<id>.client.css` the runtime
 * `import(bundleUrl)` never applies (the loader fetches only the JS), so a
 * loaded Uplink with a stylesheet (kOS's xterm.css) renders unstyled. Folding it
 * in also keeps the whole client under ONE integrity hash. xterm.css is
 * self-contained: no `@import`/`url()` to resolve; a future CSS that isn't would
 * need esbuild's real CSS pipeline instead of this raw-text inline.
 */
const cssInjectPlugin: import("esbuild").Plugin = {
  name: "gonogo-css-inject",
  setup(pluginBuild) {
    pluginBuild.onLoad({ filter: /\.css$/ }, (args) => {
      const css = readFileSync(args.path, "utf8");
      const contents =
        `if (typeof document !== "undefined") {` +
        `const s = document.createElement("style");` +
        `s.textContent = ${JSON.stringify(css)};` +
        `document.head.appendChild(s);` +
        `}`;
      return { contents, loader: "js" };
    });
  },
};
