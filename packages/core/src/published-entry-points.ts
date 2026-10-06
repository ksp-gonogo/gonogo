import { readFileSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";
import { publishedPackageDirs } from "./type-parameter-names.scan";

const REPO_ROOT = join(import.meta.dirname, "..", "..", "..");

/**
 * Entry points that are published but are not an author surface, so no
 * reference page documents them.
 */
export const NOT_AUTHOR_SURFACE: Readonly<Record<string, readonly string[]>> = {
  // First-party runtime seams the app's import map resolves; CLAUDE.md names only /frames, /media and /testing as author subpaths.
  "@ksp-gonogo/sitrep-sdk": ["./spine", "./registry"],
};

export interface EntryPoint {
  /** The package name, such as `@ksp-gonogo/ui-kit`. */
  pkg: string;
  /** The package directory relative to the repo root. */
  dir: string;
  /** The export map key, such as `"."` or `"./testing"`. */
  subpath: string;
  /** The source file the entry point is built from. */
  file: string;
}

/** The source file an export map target is built from, or null for a non-TypeScript target. */
function sourceOf(pkgDir: string, target: string): string | null {
  const path = target.replace(/^\.\//, "");
  if (/\.(ts|tsx)$/.test(path) && !path.endsWith(".d.ts")) return path;
  if (!path.startsWith("dist/") || !path.endsWith(".d.ts")) return null;
  const stem = path.replace(/^dist\//, "src/").replace(/\.d\.ts$/, "");
  for (const ext of [".ts", ".tsx"]) {
    try {
      readFileSync(join(REPO_ROOT, pkgDir, stem + ext));
      return stem + ext;
    } catch {
      // Try the next extension.
    }
  }
  throw new Error(
    `${pkgDir}: export target ${target} has no source at ${stem}.ts(x)`,
  );
}

/** The types target of one export map value, whatever form it takes. */
function typesTarget(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (typeof value !== "object" || value === null) return null;
  for (const key of ["types", "import", "default"]) {
    const target: unknown = Reflect.get(value, key);
    if (typeof target === "string") return target;
  }
  return null;
}

/** A package manifest's name and export map, narrowed off the parsed JSON. */
function manifestOf(path: string): {
  name: string;
  exports: Record<string, unknown>;
} {
  const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
  if (typeof parsed !== "object" || parsed === null) {
    throw new Error(`${path} is not an object`);
  }
  const name: unknown = Reflect.get(parsed, "name");
  if (typeof name !== "string") throw new Error(`${path} has no name`);
  const exports: unknown = Reflect.get(parsed, "exports");
  if (typeof exports !== "object" || exports === null)
    return { name, exports: {} };
  return { name, exports: Object.fromEntries(Object.entries(exports)) };
}

/**
 * Every entry point of every published package, root first. By default only the
 * author-facing ones; `authorSurfaceOnly: false` also returns the first-party
 * runtime seams, which are in the export map and so are shipped all the same.
 */
export function publishedEntryPoints(
  root = REPO_ROOT,
  { authorSurfaceOnly = true }: { authorSurfaceOnly?: boolean } = {},
): EntryPoint[] {
  const entries: EntryPoint[] = [];
  for (const dir of publishedPackageDirs(root)) {
    const manifest = manifestOf(join(root, dir, "package.json"));
    const skipped = new Set(
      authorSurfaceOnly ? (NOT_AUTHOR_SURFACE[manifest.name] ?? []) : [],
    );
    const keys = Object.keys(manifest.exports).sort((a, b) =>
      a === "." ? -1 : b === "." ? 1 : a.localeCompare(b),
    );
    for (const subpath of keys) {
      if (skipped.has(subpath)) continue;
      const target = typesTarget(manifest.exports[subpath]);
      const file = target && sourceOf(dir, target);
      if (!file) continue;
      entries.push({ pkg: manifest.name, dir, subpath, file });
    }
  }
  return entries;
}

export function compilerOptions(
  pkgDir: string,
  root: string,
): ts.CompilerOptions {
  const configPath = join(root, pkgDir, "tsconfig.json");
  const parsed = ts.getParsedCommandLineOfConfigFile(configPath, undefined, {
    ...ts.sys,
    onUnRecoverableConfigFileDiagnostic: (d) => {
      throw new Error(ts.flattenDiagnosticMessageText(d.messageText, "\n"));
    },
  });
  if (!parsed) throw new Error(`cannot read ${configPath}`);
  return { ...parsed.options, noEmit: true };
}
