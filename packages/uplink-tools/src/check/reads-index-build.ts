import { existsSync, mkdirSync, renameSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import type * as TS from "typescript";
import {
  createIndexReader,
  type ReadsIndex,
  type ReadsIndexEntry,
} from "./index-reader";
import {
  CheckUnableError,
  createClientProgram,
  loadTypeScript,
  type TypeScript,
} from "./program";
import { createScanner, LEAF_ARGUMENTS } from "./scan";

export interface BuildReadsIndexOptions {
  /** The published package's directory, with a tsconfig.json that covers its source. */
  packageDir: string;
  packageName: string;
  /** Source files of the package's entry points, relative to `packageDir`. */
  entries: readonly string[];
  /** Name of an exported constant that lists framework reads, when the package owns it. */
  frameworkReadsExport?: string;
}

export interface BuiltReadsIndex {
  index: ReadsIndex;
  /** Entries the scan could not name, which keep the index from being written. */
  problems: string[];
}

const sorted = (values: Iterable<string>) => [...new Set(values)].sort();

const emptyEntry = (): ReadsIndexEntry => ({
  reads: [],
  families: [],
  commands: [],
  arguments: [],
  unresolved: [],
});

/** The value of `export const NAME = { key: ["a", "b"] } as const`, read statically. */
function literalRecord(
  ts: TypeScript,
  scanner: ReturnType<typeof createScanner>,
  expr: TS.Expression,
): Record<string, string[]> | undefined {
  let node = expr;
  while (
    ts.isParenthesizedExpression(node) ||
    ts.isAsExpression(node) ||
    ts.isSatisfiesExpression(node)
  ) {
    node = node.expression;
  }
  if (!ts.isObjectLiteralExpression(node)) return undefined;
  const out: Record<string, string[]> = {};
  for (const prop of node.properties) {
    if (!ts.isPropertyAssignment(prop)) return undefined;
    const key = ts.isIdentifier(prop.name)
      ? prop.name.text
      : ts.isStringLiteral(prop.name)
        ? prop.name.text
        : undefined;
    let list = prop.initializer;
    while (ts.isAsExpression(list) || ts.isSatisfiesExpression(list)) {
      list = list.expression;
    }
    if (key === undefined || !ts.isArrayLiteralExpression(list)) {
      return undefined;
    }
    const values: string[] = [];
    for (const element of list.elements) {
      const got = scanner.resolver.resolve(element);
      if (!got.ok || got.ids.length !== 1) return undefined;
      values.push(got.ids[0]);
    }
    out[key] = values;
  }
  return out;
}

/**
 * Which of two entries for one export name an index keeps. A shim that calls
 * into the host is opaque, and the implementation it forwards to is exported
 * under the same name from another entry point, so the entry with nothing
 * unresolved wins. Two clean entries that disagree are a problem.
 */
function keepEntry(
  name: string,
  earlier: ReadsIndexEntry | undefined,
  entry: ReadsIndexEntry,
  problems: string[],
): ReadsIndexEntry {
  if (earlier === undefined) return entry;
  if (earlier.unresolved.length > 0) {
    return entry.unresolved.length === 0 ? entry : earlier;
  }
  const disagree =
    entry.unresolved.length === 0 &&
    JSON.stringify(earlier) !== JSON.stringify(entry);
  if (disagree) {
    problems.push(
      `${name} is exported from two entry points with different reads`,
    );
  }
  return earlier;
}

/**
 * Scans every exported function and component of a package's entry points and
 * records what each reads, so a client that imports the package from `dist`
 * knows what it reads without the source.
 */
export function buildReadsIndex(
  ts: TypeScript,
  program: TS.Program,
  options: BuildReadsIndexOptions,
): BuiltReadsIndex {
  const checker = program.getTypeChecker();
  const own = (provided?: Record<string, readonly string[]>) =>
    createScanner(ts, program, {
      clientDir: options.packageDir,
      frameworkReads: provided,
      indexes: createIndexReader(),
    });

  const roots = options.entries.map((entry) => {
    const file = program.getSourceFile(resolve(options.packageDir, entry));
    if (!file) {
      throw new CheckUnableError(
        `${entry} is not in the program ${options.packageName} builds, so its exports cannot be indexed.`,
      );
    }
    return file;
  });

  const exportsOf = (file: TS.SourceFile) => {
    const symbol = checker.getSymbolAtLocation(file);
    return symbol ? checker.getExportsOfModule(symbol) : [];
  };

  let frameworkReads: Record<string, string[]> = {};
  if (options.frameworkReadsExport) {
    let literal: Record<string, string[]> | undefined;
    const probe = own();
    for (const file of roots) {
      const symbol = exportsOf(file).find(
        (s) => s.name === options.frameworkReadsExport,
      );
      const aliased =
        symbol && symbol.flags & ts.SymbolFlags.Alias
          ? checker.getAliasedSymbol(symbol)
          : symbol;
      const decl = aliased?.valueDeclaration;
      if (decl && ts.isVariableDeclaration(decl) && decl.initializer) {
        literal = literalRecord(ts, probe, decl.initializer);
      }
    }
    frameworkReads = literal ?? {};
    if (literal === undefined) {
      throw new CheckUnableError(
        `${options.packageName} should export ${options.frameworkReadsExport} as a literal object of Topic id lists, and it does not.`,
      );
    }
  } else {
    frameworkReads = {
      ...createIndexReader().frameworkReads(options.packageDir),
    };
  }

  const scanner = own(frameworkReads);
  const entries: Record<string, ReadsIndexEntry> = {};
  const problems: string[] = [];

  for (const file of roots) {
    for (const symbol of exportsOf(file)) {
      const target =
        symbol.flags & ts.SymbolFlags.Alias
          ? checker.getAliasedSymbol(symbol)
          : symbol;
      const decl = target.declarations?.find(
        (d) =>
          scanner.functionOf(d) !== undefined ||
          (/^use[A-Z]/.test(symbol.name) &&
            ts.isVariableDeclaration(d) &&
            d.initializer !== undefined),
      );
      if (!decl) continue;
      const declFile = decl.getSourceFile();
      if (
        declFile.isDeclarationFile ||
        declFile.fileName.includes("/node_modules/")
      ) {
        continue;
      }
      const name = symbol.name;
      const leaf = Object.hasOwn(LEAF_ARGUMENTS, name)
        ? LEAF_ARGUMENTS[name]
        : undefined;
      let entry = emptyEntry();
      if (leaf) {
        entry.arguments = [{ index: 0, kind: leaf }];
      } else {
        const scan = scanner.scanFunction(decl, {
          hostIsOpaque: /^use[A-Z]/.test(name),
        });
        const place = (r: { file: string; line: number }) =>
          `${relative(options.packageDir, r.file)}:${r.line}`;
        entry = {
          reads: sorted(scan.reads.flatMap((r) => (r.id ? [r.id] : []))),
          families: sorted(
            scan.reads.flatMap((r) => (r.family ? [r.family] : [])),
          ),
          commands: sorted(scan.commands.flatMap((r) => (r.id ? [r.id] : []))),
          arguments: scan.forwarded
            .filter(
              (a, i, all) =>
                all.findIndex(
                  (b) => b.index === a.index && b.kind === a.kind,
                ) === i,
            )
            .sort((a, b) => a.index - b.index),
          unresolved: sorted(
            scan.unresolved.map((u) => `${place(u)} ${u.call}(): ${u.reason}`),
          ),
        };
      }
      entries[name] = keepEntry(name, entries[name], entry, problems);
    }
  }
  for (const [name, entry] of Object.entries(entries)) {
    for (const line of entry.unresolved) problems.push(`${name}: ${line}`);
  }

  const ordered: Record<string, ReadsIndexEntry> = {};
  for (const name of Object.keys(entries).sort()) ordered[name] = entries[name];
  return {
    index: {
      version: 1,
      package: options.packageName,
      frameworkReads,
      entries: ordered,
    },
    problems,
  };
}

/** Builds the index of the package in `options.packageDir` and writes it to `outFile`, or throws naming every gap. */
export async function writeReadsIndex(
  options: BuildReadsIndexOptions & { outFile: string },
): Promise<ReadsIndex> {
  const ts = await loadTypeScript(options.packageDir);
  const program = createClientProgram(ts, options.packageDir);
  const { index, problems } = buildReadsIndex(ts, program, options);
  if (problems.length > 0) {
    throw new CheckUnableError(
      `${options.packageName} has reads the index cannot name:\n  ${problems.join("\n  ")}\n` +
        "Write `// gonogo:reads <topic id or family pattern>` on the line above each call, naming what it reads.",
    );
  }
  mkdirSync(dirname(options.outFile), { recursive: true });
  const temp = `${options.outFile}.tmp`;
  writeFileSync(temp, `${JSON.stringify(index, null, 2)}\n`);
  renameSync(temp, options.outFile);
  if (!existsSync(options.outFile)) {
    throw new CheckUnableError(`${options.outFile} was not written`);
  }
  return index;
}
