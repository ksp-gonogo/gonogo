import { existsSync, readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type * as TS from "typescript";
import { CheckUnableError, type TypeScript } from "../../program";
import type { CheckContext, FixableFinding, Rule } from "../../types";

/** Lower-case words joined by single hyphens, digits allowed after the first character of a word. */
export const KEBAB_CASE = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;

const SKIPPED_DIRS = new Set(["node_modules", "dist", "__generated__"]);

function loadTypeScriptSync(clientDir: string): TypeScript {
  for (const from of [
    join(clientDir, "package.json"),
    fileURLToPath(import.meta.url),
  ]) {
    try {
      const loaded: { default?: TypeScript } & TypeScript =
        createRequire(from)("typescript");
      return loaded.default ?? loaded;
    } catch {
      // Not installed there: try the next place.
    }
  }
  throw new CheckUnableError(
    "typescript is not installed where the client can reach it. check reads the client with the TypeScript compiler:\n  npm i -D typescript",
  );
}

function sourceFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!SKIPPED_DIRS.has(entry.name)) found.push(...sourceFiles(path));
      continue;
    }
    if (/\.[cm]?tsx?$/.test(entry.name) && !entry.name.endsWith(".d.ts")) {
      found.push(path);
    }
  }
  return found.sort();
}

/** `expr` with `as`, `satisfies`, `!` and parentheses peeled off. */
function unwrap(ts: TypeScript, expr: TS.Expression): TS.Expression {
  let current = expr;
  for (;;) {
    if (
      ts.isAsExpression(current) ||
      ts.isSatisfiesExpression(current) ||
      ts.isNonNullExpression(current) ||
      ts.isParenthesizedExpression(current)
    ) {
      current = current.expression;
      continue;
    }
    return current;
  }
}

/** The outermost `as const satisfies ...` chain of an initializer, down to the first `satisfies`. */
function unwrapOnce(ts: TypeScript, expr: TS.Expression): TS.Expression {
  let current = expr;
  while (ts.isAsExpression(current) || ts.isParenthesizedExpression(current)) {
    current = current.expression;
  }
  return current;
}

/**
 * The `actions` arrays a source file registers a widget with, as literal ids.
 * An `actions` value that is a `const` of the same file is followed; one imported
 * from another file is read when that file is read, since its declaration is the
 * array of objects that carry the ids.
 */
export function actionIdsIn(
  ts: TypeScript,
  file: string,
  text: string,
): { id: string; line: number }[] {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.ES2022, true);
  const consts = new Map<string, TS.Expression>();
  const visitConsts = (node: TS.Node) => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer
    ) {
      consts.set(node.name.text, node.initializer);
    }
    ts.forEachChild(node, visitConsts);
  };
  visitConsts(source);

  const found = new Map<number, string>();
  const readArray = (expr: TS.Expression, depth: number) => {
    const value = unwrap(ts, expr);
    if (ts.isIdentifier(value) && depth < 3) {
      const target = consts.get(value.text);
      if (target) readArray(target, depth + 1);
      return;
    }
    if (!ts.isArrayLiteralExpression(value)) return;
    for (const element of value.elements) {
      const item = unwrap(ts, element);
      if (!ts.isObjectLiteralExpression(item)) continue;
      for (const prop of item.properties) {
        if (
          ts.isPropertyAssignment(prop) &&
          (ts.isIdentifier(prop.name) || ts.isStringLiteral(prop.name)) &&
          prop.name.text === "id" &&
          ts.isStringLiteralLike(prop.initializer)
        ) {
          found.set(prop.initializer.getStart(source), prop.initializer.text);
        }
      }
    }
  };

  const visit = (node: TS.Node) => {
    if (
      ts.isPropertyAssignment(node) &&
      (ts.isIdentifier(node.name) || ts.isStringLiteral(node.name)) &&
      node.name.text === "actions"
    ) {
      readArray(node.initializer, 0);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  const visitTyped = (node: TS.Node) => {
    if (ts.isVariableDeclaration(node) && node.initializer) {
      const declaredAs = node.type?.getText(source) ?? "";
      const satisfied =
        ts.isSatisfiesExpression(unwrapOnce(ts, node.initializer)) &&
        unwrapOnce(ts, node.initializer)
          .getText(source)
          .includes("ActionDefinition");
      if (/\bActionDefinition\b/.test(declaredAs) || satisfied) {
        readArray(node.initializer, 0);
      }
    }
    ts.forEachChild(node, visitTyped);
  };
  visitTyped(source);

  return [...found.entries()]
    .sort(([a], [b]) => a - b)
    .map(([pos, id]) => ({
      id,
      line: text.slice(0, pos).split("\n").length,
    }));
}

export const actionIdRule: Rule = {
  id: "actions/kebab-case",
  group: "actions",
  check({ clientDir }: CheckContext): FixableFinding[] {
    const ts = loadTypeScriptSync(clientDir);
    const out: FixableFinding[] = [];
    for (const file of sourceFiles(join(clientDir, "src"))) {
      const text = readFileSync(file, "utf8");
      if (!text.includes("id")) continue;
      for (const { id, line } of actionIdsIn(ts, file, text)) {
        if (KEBAB_CASE.test(id)) continue;
        out.push({
          rule: "actions/kebab-case",
          severity: "error",
          file,
          line,
          message: `The action id "${id}" is not kebab-case. An id is the key of every saved input binding, so it is spelled one way for the life of the widget.`,
          fixable: false,
          fix: `Rename it to "${toKebab(id)}". Bindings saved under the old id are lost.`,
        });
      }
    }
    return out;
  },
};

/** `rpmUp` and `toggle_motor` as `rpm-up` and `toggle-motor`. */
export function toKebab(id: string): string {
  return id
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/[_\s]+/g, "-")
    .toLowerCase();
}

export const actionRules: readonly Rule[] = [actionIdRule];
