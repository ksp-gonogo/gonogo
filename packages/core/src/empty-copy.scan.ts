import { readFileSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";
import { trackedSources } from "./else-if.scan";

/**
 * The scan behind `styleguide-empty-copy.test.ts`: empty-state copy is a
 * label, never a sentence, so it never ends in a full stop. A trailing
 * three-dot ellipsis ("Waiting for telemetry...") is a pending state and
 * stays.
 *
 * Empty-state copy is read wherever it can be written: the children of an
 * element whose name ends in `Empty` or `EmptyState`, an `empty*` prop or
 * `AutoEmptyState`'s `fallback`, and an `empty*` default, variable or object
 * property. From each it takes every string an expression can end on, through
 * conditionals, `??` and `||`, and a template's closing text.
 */

export interface EmptyCopyHit {
  line: number;
  text: string;
  /** The offending full stop's offset in the source. */
  stop: number;
}

const EMPTY_TAG = /(?:Empty|EmptyState)$/;
const EMPTY_NAME = /^empty[A-Z]\w*$/;

function scriptKind(file: string): ts.ScriptKind {
  if (file.endsWith(".tsx")) return ts.ScriptKind.TSX;
  if (file.endsWith(".jsx")) return ts.ScriptKind.JSX;
  if (/\.[mc]?js$/.test(file)) return ts.ScriptKind.JS;
  return ts.ScriptKind.TS;
}

/** Every string `expr` can evaluate to at its end, with the node each came from. */
function endings(expr: ts.Node): { node: ts.Node; text: string }[] {
  if (ts.isStringLiteral(expr) || ts.isNoSubstitutionTemplateLiteral(expr)) {
    return [{ node: expr, text: expr.text }];
  }
  if (ts.isTemplateExpression(expr)) {
    const tail = expr.templateSpans[expr.templateSpans.length - 1];
    return [{ node: tail.literal, text: tail.literal.text }];
  }
  if (ts.isJsxText(expr)) return [{ node: expr, text: expr.text }];
  if (ts.isParenthesizedExpression(expr) || ts.isJsxExpression(expr)) {
    return expr.expression ? endings(expr.expression) : [];
  }
  if (ts.isConditionalExpression(expr)) {
    return [...endings(expr.whenTrue), ...endings(expr.whenFalse)];
  }
  if (
    ts.isBinaryExpression(expr) &&
    (expr.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken ||
      expr.operatorToken.kind === ts.SyntaxKind.BarBarToken)
  ) {
    return [...endings(expr.left), ...endings(expr.right)];
  }
  if (ts.isJsxElement(expr) || ts.isJsxFragment(expr)) {
    const last = [...expr.children]
      .reverse()
      .find((child) => !ts.isJsxText(child) || child.text.trim() !== "");
    return last ? endings(last) : [];
  }
  return [];
}

function endsInFullStop(text: string): boolean {
  const trimmed = text.trimEnd();
  return trimmed.endsWith(".") && !trimmed.endsWith("...");
}

function tagName(node: ts.JsxOpeningLikeElement): string {
  return node.tagName.getText();
}

/** The empty-state copy that ends in a full stop, in one source text. */
export function emptyCopyIn(
  source: string,
  file = "planted.tsx",
): EmptyCopyHit[] {
  const sf = ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    true,
    scriptKind(file),
  );
  const hits: EmptyCopyHit[] = [];
  const check = (expr: ts.Node | undefined): void => {
    if (!expr) return;
    for (const end of endings(expr)) {
      if (!endsInFullStop(end.text)) continue;
      const { line } = sf.getLineAndCharacterOfPosition(end.node.getStart(sf));
      const stop = source.lastIndexOf(".", end.node.getEnd());
      hits.push({ line: line + 1, text: end.text.trim(), stop });
    }
  };
  const visit = (node: ts.Node): void => {
    if (ts.isJsxElement(node) && EMPTY_TAG.test(tagName(node.openingElement))) {
      check(node);
    }
    if (ts.isJsxAttribute(node)) {
      const name = node.name.getText();
      const owner = tagName(node.parent.parent);
      if (
        EMPTY_NAME.test(name) ||
        (name === "fallback" && owner === "AutoEmptyState")
      ) {
        check(node.initializer);
      }
    }
    if (
      (ts.isBindingElement(node) ||
        ts.isVariableDeclaration(node) ||
        ts.isPropertyAssignment(node)) &&
      EMPTY_NAME.test(node.name.getText())
    ) {
      check(node.initializer);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return hits;
}

export interface EmptyCopyScan {
  /** Every file parsed; empty means the listing failed, not that the tree is clean. */
  read: string[];
  hits: Map<string, EmptyCopyHit[]>;
}

const REPO_ROOT = join(import.meta.dirname, "..", "..", "..");

/** Tests are left out: they quote the copy they check, and a plant must be able to spell a violation. */
const isTest = (file: string) => /\.test(-d)?\.[mc]?[jt]sx?$/.test(file);

export function scanEmptyCopy(
  files: readonly string[] = trackedSources().filter((f) => !isTest(f)),
  root = REPO_ROOT,
): EmptyCopyScan {
  const hits = new Map<string, EmptyCopyHit[]>();
  const read: string[] = [];
  for (const file of files) {
    let source: string;
    try {
      source = readFileSync(join(root, file), "utf8");
    } catch {
      continue;
    }
    read.push(file);
    const found = emptyCopyIn(source, file);
    if (found.length > 0) hits.set(file, found);
  }
  return { read, hits };
}

/** The gate's verdict, or `null` when it passes; a scan that read nothing fails as BLIND. */
export function emptyCopyVerdict(scan: EmptyCopyScan): string | null {
  if (scan.read.length === 0) {
    return "BLIND: the empty-copy scan read no files, so a clean result means nothing";
  }
  if (scan.hits.size === 0) return null;
  const lines = [...scan.hits].flatMap(([file, found]) =>
    found.map((hit) => `  ${file}:${hit.line}  ${hit.text}`),
  );
  return [
    `${lines.length} empty-state message(s) end in a full stop. Empty-state copy is a label: drop the stop ("No actions", "No atmosphere on Mun"):`,
    ...lines,
  ].join("\n");
}
