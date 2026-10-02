import { readFileSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import ts from "typescript";
import { publishedPackageDirs } from "./type-parameter-names.scan";

/**
 * The scan behind `styleguide-published-doc-coverage.test.ts`: every symbol a
 * published entry point exports, and whether it carries a doc comment and an
 * `@category` tag.
 *
 * The reference site is generated from these comments, one page per
 * `@category`, so an export with no comment has no reference text and one with
 * no category has no page to appear on.
 *
 * A symbol is graded under the first entry point of the package that exports
 * it, and only by the package it is declared in when that is another published
 * package, which grades it there. A symbol declared in a private package and
 * re-exported (theme tokens through ui-kit, widgets through uplink-tools) is
 * graded under the published entry that ships it, since that is where an
 * author reads it. A symbol declared by a third-party package and passed
 * through (Testing Library through the sdk's `/testing`) is not graded: its
 * documentation is that package's own.
 */

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

export interface DocFault {
  name: string;
  /** What the export lacks. */
  missing: "doc" | "category";
}

export interface DocCoverageScan {
  /** Every entry point graded; empty means discovery failed. */
  entries: EntryPoint[];
  /** Faults by package, then by `subpath:name`. */
  faults: Map<string, Map<string, DocFault["missing"]>>;
  /** Exports graded, counted over every entry point. */
  graded: number;
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

/** Every author-facing entry point of every published package, root first. */
export function publishedEntryPoints(root = REPO_ROOT): EntryPoint[] {
  const entries: EntryPoint[] = [];
  for (const dir of publishedPackageDirs(root)) {
    const manifest = manifestOf(join(root, dir, "package.json"));
    const skipped = new Set(NOT_AUTHOR_SURFACE[manifest.name] ?? []);
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

/**
 * The faults among what `entryFile` exports, by export name. `graded` holds
 * the symbols already graded under an earlier entry of the same package, and
 * receives this entry's; `declaredElsewhere` says whether a declaration file
 * belongs to another published package, which grades the symbol itself.
 */
export function faultsOfEntry(
  program: ts.Program,
  entryFile: string,
  graded: Set<ts.Symbol>,
  declaredElsewhere: (file: string) => boolean,
): { faults: DocFault[]; count: number } {
  const checker = program.getTypeChecker();
  const sf = program.getSourceFile(entryFile);
  if (!sf) throw new Error(`the program has no ${entryFile}`);
  const moduleSymbol = checker.getSymbolAtLocation(sf);
  if (!moduleSymbol) return { faults: [], count: 0 };
  const faults: DocFault[] = [];
  let count = 0;
  for (const exported of checker.getExportsOfModule(moduleSymbol)) {
    const symbol =
      exported.flags & ts.SymbolFlags.Alias
        ? checker.getAliasedSymbol(exported)
        : exported;
    if (graded.has(symbol)) continue;
    graded.add(symbol);
    const files = (symbol.declarations ?? []).map(
      (d) => d.getSourceFile().fileName,
    );
    const notOurs = (file: string) =>
      declaredElsewhere(file) || file.includes("/node_modules/");
    if (files.length > 0 && files.every(notOurs)) continue;
    count += 1;
    const doc = ts
      .displayPartsToString(symbol.getDocumentationComment(checker))
      .trim();
    if (doc === "") {
      faults.push({ name: exported.name, missing: "doc" });
      continue;
    }
    const tags = symbol.getJsDocTags(checker);
    if (!tags.some((tag) => tag.name === "category")) {
      faults.push({ name: exported.name, missing: "category" });
    }
  }
  return { faults, count };
}

/** Grades every published entry point. */
export function scanPublishedDocCoverage(root = REPO_ROOT): DocCoverageScan {
  const entries = publishedEntryPoints(root);
  const publishedDirs = [...new Set(entries.map((e) => e.dir))];
  const packageOf = (file: string): string | null => {
    const rel = relative(root, file).split(sep).join("/");
    return publishedDirs.find((dir) => rel.startsWith(`${dir}/`)) ?? null;
  };
  const faults = new Map<string, Map<string, DocFault["missing"]>>();
  let total = 0;
  for (const dir of publishedDirs) {
    const own = entries.filter((e) => e.dir === dir);
    const program = ts.createProgram(
      own.map((e) => join(root, dir, e.file)),
      compilerOptions(dir, root),
    );
    const graded = new Set<ts.Symbol>();
    const declaredElsewhere = (file: string) => {
      const owner = packageOf(file);
      return owner !== null && owner !== dir;
    };
    for (const entry of own) {
      const { faults: found, count } = faultsOfEntry(
        program,
        join(root, dir, entry.file),
        graded,
        declaredElsewhere,
      );
      total += count;
      const byName = faults.get(entry.pkg) ?? new Map();
      for (const fault of found) {
        byName.set(`${entry.subpath}:${fault.name}`, fault.missing);
      }
      faults.set(entry.pkg, byName);
    }
  }
  return { entries, faults, graded: total };
}

/**
 * A planted module, graded by the same function: `undocumented` and
 * `uncategorised` must fail, and `documented` and the third-party `passedOn`
 * must not.
 */
export function gradePlant(): DocFault[] {
  const file = join(dirname(REPO_ROOT), "__doc_coverage_plant__.ts");
  const libDir = join(dirname(REPO_ROOT), "node_modules", "__plant_lib__");
  const lib = join(libDir, "index.d.ts");
  const libText = "export declare const passedOn: number;";
  const text = [
    'export { passedOn } from "./node_modules/__plant_lib__/index";',
    "export function undocumented(): void {}",
    "/** Has a comment and no category. */",
    "export const uncategorised = 1;",
    "/**",
    " * Has both.",
    " *",
    " * @category Planted",
    " */",
    "export const documented = 2;",
  ].join("\n");
  const host = ts.createCompilerHost({});
  const getSourceFile = host.getSourceFile.bind(host);
  const planted = new Map([
    [file, text],
    [lib, libText],
  ]);
  host.getSourceFile = (name, version) => {
    const source = planted.get(name);
    return source === undefined
      ? getSourceFile(name, version)
      : ts.createSourceFile(name, source, version);
  };
  host.fileExists = (name) => planted.has(name) || ts.sys.fileExists(name);
  host.readFile = (name) => planted.get(name) ?? ts.sys.readFile(name);
  host.directoryExists = (name) =>
    libDir.startsWith(name) || (ts.sys.directoryExists?.(name) ?? false);
  const program = ts.createProgram([file], { noEmit: true }, host);
  return faultsOfEntry(program, file, new Set(), () => false).faults;
}

/** The debt list as `published-doc-coverage.debt.json` holds it: one sorted list per package. */
export function debtJson(
  debt: Readonly<Record<string, readonly string[]>>,
): string {
  const sorted = Object.fromEntries(
    Object.keys(debt)
      .sort()
      .map((pkg) => [pkg, [...debt[pkg]].sort()]),
  );
  return `${JSON.stringify(sorted, null, 2)}\n`;
}
