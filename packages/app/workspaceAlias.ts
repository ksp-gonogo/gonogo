import { existsSync, readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

// Resolve every @ksp-gonogo/* workspace package to its TypeScript source so
// Vite compiles it on-the-fly rather than serving pre-built dist files.
// This eliminates the stale-dist problem: the source is always current,
// no separate build step is needed before starting the dev server, and
// changes to any package are hot-reloaded exactly like app-local files.
//
// Workspace packages live in TWO places: `packages/*` (the app's own) and
// `mod/*/client` (each Uplink's client half: the `mod/*/client` entry in
// pnpm-workspace.yaml). Both are scanned, because "every @ksp-gonogo/*
// workspace package" above is the intent and an Uplink client is no less a
// workspace package for living beside its .cs. Scanning only `packages/*`
// silently downgraded any package that moved to an Uplink client from
// source-resolution to dist-resolution, which is what happened the first time a
// client moved out of `packages/` and in beside its own .cs.
const packagesDir = resolve(import.meta.dirname, "..");
const modDir = resolve(import.meta.dirname, "../../mod");

function aliasEntry(pkgDir: string): [string, string][] {
  const pkgJsonPath = resolve(pkgDir, "package.json");
  const srcIndex = resolve(pkgDir, "src/index.ts");
  if (!existsSync(pkgJsonPath) || !existsSync(srcIndex)) return [];
  const { name, exports: exportsMap } = JSON.parse(
    readFileSync(pkgJsonPath, "utf-8"),
  ) as { name: string; exports?: Record<string, unknown> };
  // Subpath entries (e.g. `./media` -> `./src/media/index.ts`) MUST precede
  // the bare package entry below: Vite's alias matcher treats a string `find`
  // as matching `importee === find` OR `importee.startsWith(find + "/")` and
  // takes the first array match, so if the bare `name` entry came first it
  // would swallow `name/media` too and append the literal "/media" onto the
  // resolved `src/index.ts` file path (ENOTDIR at build time). Only string-
  // valued subpaths are handled, every export in this repo's packages is one.
  const subpathEntries: [string, string][] = Object.entries(exportsMap ?? {})
    .filter(([key, value]) => key !== "." && typeof value === "string")
    .map(([key, value]) => [
      `${name}/${key.replace(/^\.\//, "")}`,
      resolve(pkgDir, value as string),
    ]);
  return [...subpathEntries, [name, srcIndex]];
}

/** Every workspace package's import specifiers, mapped to their TypeScript source. */
export function workspaceAliases(): Record<string, string> {
  return Object.fromEntries([
    ...readdirSync(packagesDir).flatMap((dir) =>
      aliasEntry(resolve(packagesDir, dir)),
    ),
    ...readdirSync(modDir).flatMap((dir) =>
      aliasEntry(resolve(modDir, dir, "client")),
    ),
  ]);
}
