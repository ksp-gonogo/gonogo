import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

/** The workspace package whose presence marks the root as gonogo itself. */
const MARKER_PACKAGE = "@ksp-gonogo/core";

interface Manifest {
  name?: string;
  private?: boolean;
  main?: string;
  types?: string;
  exports?: unknown;
}

function readManifest(dir: string): Manifest | undefined {
  try {
    return JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
  } catch {
    return undefined;
  }
}

function findWorkspaceRoot(fromDir: string): string | undefined {
  let dir = resolve(fromDir);
  for (;;) {
    if (existsSync(join(dir, "pnpm-workspace.yaml"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
}

/** The `packages:` globs of a pnpm-workspace.yaml, which is a flat list of quoted or bare paths. */
function workspaceGlobs(root: string): string[] {
  const globs: string[] = [];
  let inPackages = false;
  const lines = readFileSync(join(root, "pnpm-workspace.yaml"), "utf8").split(
    "\n",
  );
  for (const line of lines) {
    if (/^\S/.test(line)) {
      inPackages = /^packages:\s*$/.test(line);
      continue;
    }
    if (!inPackages) continue;
    const item = /^\s+-\s+['"]?([^'"#\s]+)['"]?/.exec(line);
    if (item && !item[1].startsWith("!")) globs.push(item[1]);
  }
  return globs;
}

/** Expands `dir/*` one level at a time, which is all pnpm's own globs here use. */
function expand(root: string, glob: string): string[] {
  const parts = glob.split("/").filter((part) => part !== "." && part !== "");
  let dirs = [root];
  for (const part of parts) {
    dirs =
      part === "*"
        ? dirs.flatMap((dir) =>
            existsSync(dir)
              ? readdirSync(dir, { withFileTypes: true })
                  .filter((entry) => entry.isDirectory())
                  .filter((entry) => entry.name !== "node_modules")
                  .map((entry) => join(dir, entry.name))
              : [],
          )
        : dirs.map((dir) => join(dir, part));
  }
  return dirs.filter((dir) => existsSync(join(dir, "package.json")));
}

function targetOf(target: unknown): string | undefined {
  if (typeof target === "string") return target;
  if (typeof target !== "object" || target === null) return undefined;
  const conditions = target as Record<string, unknown>;
  return targetOf(conditions.types ?? conditions.import ?? conditions.default);
}

const SOURCE_EXTENSIONS = [".ts", ".tsx", "/index.ts", "/index.tsx"];

/** The source file a built entry (`./dist/x.d.ts`) or a source entry (`./src/x.ts`) stands for. */
function sourceOf(packageDir: string, target: string): string | undefined {
  const inDist = target.replace(/^\.\/dist\//, "./src/");
  const bare = inDist.replace(/\.(d\.ts|d\.mts|js|mjs|cjs|ts|tsx)$/, "");
  if (!/^\.\/src\//.test(bare)) return undefined;
  for (const extension of SOURCE_EXTENSIONS) {
    const file = join(packageDir, bare + extension);
    if (existsSync(file)) return file;
  }
  return undefined;
}

/**
 * When `clientDir` is inside the gonogo workspace, the TypeScript `paths` that
 * send each private workspace package's import specifiers to its source rather
 * than its built `.d.ts`, so the scan can read the hooks those packages export.
 * Elsewhere there is no such workspace and the result is empty: an Uplink sees
 * only what the published packages ship in their reads index.
 */
export function workspaceSourcePaths(
  clientDir: string,
): Record<string, string[]> {
  const root = findWorkspaceRoot(clientDir);
  if (!root) return {};
  const packages = workspaceGlobs(root)
    .flatMap((glob) => expand(root, glob))
    .map((dir) => ({ dir, manifest: readManifest(dir) }));
  if (!packages.some(({ manifest }) => manifest?.name === MARKER_PACKAGE)) {
    return {};
  }
  const client = resolve(clientDir);
  const paths: Record<string, string[]> = {};
  for (const { dir, manifest } of packages) {
    if (!manifest?.name || manifest.private !== true) continue;
    if (client === dir || client.startsWith(`${dir}/`)) continue;
    const exported = manifest.exports;
    const entries: [string, unknown][] =
      typeof exported === "object" && exported !== null
        ? Object.entries(exported)
        : [[".", exported ?? manifest.types ?? manifest.main]];
    for (const [key, target] of entries) {
      if (key !== "." && !key.startsWith("./")) continue;
      if (key.includes("*")) continue;
      const entry = targetOf(target);
      const file = entry && sourceOf(dir, entry);
      if (file)
        paths[key === "." ? manifest.name : join(manifest.name, key)] = [file];
    }
  }
  return paths;
}
