import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

/** The subpath each published package exports its reads index under. */
export const READS_INDEX_SUBPATH = "./reads-index.json";

/**
 * What an argument of a function names. `topic` and `command` are ids,
 * `handle` is an object with a `topic` member, `processor` is a processor
 * handle, and `series-key` is a `<topic>.<field>` key, which names a field
 * rather than a Topic.
 */
export type ArgumentKind =
  | "topic"
  | "command"
  | "handle"
  | "processor"
  | "series-key";

export interface IndexedArgument {
  index: number;
  kind: ArgumentKind;
}

/** What calling one exported function or mounting one exported component reads. */
export interface ReadsIndexEntry {
  reads: string[];
  families: string[];
  commands: string[];
  /** Parameters the function forwards to a read, so the caller's argument is what is read. */
  arguments: IndexedArgument[];
  /** What the scan could not name. A shipped index has none: the build refuses to write one. */
  unresolved: string[];
}

export interface ReadsIndex {
  version: 1;
  package: string;
  /** Reads that arrive through the named hook or component rather than the widget's own code. */
  frameworkReads: Record<string, string[]>;
  entries: Record<string, ReadsIndexEntry>;
}

export interface IndexLookup {
  index?: ReadsIndex;
  /** Why there is no index, when there is none. */
  problem?: string;
}

export interface IndexReader {
  /** The index of the package `specifier` names, found from the file that imports it. */
  lookup(specifier: string, fromFile: string): IndexLookup;
  /** The framework reads the installed sdk lists, or none when it ships no index. */
  frameworkReads(fromDir: string): Record<string, string[]>;
}

export const SDK_PACKAGE = "@ksp-gonogo/sitrep-sdk";

/** `@scope/name/sub` is the package `@scope/name`. */
export function packageNameOf(specifier: string): string {
  const parts = specifier.split("/");
  return specifier.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0];
}

function isIndex(value: unknown): value is ReadsIndex {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Partial<ReadsIndex>;
  return (
    v.version === 1 &&
    typeof v.package === "string" &&
    typeof v.entries === "object" &&
    v.entries !== null &&
    typeof v.frameworkReads === "object" &&
    v.frameworkReads !== null
  );
}

function exportTarget(target: unknown): string | undefined {
  if (typeof target === "string") return target;
  if (typeof target !== "object" || target === null) return undefined;
  const conditions = target as Record<string, unknown>;
  return exportTarget(conditions.import ?? conditions.default);
}

/** Node's search for `node_modules/<name>/package.json`, upward from `fromDir`. */
function packageDirOf(name: string, fromDir: string): string | undefined {
  let dir = resolve(fromDir);
  for (;;) {
    const candidate = join(dir, "node_modules", name);
    if (existsSync(join(candidate, "package.json"))) return candidate;
    const parent = dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
}

/** Reads each package's index once, from where the package's export map says it is. */
export function createIndexReader(): IndexReader {
  const cache = new Map<string, IndexLookup>();

  const lookup: IndexReader["lookup"] = (specifier, fromFile) => {
    const name = packageNameOf(specifier);
    const dir = packageDirOf(name, dirname(fromFile));
    const key = `${dir ?? ""}|${name}|${dirname(fromFile)}`;
    const cached = cache.get(key);
    if (cached) return cached;
    const found = ((): IndexLookup => {
      if (!dir) return { problem: `${name} is not installed` };
      let manifest: { exports?: Record<string, unknown> };
      try {
        manifest = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
      } catch {
        return { problem: `${name}'s package.json cannot be read` };
      }
      const target = exportTarget(manifest.exports?.[READS_INDEX_SUBPATH]);
      if (!target) {
        return {
          problem: `the installed ${name} does not export ${READS_INDEX_SUBPATH}`,
        };
      }
      const file = join(dir, target);
      if (!existsSync(file)) {
        return {
          problem: `${file} does not exist, so ${name} has not been built`,
        };
      }
      try {
        const parsed: unknown = JSON.parse(readFileSync(file, "utf8"));
        return isIndex(parsed)
          ? { index: parsed }
          : { problem: `${file} is not a reads index this check understands` };
      } catch {
        return { problem: `${file} is not valid JSON` };
      }
    })();
    cache.set(key, found);
    return found;
  };

  return {
    lookup,
    frameworkReads: (fromDir) =>
      lookup(SDK_PACKAGE, join(fromDir, "index.ts")).index?.frameworkReads ??
      {},
  };
}
