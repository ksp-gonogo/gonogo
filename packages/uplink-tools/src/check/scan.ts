import { existsSync, readFileSync } from "node:fs";
import { dirname, join, sep } from "node:path";
import type * as TS from "typescript";
import type {
  ArgumentKind,
  IndexedArgument,
  IndexReader,
} from "./index-reader";
import type { TypeScript } from "./program";
import {
  CALL_SITE_DEPTH,
  createResolver,
  isValidFamily,
  type Resolution,
  type Resolver,
} from "./resolve";
import type {
  ClientScan,
  DirectiveRecord,
  IndexMissingRecord,
  Registration,
  WidgetScan,
} from "./types";

/**
 * The hooks that read by themselves, and what their first argument names.
 * Their bodies are never entered: what they subscribe to on the caller's
 * behalf is the framework's, not the widget's.
 */
/**
 * Calls that reach the telemetry store, the client or the host without naming
 * a Topic. What a hook reads through them is for its author to state, since
 * the scan cannot see it.
 */
export const OPAQUE_CALLS: ReadonlySet<string> = new Set([
  "getHost",
  "getActiveTelemetryClient",
  "useTelemetryClient",
  "useTelemetryClientOptional",
  "useTelemetryStore",
  "useTelemetryStoreOptional",
]);

export const LEAF_ARGUMENTS: Readonly<Record<string, ArgumentKind>> = {
  useTelemetry: "topic",
  useStream: "topic",
  useStreamOptional: "topic",
  useStreamEvent: "topic",
  useLatestValue: "topic",
  useCommand: "command",
  useProcessor: "processor",
  useSeriesReadings: "handle",
  useDataSeries: "series-key",
};

const DIRECTIVE = /\/\/\s*gonogo:reads\s+(.+?)\s*$/;
const TOPIC_ID = /^[A-Za-z0-9_]+(\.[A-Za-z0-9_-]+)*$/;

export interface ScanOptions {
  /** Absolute directory of the client; registrations outside it are not widgets of this client. */
  clientDir: string;
  /** Where the reads of a published package's hooks come from when its source is not in the program. */
  indexes?: IndexReader;
  /** Hook or component name to the Topics it reads on the framework's behalf. Defaults to what the installed sdk lists. */
  frameworkReads?: Readonly<Record<string, readonly string[]>>;
  /** The Topic ids a series key's leading segments can name. Defaults to the sdk's `TopicId` as the program sees it. */
  topicIds?: readonly string[];
}

/** Where the reads of one scan accumulate: a widget, or one exported function of a package. */
interface Sink {
  reads: WidgetScan["reads"];
  commands: WidgetScan["commands"];
  unresolved: WidgetScan["unresolved"];
  readsFromConfig: boolean;
  /** Present when the scan is of one function, whose own parameters may be forwarded to a read. */
  forwarded?: IndexedArgument[];
}

export interface FunctionScan {
  reads: WidgetScan["reads"];
  commands: WidgetScan["commands"];
  unresolved: WidgetScan["unresolved"];
  forwarded: IndexedArgument[];
}

export interface Scanner {
  scanClient(): ClientScan;
  /**
   * What calling or mounting `decl` reads, with its own parameters named when
   * forwarded. With `hostIsOpaque`, a call that reaches the host or the telemetry
   * store is a read the scan cannot see, which only a `// gonogo:reads`
   * directive can name.
   */
  scanFunction(
    decl: TS.Node,
    scanOptions?: { hostIsOpaque?: boolean },
  ): FunctionScan;
  /** The function, class or arrow behind a declaration, wrappers such as `memo` removed. */
  functionOf(decl: TS.Node | undefined): TS.Node | undefined;
  resolver: Resolver;
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
  return createScanner(ts, program, options).scanClient();
}

