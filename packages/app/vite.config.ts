import { createHash } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import react from "@vitejs/plugin-react";
import browserslistToEsbuild from "browserslist-to-esbuild";
import { defineConfig, type PluginOption } from "vite";

// Resolve every @ksp-gonogo/* workspace package to its TypeScript source so
// Vite compiles it on-the-fly rather than serving pre-built dist files.
// This eliminates the stale-dist problem: the source is always current,
// no separate build step is needed before starting the dev server, and
// changes to any package are hot-reloaded exactly like app-local files.
//
// Workspace packages live in TWO places: `packages/*` (the app's own) and
// `mod/*/client` (each Uplink's client half — the `mod/*/client` entry in
// pnpm-workspace.yaml). Both are scanned, because "every @ksp-gonogo/*
// workspace package" above is the intent and an Uplink client is no less a
// workspace package for living beside its .cs. Scanning only `packages/*`
// silently downgraded any package that moved to an Uplink client from
// source-resolution to dist-resolution — which is what happened when the
// kerbcast client moved to mod/GonogoKerbcastUplink/client.
const packagesDir = resolve(__dirname, "..");
const modDir = resolve(__dirname, "../../mod");

function aliasEntry(pkgDir: string): [string, string][] {
  const pkgJsonPath = resolve(pkgDir, "package.json");
  const srcIndex = resolve(pkgDir, "src/index.ts");
  if (!existsSync(pkgJsonPath) || !existsSync(srcIndex)) return [];
  const { name } = JSON.parse(readFileSync(pkgJsonPath, "utf-8")) as {
    name: string;
  };
  return [[name, srcIndex]];
}

const workspaceAlias = Object.fromEntries([
  ...readdirSync(packagesDir).flatMap((dir) =>
    aliasEntry(resolve(packagesDir, dir)),
  ),
  ...readdirSync(modDir).flatMap((dir) =>
    aliasEntry(resolve(modDir, dir, "client")),
  ),
]);

const pkg = JSON.parse(
  readFileSync(resolve(__dirname, "package.json"), "utf-8"),
) as { version: string };

function readPkgVersion(pkgJsonPath: string): string {
  return (JSON.parse(readFileSync(pkgJsonPath, "utf-8")) as { version: string })
    .version;
}

// The app's compat identity — the values a runtime-loaded Uplink is gated
// against BEFORE `import()` (design §5 step 3 / §6.3). Single-sourced here and
// exposed to the app via `define` below AND written into the local registry
// fixture by the uplink-bundle plugin, so the host and the descriptor can never
// drift in Phase A. See src/uplinks/hostCompat.ts.
//   • apiVersion  — the @ksp-gonogo extension-API surface, tracked by sitrep-sdk's
//     version today (a dedicated EXTENSION_API_VERSION + TS api-shape gate is the
//     sdk-one-import §6 follow-up; sitrep-sdk's version is the honest marker now).
//   • uiKitVersion — @ksp-gonogo/ui-kit.
//   • contractMajor — mirrors the C# ContractVersion.Major stamp (Sitrep.Contract's
//     `ContractVersion.Major`, currently 4). Held as an app constant; both the host
//     `define` and the registry fixture read it, so host and descriptor still agree.
const HOST_API_VERSION = readPkgVersion(
  resolve(modDir, "sitrep-sdk/package.json"),
);
const HOST_UIKIT_VERSION = readPkgVersion(
  resolve(packagesDir, "ui-kit/package.json"),
);
const HOST_CONTRACT_MAJOR = 4;

