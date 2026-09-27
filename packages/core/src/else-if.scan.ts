import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";

/**
 * The scan behind `styleguide-no-else-if.test.ts`: every `if` whose `else`
 * branch is itself an `if`, across every tracked TypeScript and JavaScript
 * file outside generated output.
 *
 * A chain of cases reads as a function that returns early per case, or as a
 * lookup table when the branches are data. biome's `noUselessElse` covers the
 * `else` after a `return`; it does not reach a chain whose branches assign,
 * which is the shape this scan exists for.
 *
 * It parses rather than greps, so the words inside a string, a template or a
 * comment are never a hit: a codemod's fixtures and its own documentation name
 * the construct without being it.
 */

const REPO_ROOT = join(import.meta.dirname, "..", "..", "..");

const SOURCE_GLOBS = [
  "*.ts",
  "*.tsx",
  "*.mts",
  "*.cts",
  "*.js",
  "*.jsx",
  "*.mjs",
  "*.cjs",
];

/** Emitted, never written by hand, and regenerated over whatever an edit leaves. */
const GENERATED = [":!**/__generated__/**", ":!**/dist/**"];

export interface ElseIfHit {
  line: number;
  text: string;
}

function scriptKind(file: string): ts.ScriptKind {
  if (file.endsWith(".tsx")) return ts.ScriptKind.TSX;
  if (file.endsWith(".jsx")) return ts.ScriptKind.JSX;
  if (/\.[mc]?js$/.test(file)) return ts.ScriptKind.JS;
  return ts.ScriptKind.TS;
}

/** Every `else if` in one source text, by the line its `if` keyword sits on. */
export function elseIfsIn(source: string, file = "planted.ts"): ElseIfHit[] {
  const sf = ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    true,
    scriptKind(file),
  );
  const lines = source.split("\n");
  const hits: ElseIfHit[] = [];
  const visit = (node: ts.Node): void => {
    if (
      ts.isIfStatement(node) &&
      node.elseStatement &&
      ts.isIfStatement(node.elseStatement)
    ) {
      const { line } = sf.getLineAndCharacterOfPosition(
        node.elseStatement.getStart(sf),
      );
      hits.push({ line: line + 1, text: lines[line].trim() });
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return hits;
}

export interface ElseIfScan {
  /** Every file parsed; empty means the listing failed, not that the tree is clean. */
  read: string[];
  hits: Map<string, ElseIfHit[]>;
}

export function trackedSources(root = REPO_ROOT): string[] {
  return execFileSync(
    "git",
    ["ls-files", "-z", "--", ...SOURCE_GLOBS, ...GENERATED],
    {
      cwd: root,
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
    },
  )
    .split("\0")
    .filter(Boolean);
}

export function scanElseIf(
  files: readonly string[] = trackedSources(),
  root = REPO_ROOT,
): ElseIfScan {
  const hits = new Map<string, ElseIfHit[]>();
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
    const found = elseIfsIn(source, file);
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
export function elseIfVerdict(scan: ElseIfScan): string | null {
  if (scan.read.length === 0) {
    return "BLIND: the else-if scan read no files, so a clean result means nothing";
  }
  if (scan.hits.size === 0) return null;
  const lines = [...scan.hits].flatMap(([file, found]) =>
    found.map((hit) => `  ${file}:${hit.line}  ${hit.text}`),
  );
  return [
    `${lines.length} else-if chain(s). Return early per case from a small named function, or use a lookup table when the branches are data:`,
    ...lines,
  ].join("\n");
}
