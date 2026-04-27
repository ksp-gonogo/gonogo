import { copyFileSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig, type PluginOption } from "vite";

const pkg = JSON.parse(
  readFileSync(resolve(__dirname, "package.json"), "utf-8"),
) as { version: string };

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

export default defineConfig({
  plugins: [react(), spaFallback()],
  base: process.env.VITE_BASE_PATH ?? "/",
  define: {
    __GONOGO_VERSION__: JSON.stringify(pkg.version),
    __GONOGO_BUILD_TIME__: JSON.stringify(new Date().toISOString()),
  },
});