// The first-party Uplink clients built as standalone, runtime-loadable ESM
// bundles (Phase B: scansat + kos — the loader was proven on scansat first in
// Phase A, design §6). Each is emitted to public/uplinks/<id>.client.js and
// recorded in the local registry fixture. Adding another Uplink here is the
// whole change.
const UPLINK_BUNDLE_TARGETS: {
  id: string;
  name: string;
  author: string;
  repo: string;
  clientDir: string;
}[] = [
  {
    id: "scansat",
    name: "SCANsat",
    author: "jonpepler",
    repo: "ksp-gonogo/GonogoScansatUplink",
    clientDir: resolve(modDir, "GonogoScansatUplink/client"),
  },
  {
    id: "kos",
    name: "kOS",
    author: "jonpepler",
    repo: "ksp-gonogo/GonogoKosUplink",
    clientDir: resolve(modDir, "GonogoKosUplink/client"),
  },
  {
    id: "kerbcast",
    name: "Kerbcast",
    author: "jonpepler",
    repo: "ksp-gonogo/GonogoKerbcastUplink",
    clientDir: resolve(modDir, "GonogoKerbcastUplink/client"),
  },
];

// The app emits one standalone ESM "external-entry" chunk per shared package
// (src/uplinks/externals/*.ts). Each re-exports the app's OWN module, and — because
// a single Rollup build keeps every module in exactly one chunk — the chunk shares
// the app's singleton instance (core's registry Maps, React's dispatcher, the
// styled-components stylesheet). A runtime-loaded Uplink bundle built with these
// specifiers `external` resolves its bare imports to these chunks via the baked
// import map, registering into the SAME registry the app reads. Design §2.2.
const externalsDir = resolve(__dirname, "src/uplinks/externals");
const UPLINK_EXTERNALS: {
  specifier: string;
  entryName: string;
  file: string;
}[] = (
  [
    ["react", "ext-react"],
    ["react-dom", "ext-react-dom"],
    ["react/jsx-runtime", "ext-react-jsx-runtime"],
    ["styled-components", "ext-styled-components"],
    ["@ksp-gonogo/core", "ext-core"],
    ["@ksp-gonogo/components", "ext-components"],
    ["@ksp-gonogo/data", "ext-data"],
    ["@ksp-gonogo/ui", "ext-ui"],
    ["@ksp-gonogo/ui-kit", "ext-ui-kit"],
    ["@ksp-gonogo/sitrep-client", "ext-sitrep-client"],
    ["@ksp-gonogo/sitrep-sdk", "ext-sitrep-sdk"],
    ["@ksp-gonogo/logger", "ext-logger"],
  ] as const
).map(([specifier, entryName]) => ({
  specifier,
  entryName,
  file: resolve(externalsDir, `${entryName}.ts`),
}));

