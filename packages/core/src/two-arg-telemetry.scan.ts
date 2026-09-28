import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";

/**
 * The scan behind `styleguide-no-two-arg-telemetry.test.ts`: every call of
 * `useTelemetry` with more than one argument, and every declaration of a
 * `useTelemetry` taking more than one parameter, across the tracked
 * TypeScript tree outside generated output.
 *
 * `useTelemetry` takes a `TopicId` and nothing else. The `(dataSourceId, key)`
 * pair read an unchecked string through a migration shim; a dynamic Topic is
 * read with `useStream`, and a non-Sitrep source through its own API.
 *
 * It parses rather than greps, so the call spelt out in a string or a comment
 * is never a hit.
 */

const REPO_ROOT = join(import.meta.dirname, "..", "..", "..");

const SOURCE_GLOBS = ["*.ts", "*.tsx", "*.mts", "*.cts"];

/** Emitted, never written by hand, and regenerated over whatever an edit leaves. */
const GENERATED = [":!**/__generated__/**", ":!**/dist/**"];

const HOOK = "useTelemetry";

export interface TwoArgHit {
  line: number;
  text: string;
}

function scriptKind(file: string): ts.ScriptKind {
  return file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
}

/** `useTelemetry(...)` or `anything.useTelemetry(...)`. */
function isHookCallee(expression: ts.Expression): boolean {
  if (ts.isIdentifier(expression)) return expression.text === HOOK;
  if (ts.isPropertyAccessExpression(expression)) {
    return expression.name.text === HOOK;
  }
  return false;
}

/** A function, method or property signature that declares the hook itself. */
function declaredParameters(
  node: ts.Node,
): ts.NodeArray<ts.ParameterDeclaration> | undefined {
  if (
    (ts.isFunctionDeclaration(node) ||
      ts.isMethodSignature(node) ||
      ts.isMethodDeclaration(node)) &&
    node.name !== undefined &&
    ts.isIdentifier(node.name) &&
    node.name.text === HOOK
  ) {
    return node.parameters;
  }
  if (
    ts.isPropertySignature(node) &&
    ts.isIdentifier(node.name) &&
    node.name.text === HOOK &&
    node.type !== undefined &&
    ts.isFunctionTypeNode(node.type)
  ) {
    return node.type.parameters;
  }
  return undefined;
}

/** Every two-arg call or declaration in one source text, by line. */
export function twoArgTelemetryIn(
  source: string,
  file = "planted.ts",
): TwoArgHit[] {
  const sf = ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    true,
    scriptKind(file),
  );
  const lines = source.split("\n");
  const hits: TwoArgHit[] = [];
  const hit = (node: ts.Node): void => {
    const { line } = sf.getLineAndCharacterOfPosition(node.getStart(sf));
    hits.push({ line: line + 1, text: lines[line].trim() });
  };
  const visit = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      isHookCallee(node.expression) &&
      node.arguments.length > 1
    ) {
      hit(node);
    }
    const parameters = declaredParameters(node);
    if (parameters !== undefined && parameters.length > 1) hit(node);
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return hits;
}

export interface TwoArgScan {
  /** Every file parsed; empty means the listing failed, not that the tree is clean. */
  read: string[];
  hits: Map<string, TwoArgHit[]>;
}

/** Tracked and untracked sources naming the hook at all; only those can hold a hit. */
export function candidateSources(root = REPO_ROOT): string[] {
  return execFileSync(
    "git",
    [
      "grep",
      "--untracked",
      "-l",
      "-z",
      HOOK,
      "--",
      ...SOURCE_GLOBS,
      ...GENERATED,
    ],
    { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
  )
    .split("\0")
    .filter(Boolean);
}

export function scanTwoArgTelemetry(
  files: readonly string[] = candidateSources(),
  root = REPO_ROOT,
): TwoArgScan {
  const hits = new Map<string, TwoArgHit[]>();
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
    const found = twoArgTelemetryIn(source, file);
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
export function twoArgTelemetryVerdict(scan: TwoArgScan): string | null {
  if (scan.read.length === 0) {
    return "BLIND: the two-arg useTelemetry scan read no files, so a clean result means nothing";
  }
  if (scan.hits.size === 0) return null;
  const lines = [...scan.hits].flatMap(([file, found]) =>
    found.map((hit) => `  ${file}:${hit.line}  ${hit.text}`),
  );
  return [
    `${lines.length} two-arg useTelemetry call(s) or declaration(s). useTelemetry takes a TopicId only: read a dynamic Topic with useStream, and a non-Sitrep source through its own API:`,
    ...lines,
  ].join("\n");
}
