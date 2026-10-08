import { sep } from "node:path";
import type * as TS from "typescript";
import type { TypeScript } from "./program";
import { createResolver, isValidFamily, type Resolver } from "./resolve";
import type {
  ClientScan,
  DirectiveRecord,
  Registration,
  WidgetScan,
} from "./types";

/** Hooks whose first argument names a Topic the widget reads. */
const TOPIC_READERS = new Set([
  "useTelemetry",
  "useStream",
  "useStreamOptional",
]);

/** Hooks whose first argument names a command the widget sends. */
const COMMAND_SENDERS = new Set(["useCommand"]);

const DIRECTIVE = /\/\/\s*gonogo:reads\s+(.+?)\s*$/;
const TOPIC_ID = /^[A-Za-z0-9_]+(\.[A-Za-z0-9_-]+)*$/;

export interface ScanOptions {
  /** Absolute directory of the client; registrations outside it are not widgets of this client. */
  clientDir: string;
}

const inNodeModules = (fileName: string) =>
  fileName.includes(`${sep}node_modules${sep}`) ||
  fileName.includes("/node_modules/");

/**
 * Reads every widget registration in the client's program and what each widget
 * reads, by walking from its `component` through the calls and elements it
 * contains.
 */
export function scanClient(
  ts: TypeScript,
  program: TS.Program,
  options: ScanOptions,
): ClientScan {
  const clientRoot = options.clientDir.endsWith(sep)
    ? options.clientDir
    : options.clientDir + sep;
  const isOwnSource = (file: TS.SourceFile) =>
    !file.isDeclarationFile &&
    !inNodeModules(file.fileName) &&
    file.fileName.startsWith(clientRoot);
  const resolver = createResolver(ts, program, isOwnSource);

  const directives = new Map<string, DirectiveRecord>();
  const directivesIn = new Set<string>();
  const directiveAt = (file: TS.SourceFile, line: number) => {
    if (!directivesIn.has(file.fileName)) {
      directivesIn.add(file.fileName);
      file.text.split("\n").forEach((text, index) => {
        const match = DIRECTIVE.exec(text);
        if (!match) return;
        directives.set(`${file.fileName}:${index}`, {
          file: file.fileName,
          line: index + 1,
          values: match[1].split(/[\s,]+/).filter(Boolean),
          needed: false,
          attached: false,
        });
      });
    }
    return directives.get(`${file.fileName}:${line}`);
  };

  const lineOf = (node: TS.Node, file: TS.SourceFile) =>
    file.getLineAndCharacterOfPosition(node.getStart(file)).line;

  /** The name a call is made under, or the declared name behind an alias such as `useStream as read`. */
  const calleeName = (call: TS.CallExpression): string | undefined => {
    const callee = call.expression;
    const written = ts.isIdentifier(callee)
      ? callee.text
      : ts.isPropertyAccessExpression(callee)
        ? callee.name.text
        : undefined;
    if (
      written === undefined ||
      TOPIC_READERS.has(written) ||
      COMMAND_SENDERS.has(written)
    ) {
      return written;
    }
    const declared = resolver.declarationOf(callee);
    const name = declared && ts.getNameOfDeclaration(declared);
    return name && ts.isIdentifier(name) ? name.text : written;
  };

  /** The statement a call sits in, for a directive written above a multi-line statement. */
  const statementOf = (node: TS.Node): TS.Node => {
    let current = node;
    while (
      current.parent &&
      !ts.isBlock(current.parent) &&
      !ts.isSourceFile(current.parent) &&
      !ts.isCaseClause(current.parent) &&
      !ts.isDefaultClause(current.parent)
    ) {
      current = current.parent;
    }
    return current;
  };

  const bodyOf = (decl: TS.Node | undefined): TS.Node | undefined => {
    if (!decl) return undefined;
    if (ts.isVariableDeclaration(decl)) {
      return decl.initializer
        ? bodyOf(unwrapWrapper(decl.initializer))
        : undefined;
    }
    if (
      ts.isFunctionDeclaration(decl) ||
      ts.isFunctionExpression(decl) ||
      ts.isArrowFunction(decl) ||
      ts.isMethodDeclaration(decl) ||
      ts.isClassDeclaration(decl)
    ) {
      return decl;
    }
    return undefined;
  };

  /** `memo(X)`, `forwardRef(X)` and the like: the thing they wrap. */
  function unwrapWrapper(expr: TS.Expression): TS.Expression {
    let node = expr;
    while (ts.isParenthesizedExpression(node)) node = node.expression;
    if (ts.isCallExpression(node) && node.arguments.length > 0) {
      return unwrapWrapper(node.arguments[0]);
    }
    return node;
  }

  const widgetOf = (registration: Registration): WidgetScan => ({
    registration,
    reads: [],
    commands: [],
    unresolved: [],
    readsFromConfig: false,
  });

  const record = (
    widget: WidgetScan,
    call: TS.CallExpression,
    kind: "read" | "command",
    name: string,
  ) => {
    const file = call.getSourceFile();
    const line = lineOf(call, file);
    const where = { call: name, file: file.fileName, line: line + 1 };
    const arg = call.arguments[0];
    const resolved = arg
      ? resolver.resolve(arg)
      : ({ ok: false, reason: `${name}() has no argument` } as const);

    const stmtLine = lineOf(statementOf(call), file);
    let directive: DirectiveRecord | undefined;
    for (const candidate of [line, line - 1, stmtLine, stmtLine - 1]) {
      directive = candidate >= 0 ? directiveAt(file, candidate) : undefined;
      if (directive) break;
    }
    const target = kind === "read" ? widget.reads : widget.commands;

    if (directive) {
      directive.attached = true;
      if (!resolved.ok) directive.needed = true;
      for (const value of directive.values) {
        if (value === "config") {
          widget.readsFromConfig = true;
          continue;
        }
        const isFamily = value.includes("<") || value.includes(">");
        if (isFamily && isValidFamily(value)) {
          target.push({ ...where, family: value, directive: true });
          continue;
        }
        if (!isFamily && TOPIC_ID.test(value)) {
          target.push({ ...where, id: value, directive: true });
          continue;
        }
        widget.unresolved.push({
          ...where,
          reason: `the directive names "${value}", which is not a Topic id, a family pattern with whole-segment <name> placeholders, or config`,
        });
      }
      return;
    }

    if (!resolved.ok) {
      widget.unresolved.push({ ...where, reason: resolved.reason });
      return;
    }
    for (const id of resolved.ids) target.push({ ...where, id });
    for (const family of resolved.families) target.push({ ...where, family });
  };

  const kindOf = (name: string): "read" | "command" | undefined => {
    if (TOPIC_READERS.has(name)) return "read";
    return COMMAND_SENDERS.has(name) ? "command" : undefined;
  };

  const walkWidget = (widget: WidgetScan, root: TS.Node) => {
    const visited = new Set<TS.Node>();
    const enter = (decl: TS.Node | undefined) => {
      const body = bodyOf(decl);
      if (!body || visited.has(body)) return;
      const file = body.getSourceFile();
      if (file.isDeclarationFile || inNodeModules(file.fileName)) return;
      visited.add(body);
      visit(body);
    };
    const visit = (node: TS.Node): void => {
      if (ts.isCallExpression(node)) {
        const name = calleeName(node);
        const kind = name ? kindOf(name) : undefined;
        if (name && kind) record(widget, node, kind, name);
        if (!kind) enter(resolver.declarationOf(node.expression));
      }
      if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
        if (ts.isIdentifier(node.tagName)) {
          enter(resolver.declarationOf(node.tagName));
        }
      }
      ts.forEachChild(node, visit);
    };
    enter(root);
  };

  const propertyOf = (
    object: TS.ObjectLiteralExpression,
    name: string,
  ): TS.Expression | undefined => {
    for (const prop of object.properties) {
      if (
        ts.isPropertyAssignment(prop) &&
        (ts.isIdentifier(prop.name) || ts.isStringLiteral(prop.name)) &&
        prop.name.text === name
      ) {
        return prop.initializer;
      }
      if (ts.isShorthandPropertyAssignment(prop) && prop.name.text === name) {
        return prop.name;
      }
    }
    return undefined;
  };

  const hasProperty = (object: TS.ObjectLiteralExpression, name: string) =>
    object.properties.some(
      (prop) =>
        prop.name !== undefined &&
        (ts.isIdentifier(prop.name) || ts.isStringLiteral(prop.name)) &&
        prop.name.text === name,
    );

  /** A literal list of strings, or why it is not one. */
  const stringList = (
    expr: TS.Expression,
    resolverOf: Resolver,
  ): string[] | undefined => {
    let node = expr;
    for (let hops = 0; hops < 4; hops++) {
      while (
        ts.isParenthesizedExpression(node) ||
        ts.isAsExpression(node) ||
        ts.isSatisfiesExpression(node)
      ) {
        node = node.expression;
      }
      if (!ts.isIdentifier(node)) break;
      const decl = resolverOf.declarationOf(node);
      if (!decl || !ts.isVariableDeclaration(decl) || !decl.initializer) {
        return undefined;
      }
      node = decl.initializer;
    }
    if (!ts.isArrayLiteralExpression(node)) return undefined;
    const out: string[] = [];
    for (const element of node.elements) {
      const got = resolverOf.resolve(element);
      if (!got.ok || got.ids.length !== 1 || got.families.length > 0) {
        return undefined;
      }
      out.push(got.ids[0]);
    }
    return out;
  };

  const isGeneratedSpread = (expr: TS.Expression): boolean => {
    if (!ts.isIdentifier(expr)) return false;
    const symbol = program.getTypeChecker().getSymbolAtLocation(expr);
    const decl = symbol?.declarations?.[0];
    const importDecl = decl && ts.findAncestor(decl, ts.isImportDeclaration);
    return (
      !!importDecl &&
      ts.isStringLiteral(importDecl.moduleSpecifier) &&
      /\.declarations\.g(\.[jt]s)?$/.test(importDecl.moduleSpecifier.text)
    );
  };

  const scanRegistration = (
    object: TS.ObjectLiteralExpression,
    base: { file: string; line: number },
  ): WidgetScan => {
    const idExpr = propertyOf(object, "id");
    const idResolved = idExpr ? resolver.resolve(idExpr) : undefined;
    const id =
      idResolved?.ok && idResolved.ids.length === 1 ? idResolved.ids[0] : "";
    const registration: Registration = {
      id,
      ...base,
      hasDataRequirements: hasProperty(object, "dataRequirements"),
    };
    const opaque: string[] = [];
    if (!id) opaque.push("its id is not a literal");

    for (const prop of object.properties) {
      if (ts.isSpreadAssignment(prop) && !isGeneratedSpread(prop.expression)) {
        opaque.push(
          "it spreads something other than its generated declarations",
        );
      }
    }
    for (const field of ["channels", "channelFamilies"] as const) {
      const expr = propertyOf(object, field);
      if (!expr) continue;
      const list = stringList(expr, resolver);
      if (list) registration[field] = list;
      else opaque.push(`${field} is not a literal list`);
    }
    if (opaque.length > 0) registration.opaque = opaque.join("; ");

    const widget = widgetOf(registration);
    const component = propertyOf(object, "component");
    if (!component) {
      registration.opaque = [registration.opaque, "it has no component"]
        .filter(Boolean)
        .join("; ");
      return widget;
    }
    const target = unwrapWrapper(component);
    const decl = ts.isIdentifier(target)
      ? resolver.declarationOf(target)
      : undefined;
    const root = ts.isIdentifier(target) ? decl : target;
    if (!root || !bodyOf(root)) {
      registration.opaque = [
        registration.opaque,
        "its component cannot be found in this program",
      ]
        .filter(Boolean)
        .join("; ");
      return widget;
    }
    walkWidget(widget, root);
    return widget;
  };

  const widgets: WidgetScan[] = [];
  for (const file of program.getSourceFiles()) {
    if (!isOwnSource(file)) continue;
    const find = (node: TS.Node): void => {
      if (
        ts.isCallExpression(node) &&
        calleeName(node) === "registerComponent"
      ) {
        const arg = node.arguments[0];
        const base = {
          file: file.fileName,
          line: lineOf(node, file) + 1,
        };
        if (!arg || !ts.isObjectLiteralExpression(arg)) {
          widgets.push(
            widgetOf({
              id: "",
              ...base,
              hasDataRequirements: false,
              opaque: "the registration is not an object literal",
            }),
          );
        } else {
          widgets.push(scanRegistration(arg, base));
        }
      }
      ts.forEachChild(node, find);
    };
    find(file);
  }

  for (const file of program.getSourceFiles()) {
    if (isOwnSource(file)) directiveAt(file, 0);
  }

  let typeErrors = 0;
  for (const file of program.getSourceFiles()) {
    if (!isOwnSource(file)) continue;
    typeErrors += program
      .getSemanticDiagnostics(file)
      .filter((d) => d.category === ts.DiagnosticCategory.Error).length;
  }

  return {
    widgets,
    directives: [...directives.values()],
    typeErrors,
  };
}