// Build each first-party Uplink client into a standalone ESM bundle with every
// shared package externalised, hash it, and write the local registry fixture the
// loader reads in Phase A. Runs at build only (`apply: "build"`) via buildStart,
// so `public/uplinks/` is populated before Vite copies publicDir into dist. In
// dev the loader is not exercised — the bundled static-import path is the default.
const uplinkBundles = (): PluginOption => ({
  name: "gonogo-uplink-bundles",
  apply: "build",
  async buildStart() {
    const outDir = resolve(__dirname, "public/uplinks");
    mkdirSync(outDir, { recursive: true });
    // esbuild is a devDependency of each Uplink client (not the app); resolve it
    // from the first target so the app need not depend on it directly.
    const firstClient = UPLINK_BUNDLE_TARGETS[0]?.clientDir;
    if (!firstClient) return;
    const clientRequire = createRequire(resolve(firstClient, "package.json"));
    const esbuild = clientRequire("esbuild") as typeof import("esbuild");
    const { build } = esbuild;

    // Inline every CSS import as a self-injecting <style>, folded INTO the single
    // hashed JS bundle — mirroring what Vite does on the bundled static-import
    // path. Without this esbuild emits a sibling `<id>.client.css` the runtime
    // `import(bundleUrl)` never applies (the loader fetches only the JS), so a
    // loaded Uplink with a stylesheet (kOS's xterm.css) renders unstyled. Folding
    // it in also keeps the whole client under ONE integrity hash. (xterm.css is
    // self-contained — no @import/url() to resolve; a future CSS that isn't would
    // need esbuild's real CSS pipeline instead of this raw-text inline.)
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

    const external = UPLINK_EXTERNALS.map((e) => e.specifier).concat([
      "react-dom/client",
      "react/jsx-dev-runtime",
    ]);

    const entries: Record<string, unknown>[] = [];
    for (const target of UPLINK_BUNDLE_TARGETS) {
      const entry = resolve(target.clientDir, "src/index.ts");
      const outFile = resolve(outDir, `${target.id}.client.js`);
      await build({
        entryPoints: [entry],
        outfile: outFile,
        bundle: true,
        format: "esm",
        platform: "browser",
        target: "es2022",
        jsx: "automatic",
        external,
        plugins: [cssInjectPlugin],
        logLevel: "warning",
      });
      const bytes = readFileSync(outFile);
      const integrity = `sha256-${createHash("sha256").update(bytes).digest("hex")}`;
      writeFileSync(`${outFile}.sha256`, `${integrity}\n`);
      const base = process.env.VITE_BASE_PATH ?? "/";
      entries.push({
        id: target.id,
        name: target.name,
        author: target.author,
        repo: target.repo,
        versions: [
          {
            version: pkg.version,
            minAppVersion: pkg.version,
            apiVersion: HOST_API_VERSION,
            uiKitVersion: HOST_UIKIT_VERSION,
            contractMajor: HOST_CONTRACT_MAJOR,
            // Phase A: bundle is co-located under the app's own public/. Phase D
            // swaps this for the author's GitHub release-asset URL; the loader's
            // registry seam already treats bundleUrl as opaque.
            bundleUrl: `${base}uplinks/${target.id}.client.js`,
            integrity,
            // H_mod half of the three-way check (design §3.3). Baked once the mod
            // ships expectedClientHash on system.uplinks (Phase B); until then the
            // loader enforces the two-way index==bytes check and records the
            // mod-hash arm as pending. Mirror it here so review can reconcile.
            expectedClientHash: null,
          },
        ],
      });
    }
    writeFileSync(
      resolve(outDir, "registry.local.json"),
      `${JSON.stringify({ generatedAt: BUILD_TIME, uplinks: entries }, null, 2)}\n`,
    );
    this.info?.(
      `gonogo-uplink-bundles: emitted ${entries.length} Uplink client bundle(s) + registry.local.json`,
    );
  },
});

// Bake a native <script type="importmap"> into index.html at build time, mapping
// each Uplink-external bare specifier to its emitted external-entry chunk URL.
// Follows the exact `versionMeta()` transformIndexHtml precedent below; only runs
// at build (the emitted chunks exist only in `dist`), so `pnpm dev` serves the app
// unchanged via the bundled static-import path. Design §2.2b / L1 (static-baked).
const uplinkImportMap = (): PluginOption => ({
  name: "gonogo-uplink-importmap",
  apply: "build",
  transformIndexHtml: {
    order: "post",
    handler(html, ctx) {
      const base = process.env.VITE_BASE_PATH ?? "/";
      const imports: Record<string, string> = {};
      for (const ext of UPLINK_EXTERNALS) {
        // Match the ENTRY chunk specifically: a re-export entry can split into an
        // entry chunk plus an inner (CJS-interop) chunk that share the same
        // `name`; only the entry chunk carries the full named-export surface.
        const chunk = Object.values(ctx.bundle ?? {}).find(
          (c) => c.type === "chunk" && c.isEntry && c.name === ext.entryName,
        );
        if (chunk && chunk.type === "chunk") {
          imports[ext.specifier] = `${base}${chunk.fileName}`;
        }
      }
      const tag = `<script type="importmap">${JSON.stringify({ imports })}</script>`;
      return html.replace("</head>", `    ${tag}\n  </head>`);
    },
  },
});

