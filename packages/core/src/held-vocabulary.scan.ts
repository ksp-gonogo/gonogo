import { readFileSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";
import { trackedSources } from "./else-if.scan";

/**
 * The scan behind `styleguide-held-vocabulary.test.ts`: a value that stopped
 * updating is HELD, and it is spelled in one place.
 *
 * Two findings:
 *
 * - a `label`: an operator word for the condition (HELD or STALE) written in a
 *   string, a template or JSX text anywhere but the kit's own mapping, in
 *   product source. A widget draws the grade through that mapping, so the word
 *   cannot drift from the badge on the panel it sits in
 * - a `state`: the retired spellings of the Reading state and its grade
 *   (`"stale"`, `"held-stale"`, `StaleGrade`, `Staleness.HeldStale`) anywhere in the tree, tests
 *   included, where a string would still compile against a loosely typed
 *   fixture
 *
 * It parses rather than greps, so a comment naming the words is never a hit.
 */

const REPO_ROOT = join(import.meta.dirname, "..", "..", "..");

/** The single mapping from a grade to the operator's word. */
export const HELD_WORD_MAPPING =
  "packages/ui-kit/src/status/streamStatusWord.ts";

const OPERATOR_WORD = /\b(HELD|STALE)\b/;
/** Assembled, so the scan's own source is not a hit on itself. */
const OLD_STATE = ["st", "ale"].join("");
const RETIRED_LITERALS = new Set([OLD_STATE, `held-${OLD_STATE}`]);
const RETIRED_IDENTIFIERS = new Set(["Stale" + "Grade", "Held" + "Stale"]);

export type HeldVocabularyKind = "label" | "state";

export interface HeldVocabularyHit {
  kind: HeldVocabularyKind;
  line: number;
  text: string;
}

/** Tests, fixtures and scripts assert or stage the word; only shipped source may not write it. */
export function isProductSource(file: string): boolean {
  if (!/\.(ts|tsx|mts|js|jsx|mjs)$/.test(file)) return false;
  if (/\.(test|test-d|spec|stories)\.[cm]?[jt]sx?$/.test(file)) return false;
  if (/(^|\/)(test|tests|testing|__tests__|scripts|fixtures)\//.test(file)) {
    return false;
  }
  return /(^|\/)src\//.test(file);
}

function scriptKind(file: string): ts.ScriptKind {
  if (file.endsWith(".tsx")) return ts.ScriptKind.TSX;
  if (file.endsWith(".jsx")) return ts.ScriptKind.JSX;
  if (/\.[mc]?js$/.test(file)) return ts.ScriptKind.JS;
  return ts.ScriptKind.TS;
}

/** A literal used as a key (`Verdict["stale"]`, `o["stale"]`) names a property, not a state. */
function isKeyLookup(node: ts.Node): boolean {
  const parent = node.parent;
  if (ts.isElementAccessExpression(parent)) {
    return parent.argumentExpression === node;
  }
  return (
    ts.isLiteralTypeNode(parent) && ts.isIndexedAccessTypeNode(parent.parent)
  );
}

function textOf(node: ts.Node): string | null {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
    return node.text;
  }
  if (ts.isTemplateHead(node) || ts.isTemplateMiddle(node)) return node.text;
  if (ts.isTemplateTail(node)) return node.text;
  if (ts.isJsxText(node)) return node.text;
  return null;
}

/** Every finding in one source text, by line. */
export function heldVocabularyIn(
  source: string,
  file = "planted.ts",
): HeldVocabularyHit[] {
  const sf = ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    true,
    scriptKind(file),
  );
  const lines = source.split("\n");
  const checksLabels = isProductSource(file) && file !== HELD_WORD_MAPPING;
  const hits: HeldVocabularyHit[] = [];
  const hit = (kind: HeldVocabularyKind, node: ts.Node): void => {
    const { line } = sf.getLineAndCharacterOfPosition(node.getStart(sf));
    hits.push({ kind, line: line + 1, text: lines[line].trim() });
  };
  const visit = (node: ts.Node): void => {
    if (ts.isIdentifier(node) && RETIRED_IDENTIFIERS.has(node.text)) {
      hit("state", node);
    }
    const text = textOf(node);
    if (text !== null) {
      if (
        !ts.isJsxText(node) &&
        RETIRED_LITERALS.has(text) &&
        !isKeyLookup(node)
      ) {
        hit("state", node);
      }
      if (checksLabels && OPERATOR_WORD.test(text)) hit("label", node);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return hits;
}

export interface HeldVocabularyScan {
  /** Every file parsed; empty means the listing failed, not that the tree is clean. */
  read: string[];
  hits: Map<string, HeldVocabularyHit[]>;
}

export function scanHeldVocabulary(
  files: readonly string[] = trackedSources(),
  root = REPO_ROOT,
): HeldVocabularyScan {
  const hits = new Map<string, HeldVocabularyHit[]>();
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
    const found = heldVocabularyIn(source, file);
    if (found.length > 0) hits.set(file, found);
  }
  return { read, hits };
}

/**
 * The gate's verdict on one scan, or `null` when it passes. A scan that read
 * nothing fails as BLIND rather than passing.
 */
export function heldVocabularyVerdict(scan: HeldVocabularyScan): string | null {
  if (scan.read.length === 0) {
    return "BLIND: the held-vocabulary scan read no files, so a clean result means nothing";
  }
  if (scan.hits.size === 0) return null;
  const lines = [...scan.hits].flatMap(([file, found]) =>
    found.map((hit) => `  [${hit.kind}] ${file}:${hit.line}  ${hit.text}`),
  );
  return [
    `${lines.length} hand-written held vocabulary hit(s). A held Reading is \`state: "held"\` with a \`HeldGrade\`, and its word comes from the kit's \`heldWord\`, \`formatStreamStatus\` or a \`<StreamStatusBadge>\`, never a string in the widget:`,
    ...lines,
  ].join("\n");
}