export function createScanner(
  ts: TypeScript,
  program: TS.Program,
  options: ScanOptions,
): Scanner {
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

  /** Line ranges, per file outside the client, of the function bodies a walk entered. */
  const walked = new Map<string, [number, number][]>();
  const noteWalked = (body: TS.Node) => {
    const file = body.getSourceFile();
    if (isOwnSource(file)) return;
    const range: [number, number] = [
      lineOf(body, file) + 1,
      file.getLineAndCharacterOfPosition(body.getEnd()).line + 1,
    ];
    walked.set(file.fileName, [...(walked.get(file.fileName) ?? []), range]);
  };
  /** A directive in a file the client does not own is judged only when the scan went through the function it sits in. */
  const isJudged = (directive: DirectiveRecord) =>
    directive.file.startsWith(clientRoot) ||
    (walked.get(directive.file) ?? []).some(
      ([start, end]) => directive.line >= start && directive.line <= end,
    );

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
    if (written === undefined || Object.hasOwn(LEAF_ARGUMENTS, written)) {
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

  const strip = (expr: TS.Expression): TS.Expression => {
    let node = expr;
    while (
      ts.isParenthesizedExpression(node) ||
      ts.isAsExpression(node) ||
      ts.isNonNullExpression(node) ||
      ts.isSatisfiesExpression(node)
    ) {
      node = node.expression;
    }
    return node;
  };

  const constInitializer = (expr: TS.Expression): TS.Expression | undefined => {
    const node = strip(expr);
    if (!ts.isIdentifier(node)) return undefined;
    const decl = resolver.declarationOf(node);
    return decl &&
      ts.isVariableDeclaration(decl) &&
      decl.initializer &&
      ts.isVariableDeclarationList(decl.parent) &&
      decl.parent.flags & ts.NodeFlags.Const
      ? decl.initializer
      : undefined;
  };

  type ArgumentResolution =
    | { ok: true; ids: string[]; families: string[]; via?: "processor" }
    | { ok: false; reason: string };

  /** Deepest chain of constants and parameters followed from a handle to its object literal. */
  const HANDLE_DEPTH = 6;

  /**
   * A handle is an object with a `topic` member; the Topic is what that member
   * resolves to. A handle passed in as a parameter is what each call passes.
   */
  const resolveHandle = (expr: TS.Expression, depth = 0): Resolution => {
    const node = strip(expr);
    if (ts.isObjectLiteralExpression(node)) {
      const topic = propertyOf(node, "topic");
      return topic
        ? resolver.resolve(topic)
        : { ok: false, reason: "the handle has no topic member" };
    }
    if (depth >= HANDLE_DEPTH) {
      return {
        ok: false,
        reason: "the handle passes through too many constants and calls",
      };
    }
    const next = constInitializer(node);
    if (next) return resolveHandle(next, depth + 1);
    const decl = ts.isIdentifier(node)
      ? resolver.declarationOf(node)
      : undefined;
    if (decl && ts.isParameter(decl) && ts.isIdentifier(decl.name)) {
      const fn = decl.parent;
      const index = fn.parameters.indexOf(decl);
      const calls = resolver.callSites(fn);
      if (calls.length === 0) {
        return {
          ok: false,
          reason: "the parameter is never passed a handle in this program",
        };
      }
      const ids = new Set<string>();
      const families = new Set<string>();
      for (const call of calls) {
        const source = call.arguments[index] ?? decl.initializer;
        if (!source) {
          return { ok: false, reason: "a call passes the parameter nothing" };
        }
        const got = resolveHandle(source, depth + 1);
        if (!got.ok) return got;
        for (const id of got.ids) ids.add(id);
        for (const family of got.families) families.add(family);
      }
      return { ok: true, ids: [...ids], families: [...families] };
    }
    return {
      ok: false,
      reason: "the handle is not an object literal in this program",
    };
  };

  let knownTopics: ReadonlySet<string> | undefined;
  /** The Topic ids of the sdk's `TopicId` type, read through the checker so a re-export or a rename does not hide them. */
  const topicIds = (): ReadonlySet<string> => {
    if (knownTopics) return knownTopics;
    const found = new Set<string>(options.topicIds ?? []);
    if (options.topicIds === undefined) {
      const checker = program.getTypeChecker();
      for (const file of program.getSourceFiles()) {
        if (!/[\\/]sitrep-sdk[\\/]/.test(file.fileName)) continue;
        for (const statement of file.statements) {
          if (
            !ts.isTypeAliasDeclaration(statement) ||
            statement.name.text !== "TopicId"
          ) {
            continue;
          }
          const type = checker.getTypeAtLocation(statement.name);
          for (const member of type.isUnion() ? type.types : [type]) {
            if (member.isStringLiteral()) found.add(member.value);
          }
        }
      }
    }
    knownTopics = found;
    return found;
  };

  /**
   * A series key is `<topic>.<field path>`, so what it reads is its longest
   * leading run of whole segments that is a Topic id. A family's placeholder
   * ends the run, since a field path never contains one.
   */
  const topicOfSeriesKey = (key: string): string | undefined => {
    const segments = key.split(".");
    const known = topicIds();
    for (let end = segments.length; end > 0; end--) {
      const head = segments.slice(0, end);
      if (head.some((segment) => segment.includes("<"))) continue;
      const candidate = head.join(".");
      if (known.has(candidate)) return candidate;
    }
    return undefined;
  };

  const resolveSeriesKey = (
    name: string,
    expr: TS.Expression,
  ): ArgumentResolution => {
    const resolved = resolver.resolve(expr);
    if (!resolved.ok) return resolved;
    const ids = new Set<string>();
    for (const key of [...resolved.ids, ...resolved.families]) {
      const topic = topicOfSeriesKey(key);
      if (topic === undefined) {
        return {
          ok: false,
          reason: `${name}() reads "${key}", which does not begin with a Topic id the sdk knows`,
        };
      }
      ids.add(topic);
    }
    return { ok: true, ids: [...ids], families: [] };
  };

  const makerOf = (call: TS.CallExpression): string | undefined =>
    ts.isIdentifier(call.expression)
      ? call.expression.text
      : ts.isPropertyAccessExpression(call.expression)
        ? call.expression.name.text
        : undefined;

  const isMaker = (maker: string | undefined) =>
    maker === "defineProcessor" || maker === "registerProcessor";

  const isProcessorHandle = (node: TS.Expression): boolean => {
    const init = constInitializer(node);
    const call = init && strip(init);
    return !!call && ts.isCallExpression(call) && isMaker(makerOf(call));
  };

  /**
   * A processor's inputs are the literal dependency list of the call that made
   * it: `defineProcessor({...})`, or `registerProcessor({...})` on an Uplink's
   * client handle. A dependency that is itself a processor contributes that
   * processor's inputs.
   */
  const resolveProcessor = (
    expr: TS.Expression,
    depth = 0,
  ): ArgumentResolution => {
    const init = constInitializer(expr);
    const call = init && strip(init);
    if (!call || !ts.isCallExpression(call)) {
      return {
        ok: false,
        reason: "the processor handle is not a constant in this program",
      };
    }
    const maker = makerOf(call);
    const def = call.arguments[0] && strip(call.arguments[0]);
    if (!isMaker(maker) || !def || !ts.isObjectLiteralExpression(def)) {
      return {
        ok: false,
        reason: `the processor's inputs are not declared here${maker ? ` (it comes from ${maker})` : ""}`,
      };
    }
    const depsExpr = propertyOf(def, "deps");
    const deps = depsExpr && strip(depsExpr);
    const list = deps && ts.isIdentifier(deps) ? constInitializer(deps) : deps;
    const array = list && strip(list);
    if (!array || !ts.isArrayLiteralExpression(array)) {
      return {
        ok: false,
        reason: "the processor's deps are not a literal list",
      };
    }
    const ids = new Set<string>();
    const families = new Set<string>();
    for (const element of array.elements) {
      const node = strip(element);
      const topic =
        ts.isObjectLiteralExpression(node) && propertyOf(node, "reading");
      const upstream = depth < 4 && !topic && isProcessorHandle(node);
      const got = upstream
        ? resolveProcessor(node, depth + 1)
        : resolver.resolve(topic || node);
      if (!got.ok) {
        return {
          ok: false,
          reason: `a processor input cannot be named: ${got.reason}`,
        };
      }
      for (const id of got.ids) ids.add(id);
      for (const family of got.families) families.add(family);
    }
    return {
      ok: true,
      ids: [...ids],
      families: [...families],
      via: "processor",
    };
  };

  const resolveArgument = (
    kind: ArgumentKind,
    name: string,
    expr: TS.Expression | undefined,
  ): ArgumentResolution => {
    if (!expr) return { ok: false, reason: `${name}() has no argument` };
    if (kind === "series-key") return resolveSeriesKey(name, expr);
    if (kind === "processor") return resolveProcessor(expr);
    return kind === "handle" ? resolveHandle(expr) : resolver.resolve(expr);
  };

  let entryParams: readonly TS.ParameterDeclaration[] = [];
  let opaqueHost = false;
  const suppressed: Set<string>[] = [];
  const frameworkReads =
    options.frameworkReads ??
    options.indexes?.frameworkReads(options.clientDir) ??
    {};
  const indexMissing: IndexMissingRecord[] = [];

  const isSuppressed = (id: string) => suppressed.some((set) => set.has(id));

  /** The directive attached to a call, looked for on its line, the one above, and its statement's. */
  const directiveFor = (
    call: TS.Node,
    file: TS.SourceFile,
  ): DirectiveRecord | undefined => {
    const line = lineOf(call, file);
    const stmtLine = lineOf(statementOf(call), file);
    for (const candidate of [line, line - 1, stmtLine, stmtLine - 1]) {
      const found = candidate >= 0 ? directiveAt(file, candidate) : undefined;
      if (found) return found;
    }
    return undefined;
  };

  type Where = { call: string; file: string; line: number };

  /** The read a directive value names: a family pattern or a Topic id, and nothing else. */
  const directiveRead = (
    value: string,
    where: Where,
  ): WidgetScan["reads"][number] | undefined => {
    if (value.includes("<") || value.includes(">")) {
      return isValidFamily(value)
        ? { ...where, family: value, directive: true }
        : undefined;
    }
    return TOPIC_ID.test(value)
      ? { ...where, id: value, directive: true }
      : undefined;
  };

  /** The directive's say replaces what the scanner could not read. */
  const applyDirective = (
    sink: Sink,
    directive: DirectiveRecord,
    where: Where,
    target: WidgetScan["reads"],
  ) => {
    for (const value of directive.values) {
      if (value === "none") continue;
      if (value === "config") {
        sink.readsFromConfig = true;
        continue;
      }
      const record = directiveRead(value, where);
      if (record) {
        target.push(record);
        continue;
      }
      sink.unresolved.push({
        ...where,
        reason: `the directive names "${value}", which is not a Topic id, a family pattern with whole-segment <name> placeholders, or config`,
      });
    }
  };

  const whereOf = (call: TS.Node, name: string): Where => {
    const file = call.getSourceFile();
    return { call: name, file: file.fileName, line: lineOf(call, file) + 1 };
  };

  const parameterIndexOf = (expr: TS.Expression): number | undefined => {
    const node = strip(expr);
    if (!ts.isIdentifier(node)) return undefined;
    const decl = resolver.declarationOf(node);
    if (!decl || !ts.isParameter(decl)) return undefined;
    const index = entryParams.indexOf(decl);
    return index >= 0 ? index : undefined;
  };

  interface Traced {
    ids: string[];
    families: string[];
    /** Parameters of the scanned function that the value comes from. */
    forwarded: number[];
    reason?: string;
  }

  /**
   * Where a value comes from when the scan is of one function: its own
   * parameters, which the caller will supply, and whatever its helpers are
   * called with from inside the program. A value with no parameter of the
   * function in it is left to the resolver.
   */
  const traceToEntry = (expr: TS.Expression, level: number): Traced => {
    const own = parameterIndexOf(expr);
    if (own !== undefined) return { ids: [], families: [], forwarded: [own] };
    const node = strip(expr);
    const decl = ts.isIdentifier(node)
      ? resolver.declarationOf(node)
      : undefined;
    if (
      decl &&
      ts.isParameter(decl) &&
      ts.isIdentifier(decl.name) &&
      level < CALL_SITE_DEPTH
    ) {
      const fn = decl.parent;
      const index = fn.parameters.indexOf(decl);
      const merged: Traced = { ids: [], families: [], forwarded: [] };
      const calls = resolver.callSites(fn);
      for (const call of calls) {
        const source = call.arguments[index] ?? decl.initializer;
        if (!source)
          return { ...merged, reason: "a call passes the parameter nothing" };
        const got = traceToEntry(source, level + 1);
        merged.ids.push(...got.ids);
        merged.families.push(...got.families);
        merged.forwarded.push(...got.forwarded);
        if (got.reason !== undefined) merged.reason = got.reason;
      }
      if (calls.length > 0) return merged;
    }
    const resolved = resolver.resolve(expr);
    return resolved.ok
      ? { ids: resolved.ids, families: resolved.families, forwarded: [] }
      : { ids: [], families: [], forwarded: [], reason: resolved.reason };
  };

  const recordArgument = (
    sink: Sink,
    call: TS.CallExpression,
    name: string,
    argument: IndexedArgument,
  ) => {
    const where = whereOf(call, name);
    const expr = call.arguments[argument.index];
    const directive = directiveFor(call, call.getSourceFile());
    const target = argument.kind === "command" ? sink.commands : sink.reads;

    if (directive) {
      directive.attached = true;
      if (!resolveArgument(argument.kind, name, expr).ok) {
        directive.needed = true;
      }
      applyDirective(sink, directive, where, target);
      return;
    }
    if (
      sink.forwarded &&
      expr &&
      (argument.kind === "topic" || argument.kind === "command")
    ) {
      const traced = traceToEntry(expr, 0);
      if (traced.forwarded.length > 0 || traced.reason !== undefined) {
        for (const index of traced.forwarded) {
          sink.forwarded.push({ index, kind: argument.kind });
        }
        if (traced.reason !== undefined) {
          sink.unresolved.push({ ...where, reason: traced.reason });
        }
        for (const id of traced.ids) {
          if (!isSuppressed(id)) target.push({ ...where, id });
        }
        for (const family of traced.families) target.push({ ...where, family });
        return;
      }
    }
    const resolved = resolveArgument(argument.kind, name, expr);
    if (!resolved.ok) {
      sink.unresolved.push({ ...where, reason: resolved.reason });
      return;
    }
    const via = "via" in resolved ? { via: resolved.via } : {};
    for (const id of resolved.ids) {
      if (!isSuppressed(id)) target.push({ ...where, id, ...via });
    }
    for (const family of resolved.families) {
      target.push({ ...where, family, ...via });
    }
  };

  /** A call into the host, whose implementation is not in this program. */
  const recordOpaque = (sink: Sink, call: TS.CallExpression, name: string) => {
    const where = whereOf(call, name);
    const directive = directiveFor(call, call.getSourceFile());
    if (directive) {
      directive.attached = true;
      directive.needed = true;
      applyDirective(sink, directive, where, sink.reads);
      return;
    }
    sink.unresolved.push({
      ...where,
      reason: `${name}() reaches what the scan cannot see into, so what it reads is not known`,
    });
  };

  /** `{ specifier, name }` of an `@ksp-gonogo/*` import the callee was made through. */
  const importedFrom = (
    callee: TS.Expression,
  ): { specifier: string; name: string } | undefined => {
    const checker = program.getTypeChecker();
    const target = ts.isPropertyAccessExpression(callee)
      ? callee.expression
      : callee;
    const decl = checker.getSymbolAtLocation(target)?.declarations?.[0];
    if (!decl) return undefined;
    const importDecl = ts.findAncestor(decl, ts.isImportDeclaration);
    if (!importDecl || !ts.isStringLiteral(importDecl.moduleSpecifier)) {
      return undefined;
    }
    const specifier = importDecl.moduleSpecifier.text;
    if (!specifier.startsWith("@ksp-gonogo/")) return undefined;
    if (ts.isImportSpecifier(decl)) {
      return { specifier, name: (decl.propertyName ?? decl.name).text };
    }
    if (ts.isNamespaceImport(decl) && ts.isPropertyAccessExpression(callee)) {
      return { specifier, name: callee.name.text };
    }
    return undefined;
  };

  const HOOK = /^use[A-Z]/;

  /**
   * The gonogo package a declaration was written in, which differs from the one
   * a call imported it from when the importer is a re-export (`ui` and `core`
   * both hand on ui-kit's hooks).
   */
  const declaringPackage = (callee: TS.Expression): string | undefined => {
    const decl = resolver.declarationOf(callee);
    if (!decl) return undefined;
    let dir = dirname(decl.getSourceFile().fileName);
    for (;;) {
      const manifest = join(dir, "package.json");
      if (existsSync(manifest)) {
        try {
          const name = JSON.parse(readFileSync(manifest, "utf8")).name;
          return typeof name === "string" && name.startsWith("@ksp-gonogo/")
            ? name
            : undefined;
        } catch {
          return undefined;
        }
      }
      const parent = dirname(dir);
      if (parent === dir) return undefined;
      dir = parent;
    }
  };

  /** Takes what a published package's index says a call or element reads, or reports that it says nothing. */
  const readFromIndex = (
    sink: Sink,
    node: TS.CallExpression | TS.JsxOpeningLikeElement,
    callee: TS.Expression,
  ) => {
    if (!options.indexes) return;
    const imported = importedFrom(callee);
    if (!imported) return;
    const file = node.getSourceFile();
    const where = whereOf(node, imported.name);
    const specifier = declaringPackage(callee) ?? imported.specifier;
    const { index, problem } = options.indexes.lookup(specifier, file.fileName);
    const entry = index?.entries[imported.name];
    if (!entry) {
      if (!HOOK.test(imported.name)) return;
      const directive = directiveFor(node, file);
      if (directive) {
        directive.attached = true;
        directive.needed = true;
        applyDirective(sink, directive, where, sink.reads);
        return;
      }
      indexMissing.push({
        name: imported.name,
        specifier,
        file: where.file,
        line: where.line,
        reason: problem ?? `its index has no entry for ${imported.name}`,
      });
      return;
    }
    for (const id of entry.reads) {
      if (!isSuppressed(id)) sink.reads.push({ ...where, id });
    }
    for (const family of entry.families) sink.reads.push({ ...where, family });
    for (const id of entry.commands) sink.commands.push({ ...where, id });
    if (!ts.isCallExpression(node)) return;
    for (const argument of entry.arguments) {
      recordArgument(sink, node, imported.name, argument);
    }
  };

  const nameOfDeclaration = (decl: TS.Node | undefined): string | undefined => {
    const name = decl && ts.getNameOfDeclaration(decl as TS.Declaration);
    return name && ts.isIdentifier(name) ? name.text : undefined;
  };

  const walk = (sink: Sink, root: TS.Node, direct = false) => {
    const visited = new Set<TS.Node>();
    const enter = (decl: TS.Node | undefined) => {
      const body = bodyOf(decl);
      if (!body || visited.has(body)) return;
      const file = body.getSourceFile();
      if (file.isDeclarationFile || inNodeModules(file.fileName)) return;
      visited.add(body);
      noteWalked(body);
      const name = nameOfDeclaration(decl);
      const hidden = name === undefined ? undefined : frameworkReads[name];
      if (hidden) suppressed.push(new Set(hidden));
      visit(body);
      if (hidden) suppressed.pop();
    };
    const callInto = (
      node: TS.CallExpression | TS.JsxOpeningLikeElement,
      callee: TS.Expression,
    ) => {
      const decl = resolver.declarationOf(callee);
      const body = bodyOf(decl);
      const file = body?.getSourceFile();
      if (
        body &&
        file &&
        !file.isDeclarationFile &&
        !inNodeModules(file.fileName)
      ) {
        enter(decl);
        return;
      }
      readFromIndex(sink, node, callee);
    };
    const visitCall = (node: TS.CallExpression) => {
      const name = calleeName(node);
      if (name !== undefined && Object.hasOwn(LEAF_ARGUMENTS, name)) {
        recordArgument(sink, node, name, {
          index: 0,
          kind: LEAF_ARGUMENTS[name],
        });
        return;
      }
      if (
        name !== undefined &&
        OPAQUE_CALLS.has(name) &&
        (opaqueHost || directiveFor(node, node.getSourceFile()))
      ) {
        recordOpaque(sink, node, name);
        return;
      }
      callInto(node, node.expression);
    };
    const visit = (node: TS.Node): void => {
      if (ts.isCallExpression(node)) visitCall(node);
      if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
        if (ts.isIdentifier(node.tagName)) callInto(node, node.tagName);
      }
      ts.forEachChild(node, visit);
    };
    if (direct) {
      noteWalked(root);
      visit(root);
    } else enter(root);
  };

  const scanFunction: Scanner["scanFunction"] = (decl, scanOptions) => {
    const sink: Sink & { forwarded: IndexedArgument[] } = {
      reads: [],
      commands: [],
      unresolved: [],
      readsFromConfig: false,
      forwarded: [],
    };
    const fn = bodyOf(decl);
    entryParams =
      fn && "parameters" in fn
        ? (fn as TS.SignatureDeclaration).parameters
        : [];
    opaqueHost = scanOptions?.hostIsOpaque === true;
    // A hook that is a value rather than a function, such as a store, is read from its initializer.
    const initializer =
      !fn && ts.isVariableDeclaration(decl) ? decl.initializer : undefined;
    if (initializer) walk(sink, initializer, true);
    else walk(sink, decl);
    entryParams = [];
    opaqueHost = false;
    return sink;
  };

  const hasProperty = (object: TS.ObjectLiteralExpression, name: string) =>
    object.properties.some(
      (prop) =>
        prop.name !== undefined &&
        (ts.isIdentifier(prop.name) || ts.isStringLiteral(prop.name)) &&
        prop.name.text === name,
    );

  /** `topics.channels` where `topics` is `defineTopicManifest({ channels: [...] })`: the list the manifest was given. */
  const manifestProperty = (
    access: TS.PropertyAccessExpression,
    resolverOf: Resolver,
  ): TS.Expression | undefined => {
    if (!ts.isIdentifier(access.expression)) return undefined;
    const decl = resolverOf.declarationOf(access.expression);
    const init =
      decl && ts.isVariableDeclaration(decl) ? decl.initializer : undefined;
    if (
      !init ||
      !ts.isCallExpression(init) ||
      calleeName(init) !== "defineTopicManifest" ||
      !init.arguments[0] ||
      !ts.isObjectLiteralExpression(init.arguments[0])
    ) {
      return undefined;
    }
    return propertyOf(init.arguments[0], access.name.text);
  };

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
      if (ts.isPropertyAccessExpression(node)) {
        const listed = manifestProperty(node, resolverOf);
        if (!listed) return undefined;
        node = listed;
        continue;
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
      hasChannelsFromConfig: hasProperty(object, "channelsFromConfig"),
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
    const fieldsExpr = propertyOf(object, "fields");
    const fields = fieldsExpr ? stringList(fieldsExpr, resolver) : undefined;
    if (fields) registration.fields = fields;
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
    walk(widget, root);
    return widget;
  };

  const scanClient = (): ClientScan => {
    const widgets: WidgetScan[] = [];
    const registeredPrefixes: string[] = [];
    for (const file of program.getSourceFiles()) {
      if (!isOwnSource(file)) continue;
      const find = (node: TS.Node): void => {
        if (
          ts.isCallExpression(node) &&
          calleeName(node) === "registerDynamicTopicPrefix" &&
          node.arguments[0] &&
          ts.isStringLiteralLike(node.arguments[0])
        ) {
          registeredPrefixes.push(node.arguments[0].text);
        }
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
                hasChannelsFromConfig: false,
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
      registeredPrefixes,
      indexMissing,
      directives: [...directives.values()].filter(isJudged),
      typeErrors,
    };
  };

  return {
    scanClient,
    scanFunction,
    functionOf: bodyOf,
    resolver,
  };
}