// Dev-channel builds append a prerelease suffix (e.g. "-dev.a1b2c3d") so a
// deployed dev station is distinguishable from the release it forked from —
// in the hello handshake, the host's station chips, and the page meta tags.
// compareVersions ignores the suffix, so dev↔release of the same base
// version interoperate silently; a bumped release shows the mismatch banner.
const VERSION = `${pkg.version}${process.env.GONOGO_VERSION_SUFFIX ?? ""}`;

const BUILD_TIME = new Date().toISOString();

// GitHub Pages has no server-side routing: a direct hit on /gonogo/station
// returns 404 because no station/index.html exists. Pages falls back to
// 404.html, so ship a byte-for-byte copy of index.html under that name and
// the SPA boots for every route.
const spaFallback = (): PluginOption => ({
  name: "gonogo-spa-fallback",
  apply: "build",
  closeBundle() {
    const outDir = resolve(__dirname, "dist");
    copyFileSync(resolve(outDir, "index.html"), resolve(outDir, "404.html"));
  },
});

// Replace `%GONOGO_VERSION%` / `%GONOGO_BUILD_TIME%` placeholders in the HTML
// shell so the live page exposes the version as meta tags. Lets operators
// confirm a deploy without opening dev-tools.
const versionMeta = (): PluginOption => ({
  name: "gonogo-version-meta",
  transformIndexHtml(html) {
    return html
      .replaceAll("%GONOGO_VERSION%", VERSION)
      .replaceAll("%GONOGO_BUILD_TIME%", BUILD_TIME);
  },
});

export default defineConfig({
  plugins: [
    react(),
    versionMeta(),
    uplinkBundles(),
    uplinkImportMap(),
    spaFallback(),
  ],
  resolve: { alias: workspaceAlias },
  build: {
    // Transpile the bundle for the supported matrix in `.browserslistrc`.
    target: browserslistToEsbuild(),
    rollupOptions: {
      // FINDING (R1 spike): Rollup tree-shakes re-exports of `export * from "X"`
      // that no in-build consumer imports — so a singleton the app never uses
      // directly (e.g. core's `AugmentSlot`) would be dropped from the
      // external-entry chunk, and a runtime Uplink that needs it fails to link
      // ("does not provide an export named 'AugmentSlot'"). "strict" preserves the
      // full external-entry export signature for runtime importers Rollup can't see.
      preserveEntrySignatures: "strict",
      // Emit the app entry PLUS one external-entry chunk per shared package. Rollup
      // keeps each shared module in a single chunk, so these re-export the app's
      // singletons rather than duplicating them (design §2.2 / §2.3).
      input: {
        index: resolve(__dirname, "index.html"),
        ...Object.fromEntries(
          UPLINK_EXTERNALS.map((e) => [e.entryName, e.file]),
        ),
      },
    },
  },
  base: process.env.VITE_BASE_PATH ?? "/",
  // Bind to 0.0.0.0 so phones / second laptops on the same LAN can hit the
  // dev server at http://<host-lan-ip>:5173. Vite prints both the local and
  // network URLs at startup. Default is 127.0.0.1, which is why station
  // devices couldn't reach the dev build over wifi.
  server: { host: true },
  // Same LAN-binding rationale as `server` — `pnpm play` serves the
  // production build via `vite preview`, and a phone on the wifi
  // needs to reach `http://<host-lan-ip>:4173/station?host=...`
  // when not using the deployed github.io page directly.
  preview: { host: true },
  define: {
    __GONOGO_VERSION__: JSON.stringify(VERSION),
    __GONOGO_BUILD_TIME__: JSON.stringify(BUILD_TIME),
    // The app's Uplink-compat identity — read by src/uplinks/hostCompat.ts and
    // gated against a descriptor's declared versions before any bundle is loaded.
    __GONOGO_API_VERSION__: JSON.stringify(HOST_API_VERSION),
    __GONOGO_UIKIT_VERSION__: JSON.stringify(HOST_UIKIT_VERSION),
    __GONOGO_CONTRACT_MAJOR__: JSON.stringify(HOST_CONTRACT_MAJOR),
  },
});
