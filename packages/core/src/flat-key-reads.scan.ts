import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";

/**
 * The scan behind `styleguide-no-flat-key-reads.test.ts`: the retired
 * `(dataSourceId, key)` read path, by the names and call shapes it used.
 *
 * Every read resolves a Topic or a field path off the stream, so none of these
 * takes a source id: `useDataSeries(key, windowSec)`, `mapTopic(key)`,
 * `resolveValueTopic(key)` and `getValue(key)`. The hooks and diagnostics that
 * existed only to choose between a registered `DataSource` and the stream are
 * gone, and a reference to one of them is a hit wherever it appears in code.
 *
 * It parses rather than greps, so a name spelt out in a string or a comment is
 * never a hit.
 */

const REPO_ROOT = join(import.meta.dirname, "..", "..", "..");

const SOURCE_GLOBS = ["*.ts", "*.tsx", "*.mts", "*.cts"];

/** Emitted, never written by hand, and regenerated over whatever an edit leaves. */
const GENERATED = [":!**/__generated__/**", ":!**/dist/**"];

/** The most arguments each read takes. */
export const MAX_ARGUMENTS: Readonly<Record<string, number>> = {
  useDataSeries: 2,
  mapTopic: 1,
  resolveValueTopic: 1,
  getValue: 1,
};

/**
 * Called only as a bare function. A method of this name belongs to something
 * else: `TelemetryClient.getValue(topic)` is a sticky-value read.
 */
const BARE_ONLY: ReadonlySet<string> = new Set(["getValue"]);

/** Names that must not come back as code, in any position. */
export const RETIRED_NAMES: readonly string[] = [
  "useDataStreamStatus",
  "useDataSourceSubscription",
  "DataSourceSubscriptionSetup",
  "warnGatedRead",
  "warnDeadRead",
  "classifyDeadRead",
  "onDataSourcesChange",
];

const RETIRED: ReadonlySet<string> = new Set(RETIRED_NAMES);

export interface FlatKeyHit {
  line: number;
  text: string;
}

function scriptKind(file: string): ts.ScriptKind {
  return file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
}

/** The capped read a callee names, or `undefined` when it names none. */
function cappedCallee(expression: ts.Expression): string | undefined {
  if (ts.isIdentifier(expression) && expression.text in MAX_ARGUMENTS) {
    return expression.text;
  }
  if (
    ts.isPropertyAccessExpression(expression) &&
    expression.name.text in MAX_ARGUMENTS &&
    !BARE_ONLY.has(expression.name.text)
  ) {
    return expression.name.text;
  }
  return undefined;
}

/** A function declaration of a capped read, with its parameters. */
function cappedDeclaration(
  node: ts.Node,
): { name: string; parameters: number } | undefined {
  if (!ts.isFunctionDeclaration(node) || node.name === undefined) {
    return undefined;
  }
  const name = node.name.text;
  if (!(name in MAX_ARGUMENTS)) return undefined;
  return { name, parameters: node.parameters.length };
}

/** Every hit in one source text, by line. */
export function flatKeyReadsIn(
  source: string,
  file = "planted.ts",
): FlatKeyHit[] {
  const sf = ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    true,
    scriptKind(file),
  );
  const lines = source.split("\n");
  const hits: FlatKeyHit[] = [];
  const hit = (node: ts.Node): void => {
    const { line } = sf.getLineAndCharacterOfPosition(node.getStart(sf));
    hits.push({ line: line + 1, text: lines[line].trim() });
  };
  const visit = (node: ts.Node): void => {
    if (ts.isIdentifier(node) && RETIRED.has(node.text)) hit(node);
    if (ts.isCallExpression(node)) {
      const name = cappedCallee(node.expression);
      if (name !== undefined && node.arguments.length > MAX_ARGUMENTS[name]) {
        hit(node);
      }
    }
    const declared = cappedDeclaration(node);
    if (
      declared !== undefined &&
      declared.parameters > MAX_ARGUMENTS[declared.name]
    ) {
      hit(node);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return hits;
}

export interface FlatKeyScan {
  /** Every file parsed; empty means the listing failed, not that the tree is clean. */
  read: string[];
  hits: Map<string, FlatKeyHit[]>;
}

/** Tracked and untracked sources naming any of the reads at all; only those can hold a hit. */
export function candidateSources(root = REPO_ROOT): string[] {
  const patterns = [...Object.keys(MAX_ARGUMENTS), ...RETIRED_NAMES].flatMap(
    (name) => ["-e", name],
  );
  return execFileSync(
    "git",
    [
      "grep",
      "--untracked",
      "-l",
      "-z",
      ...patterns,
      "--",
      ...SOURCE_GLOBS,
      ...GENERATED,
    ],
    { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
  )
    .split("\0")
    .filter(Boolean);
}

export function scanFlatKeyReads(
  files: readonly string[] = candidateSources(),
  root = REPO_ROOT,
): FlatKeyScan {
  const hits = new Map<string, FlatKeyHit[]>();
  const read: string[] = [];
  for (const file of files) {
    let source: string;
    try {
      source = readFileSync(join(root, file), "utf8");
    } catch {
      // Tracked but deleted in the working tree: nothing to parse.
      continue;
    }
    read.push(file);
    const found = flatKeyReadsIn(source, file);
    if (found.length > 0) hits.set(file, found);
  }
  return { read, hits };
}

/**
 * The gate's verdict on one scan, or `null` when it passes.
 *
 * A scan that read nothing fails as BLIND rather than passing: a listing that
 * errored into an empty string, a wrong cwd or a pathspec that stopped
 * matching would otherwise look exactly like a clean tree.
 */
export function flatKeyReadsVerdict(scan: FlatKeyScan): string | null {
  if (scan.read.length === 0) {
    return "BLIND: the flat-key read scan read no files, so a clean result means nothing";
  }
  if (scan.hits.size === 0) return null;
  const lines = [...scan.hits].flatMap(([file, found]) =>
    found.map((hit) => `  ${file}:${hit.line}  ${hit.text}`),
  );
  return [
    `${lines.length} use(s) of the retired (dataSourceId, key) read path. A read takes the Topic or field path alone: useDataSeries(key, windowSec), mapTopic(key), resolveValueTopic(key), getValue(key); a status comes from useStreamStatus:`,
    ...lines,
  ].join("\n");
}
