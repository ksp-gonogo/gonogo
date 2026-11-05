import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";
import { standardSlots } from "./index";

const STUB_HELPERS: ReadonlySet<string> = new Set([
  "plantSlot",
  "plantContribution",
]);

/** The stub folder's own plumbing, which plants nothing under a literal slot. */
const PLUMBING: ReadonlySet<string> = new Set([
  "stub.tsx",
  "standard.tsx",
  "index.ts",
]);

/** A widget's declared extension points, as the widget manifest lists them. */
export interface DeclaredSlots {
  id: string;
  augmentSlots: readonly string[];
  contributionSlots: readonly string[];
}

/** An extension point with no planted stub, and the widget that declares or carries it. */
export interface MissingStub {
  widgetId: string;
  slot: string;
}

/** The extension points a widget has: the ones it declares and the standard ones its panel carries. */
export function slotsOf(widget: DeclaredSlots): string[] {
  return [
    ...new Set([
      ...widget.augmentSlots,
      ...widget.contributionSlots,
      ...standardSlots(widget.id),
    ]),
  ];
}

/**
 * The slots every stub file in `dir` plants under a literal name. A call whose
 * slot is not a string literal plants nothing this scan can name, so the
 * widget it serves reads as missing a stub rather than passing unseen.
 */
export function plantedSlotsIn(dir: string): Set<string> {
  const planted = new Set<string>();
  for (const name of readdirSync(dir)) {
    if (!/\.tsx?$/.test(name) || PLUMBING.has(name)) continue;
    const source = ts.createSourceFile(
      name,
      readFileSync(join(dir, name), "utf8"),
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TSX,
    );
    const visit = (node: ts.Node): void => {
      if (
        ts.isCallExpression(node) &&
        ts.isIdentifier(node.expression) &&
        STUB_HELPERS.has(node.expression.text)
      ) {
        const arg = node.arguments[0];
        if (arg && ts.isStringLiteralLike(arg)) planted.add(arg.text);
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  return planted;
}

/**
 * Every extension point of `widgets` that no stub plants. The standard points
 * are planted by a loop over the widgets with a panel, so they are covered
 * whenever {@link standardSlots} names them.
 */
export function missingStubs(
  widgets: readonly DeclaredSlots[],
  planted: ReadonlySet<string>,
): MissingStub[] {
  const missing: MissingStub[] = [];
  for (const widget of widgets) {
    const standard = new Set(standardSlots(widget.id));
    for (const slot of slotsOf(widget)) {
      if (standard.has(slot) || planted.has(slot)) continue;
      missing.push({ widgetId: widget.id, slot });
    }
  }
  return missing;
}
