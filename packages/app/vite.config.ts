import { copyFileSync, existsSync, readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig, type PluginOption } from "vite";

// Resolve every @gonogo/* workspace package to its TypeScript source so
// Vite compiles it on-the-fly rather than serving pre-built dist files.
// This eliminates the stale-dist problem: the source is always current,
// no separate build step is needed before starting the dev server, and
// changes to any package are hot-reloaded exactly like app-local files.
const packagesDir = resolve(__dirname, "..");
const workspaceAlias = Object.fromEntries(
  readdirSync(packagesDir).flatMap((dir) => {
    const pkgJsonPath = resolve(packagesDir, dir, "package.json");
    const srcIndex = resolve(packagesDir, dir, "src/index.ts");
    if (!existsSync(pkgJsonPath) || !existsSync(srcIndex)) return [];
    const { name } = JSON.parse(readFileSync(pkgJsonPath, "utf-8")) as {
      name: string;
    };
    return [[name, srcIndex]];
  }),
);

const pkg = JSON.parse(
  readFileSync(resolve(__dirname, "package.json"), "utf-8"),
) as { version: string };

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
      .replaceAll("%GONOGO_VERSION%", pkg.version)
      .replaceAll("%GONOGO_BUILD_TIME%", BUILD_TIME);
  },
});

export default defineConfig({
  plugins: [react(), versionMeta(), spaFallback()],
  resolve: { alias: workspaceAlias },
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
    __GONOGO_VERSION__: JSON.stringify(pkg.version),
    __GONOGO_BUILD_TIME__: JSON.stringify(BUILD_TIME),
  },
});
