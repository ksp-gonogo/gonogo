import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import ts from "typescript";
import {
  compilerOptions,
  publishedEntryPoints,
} from "./published-doc-coverage.scan";

/**
 * The scan behind `styleguide-published-intent.test.ts`: every symbol a
 * published entry point exports, whether any source file other than its own
 * declaration and the entry barrels names it, and whether its doc comment
 * carries an `@intent` tag stating why it is published anyway.
 *
 * Only value exports are graded: a type is consumed through the signature of
 * the value that takes it, which no identifier search sees.
 *
 * An export with a consumer is deliberate by use. One with none is either
 * plumbing kept for a third party to build a representation of its own, which
 * `@intent` records, or dead surface, which the ratchet makes a decision.
 */

const REPO_ROOT = join(import.meta.dirname, "..", "..", "..");

export interface IntentFault {
  /** `subpath:name`, the key the debt list holds. */
  key: string;
}

export interface IntentScan {
  /** Faults by package. */
  faults: Map<string, Set<string>>;
  /** Exports graded. */
  graded: number;
  /** Exports with no consumer that carry an `@intent`. */
  declared: number;
}

const IDENTIFIER = /[A-Za-z_$][A-Za-z0-9_$]*/g;

/** The tracked source files, as the set of identifiers each mentions. */
function identifierIndex(root: string): Map<string, Set<string>> {
  const files = execFileSync("git", ["ls-files", "*.ts", "*.tsx", "*.mts"], {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  })
    .split("\n")
    .filter(
      (f) => f !== "" && !f.endsWith(".d.ts") && !/\.stories\.tsx?$/.test(f),
    );
  const index = new Map<string, Set<string>>();
  for (const file of files) {
    let text: string;
    try {
      text = readFileSync(join(root, file), "utf8");
    } catch {
      continue;
    }
    for (const id of new Set(text.match(IDENTIFIER))) {
      const set = index.get(id) ?? new Set();
      set.add(file);
      index.set(id, set);
    }
  }
  return index;
}

/**
 * The exports of `entryFile` with no consumer and no `@intent`, by export
 * name. `consumers` says which files name an identifier, `skip` holds the
 * entry barrels, which re-export everything and so consume nothing.
 */
export function intentFaultsOfEntry(
  program: ts.Program,
  entryFile: string,
  seen: Set<ts.Symbol>,
  consumers: (name: string) => ReadonlySet<string> | undefined,
  skip: ReadonlySet<string>,
  root: string,
): { faults: string[]; count: number; declared: number } {
  const checker = program.getTypeChecker();
  const sf = program.getSourceFile(entryFile);
  if (!sf) throw new Error(`the program has no ${entryFile}`);
  const moduleSymbol = checker.getSymbolAtLocation(sf);
  if (!moduleSymbol) return { faults: [], count: 0, declared: 0 };
  const faults: string[] = [];
  let count = 0;
  let declared = 0;
  const rel = (file: string) => relative(root, file).split(sep).join("/");
  for (const exported of checker.getExportsOfModule(moduleSymbol)) {
    const symbol =
      exported.flags & ts.SymbolFlags.Alias
        ? checker.getAliasedSymbol(exported)
        : exported;
    if (seen.has(symbol)) continue;
    seen.add(symbol);
    const own = (symbol.declarations ?? [])
      .map((d) => d.getSourceFile().fileName)
      .filter((f) => !f.includes("/node_modules/"));
    if (own.length === 0) continue;
    if (!(symbol.flags & ts.SymbolFlags.Value)) continue;
    count += 1;
    const declaring = new Set(own.map(rel));
    const used = [...(consumers(exported.name) ?? [])].some(
      (file) => !declaring.has(file) && !skip.has(file),
    );
    if (used) continue;
    if (symbol.getJsDocTags(checker).some((tag) => tag.name === "intent")) {
      declared += 1;
      continue;
    }
    faults.push(exported.name);
  }
  return { faults, count, declared };
}

/** Grades every published entry point. */
export function scanPublishedIntent(root = REPO_ROOT): IntentScan {
  const entries = publishedEntryPoints(root);
  const index = identifierIndex(root);
  const skip = new Set(entries.map((e) => `${e.dir}/${e.file}`));
  const faults = new Map<string, Set<string>>();
  let graded = 0;
  let declared = 0;
  for (const dir of [...new Set(entries.map((e) => e.dir))]) {
    const own = entries.filter((e) => e.dir === dir);
    const program = ts.createProgram(
      own.map((e) => join(root, dir, e.file)),
      compilerOptions(dir, root),
    );
    const seen = new Set<ts.Symbol>();
    for (const entry of own) {
      const found = intentFaultsOfEntry(
        program,
        join(root, dir, entry.file),
        seen,
        (name) => index.get(name),
        skip,
        root,
      );
      graded += found.count;
      declared += found.declared;
      const byKey = faults.get(entry.pkg) ?? new Set();
      for (const name of found.faults) byKey.add(`${entry.subpath}:${name}`);
      faults.set(entry.pkg, byKey);
    }
  }
  return { faults, graded, declared };
}

/**
 * A planted module graded by the same function: `unused` must fail, and
 * `declaredUnused`, `used` and the barrel's own re-export must not.
 */
export function gradePlant(): string[] {
  const file = join(dirname(REPO_ROOT), "__intent_plant__.ts");
  const text = [
    "export function unused(): void {}",
    "/**",
    " * Kept for a third party.",
    " *",
    " * @intent a novel representation",
    " */",
    "export const declaredUnused = 1;",
    "export const used = 2;",
  ].join("\n");
  const host = ts.createCompilerHost({});
  const getSourceFile = host.getSourceFile.bind(host);
  host.getSourceFile = (name, version) =>
    name === file
      ? ts.createSourceFile(name, text, version)
      : getSourceFile(name, version);
  host.fileExists = (name) => name === file || ts.sys.fileExists(name);
  host.readFile = (name) => (name === file ? text : ts.sys.readFile(name));
  const program = ts.createProgram([file], { noEmit: true }, host);
  const root = dirname(REPO_ROOT);
  return intentFaultsOfEntry(
    program,
    file,
    new Set(),
    (name) => (name === "used" ? new Set(["elsewhere.ts"]) : undefined),
    new Set(),
    root,
  ).faults;
}
