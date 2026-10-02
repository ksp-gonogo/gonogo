import ts from "typescript";
import type { SourceFile } from "./stale-references.scan";

/**
 * A live region that is rendered only while it has something to say, so it
 * mounts together with its first message. Assistive tech announces a change to
 * a region it already knows; one inserted holding its words is often never
 * announced. Keep the region mounted and change what is inside it.
 *
 * Three spellings count as a live region: `role="status"`, an `aria-live`
 * attribute, and a `<LiveRegion>`. `role="alert"` is left out, because an alert
 * is announced on insertion by definition. A region is mounted conditionally
 * when it is the right operand of `&&` or a branch of a `?:` within the same
 * function. A region behind an early `return null` is not seen: that takes a
 * render, which `expectLiveRegionPrimed` does.
 */

export interface MountedWithContent {
  file: string;
  line: number;
  /** The opening tag as written, for the report. */
  element: string;
}

function isLiveRegion(node: ts.JsxOpeningLikeElement): boolean {
  if (node.tagName.getText() === "LiveRegion") return true;
  return node.attributes.properties.some((attribute) => {
    if (!ts.isJsxAttribute(attribute)) return false;
    const name = attribute.name.getText();
    if (name === "aria-live") return true;
    return (
      name === "role" &&
      /^["']status["']$/.test(attribute.initializer?.getText() ?? "")
    );
  });
}

/** Whether `element` is rendered only on one side of a condition, inside its own function. */
function isConditional(element: ts.Node): boolean {
  let current = element;
  while (
    current.parent &&
    !ts.isFunctionLike(current.parent) &&
    !ts.isSourceFile(current.parent)
  ) {
    const parent = current.parent;
    if (
      ts.isBinaryExpression(parent) &&
      parent.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken &&
      parent.right === current
    )
      return true;
    if (ts.isConditionalExpression(parent) && parent.condition !== current)
      return true;
    current = parent;
  }
  return false;
}

export function liveRegionsMountedWithContent(
  files: readonly SourceFile[],
): MountedWithContent[] {
  const out: MountedWithContent[] = [];
  for (const file of files) {
    const source = ts.createSourceFile(
      file.path,
      file.text,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TSX,
    );
    const visit = (node: ts.Node): void => {
      if (
        (ts.isJsxSelfClosingElement(node) || ts.isJsxOpeningElement(node)) &&
        isLiveRegion(node)
      ) {
        const element = ts.isJsxOpeningElement(node) ? node.parent : node;
        if (isConditional(element))
          out.push({
            file: file.path,
            line:
              source.getLineAndCharacterOfPosition(node.getStart()).line + 1,
            element: node.getText().replace(/\s+/g, " ").slice(0, 80),
          });
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  return out;
}
