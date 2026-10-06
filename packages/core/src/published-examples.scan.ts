import { join } from "node:path";
import ts from "typescript";
import {
  compilerOptions,
  type EntryPoint,
  publishedEntryPoints,
} from "./published-entry-points";

/**
 * The scan behind `styleguide-published-examples.test.ts`: every fenced code
 * block in an `@example` tag on a published export (or a member of one),
 * typechecked as an author would write it against the published entry points.
 *
 * An example is a fragment, not a module, so it is wrapped in a function body
 * and every name it uses that it does not declare itself is imported from the
 * author-facing entry point that exports it, the documented package's own
 * first. An imported name an example never declares is therefore not an error,
 * and a name that no entry point exports, or one an author cannot reach, is.
 * The packages resolve to their source, so the check needs no build.
 */

const REPO_ROOT = join(import.meta.dirname, "..", "..", "..");

const CODE_LANGUAGES = new Set(["", "ts", "tsx", "typescript", "js", "jsx"]);

export interface PublishedExample {
  /** The package whose export carries the comment. */
  pkg: string;
  /** The package directory relative to the repo root. */
  dir: string;
  /** The entry point's subpath the carrying export was reached through. */
  subpath: string;
  /** The export name, or `Export#member`. */
  owner: string;
  /** The block's text, without its fence. */
  code: string;
}

export interface ExampleFault {
  example: PublishedExample;
  /** The first diagnostic, as `TS<code> <message>`. */
  message: string;
}

export interface ExampleScan {
  examples: PublishedExample[];
  faults: ExampleFault[];
  entries: EntryPoint[];
  byName: EntriesByName;
  globals: Set<string>;
}

/** The fenced blocks of one `@example` tag's text; text with no fence is one block. */
export function fencedBlocks(text: string): string[] {
  const blocks: string[] = [];
  const fence = /```([\w-]*)[ \t]*\n([\s\S]*?)\n[ \t]*```/g;
  let seen = false;
  for (const match of text.matchAll(fence)) {
    seen = true;
    if (CODE_LANGUAGES.has(match[1].toLowerCase())) blocks.push(match[2]);
  }
  if (!seen && text.trim() !== "") blocks.push(text);
  return blocks;
}

function tagText(tag: ts.JSDocTag): string {
  return ts.getTextOfJSDocComment(tag.comment) ?? "";
}

/** Every `@example` block under the declarations of one export, members included. */
function examplesOfDeclaration(
  declaration: ts.Node,
  into: (code: string) => void,
): void {
  const seen = new Set<ts.JSDocTag>();
  const visit = (node: ts.Node): void => {
    for (const tag of ts.getJSDocTags(node)) {
      if (tag.tagName.text !== "example" || seen.has(tag)) continue;
      seen.add(tag);
      for (const block of fencedBlocks(tagText(tag))) into(block);
    }
    ts.forEachChild(node, visit);
  };
  visit(declaration);
}

type EntriesByName = Map<string, EntryPoint[]>;

/** The names the compiler's own library files declare globally, such as `undefined`-adjacent `ReadonlyArray` and `HTMLElement`. */
function libraryGlobals(program: ts.Program): Set<string> {
  const names = new Set(["undefined", "NaN", "Infinity", "globalThis"]);
  for (const sf of program.getSourceFiles()) {
    if (!program.isSourceFileDefaultLibrary(sf)) continue;
    for (const statement of sf.statements) {
      if (ts.isVariableStatement(statement)) {
        for (const d of statement.declarationList.declarations) {
          if (ts.isIdentifier(d.name)) names.add(d.name.text);
        }
        continue;
      }
      const named =
        ts.isFunctionDeclaration(statement) ||
        ts.isClassDeclaration(statement) ||
        ts.isInterfaceDeclaration(statement) ||
        ts.isTypeAliasDeclaration(statement) ||
        ts.isModuleDeclaration(statement) ||
        ts.isEnumDeclaration(statement);
      if (named && statement.name && ts.isIdentifier(statement.name)) {
        names.add(statement.name.text);
      }
    }
  }
  return names;
}

function specifierOf(entry: EntryPoint): string {
  return entry.subpath === "."
    ? entry.pkg
    : `${entry.pkg}/${entry.subpath.slice(2)}`;
}

/** Compiler options for a package's programs, with every author entry point resolved to its source. */
function optionsFor(
  root: string,
  dir: string,
  entries: readonly EntryPoint[],
): ts.CompilerOptions {
  return {
    ...compilerOptions(dir, root),
    rootDir: undefined,
    noImplicitAny: false,
    baseUrl: root,
    paths: Object.fromEntries(
      entries.map((e) => [specifierOf(e), [join(e.dir, e.file)]]),
    ),
  };
}

/** The examples on one package's exports, and which entry points export each name. */
function readPackage(
  root: string,
  dir: string,
  entries: readonly EntryPoint[],
): {
  examples: PublishedExample[];
  byName: EntriesByName;
  globals: Set<string>;
} {
  const program = ts.createProgram(
    entries.map((e) => join(root, e.dir, e.file)),
    optionsFor(root, dir, entries),
  );
  const checker = program.getTypeChecker();
  const byName: EntriesByName = new Map();
  const examples: PublishedExample[] = [];
  const graded = new Set<ts.Symbol>();
  for (const entry of entries) {
    const sf = program.getSourceFile(join(root, entry.dir, entry.file));
    const moduleSymbol = sf && checker.getSymbolAtLocation(sf);
    if (!moduleSymbol) continue;
    for (const exported of checker.getExportsOfModule(moduleSymbol)) {
      byName.set(exported.name, [...(byName.get(exported.name) ?? []), entry]);
      if (entry.dir !== dir) continue;
      const symbol =
        exported.flags & ts.SymbolFlags.Alias
          ? checker.getAliasedSymbol(exported)
          : exported;
      if (graded.has(symbol)) continue;
      graded.add(symbol);
      for (const declaration of symbol.declarations ?? []) {
        if (declaration.getSourceFile().fileName.includes("/node_modules/")) {
          continue;
        }
        examplesOfDeclaration(declaration, (code) => {
          examples.push({
            pkg: entry.pkg,
            dir,
            subpath: entry.subpath,
            owner: exported.name,
            code,
          });
        });
      }
    }
  }
  return { examples, byName, globals: libraryGlobals(program) };
}

/** The names a fragment uses and does not declare: identifiers outside a property-name position. */
function freeNames(code: string): Set<string> {
  const sf = ts.createSourceFile(
    "example.tsx",
    code,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const declared = new Set<string>();
  const used = new Set<string>();
  const declare = (name: ts.BindingName | ts.Identifier | undefined): void => {
    if (!name) return;
    if (ts.isIdentifier(name)) declared.add(name.text);
    else
      for (const el of name.elements) {
        if (ts.isBindingElement(el)) declare(el.name);
      }
  };
  const visit = (node: ts.Node): void => {
    if (
      ts.isVariableDeclaration(node) ||
      ts.isParameter(node) ||
      ts.isBindingElement(node) ||
      ts.isFunctionDeclaration(node) ||
      ts.isClassDeclaration(node) ||
      ts.isTypeAliasDeclaration(node) ||
      ts.isInterfaceDeclaration(node) ||
      ts.isEnumDeclaration(node)
    ) {
      declare(node.name);
    }
    if (ts.isIdentifier(node)) {
      const parent = node.parent;
      const propertyName =
        (ts.isPropertyAccessExpression(parent) && parent.name === node) ||
        (ts.isPropertyAssignment(parent) && parent.name === node) ||
        (ts.isJsxAttribute(parent) && parent.name === node) ||
        (ts.isPropertySignature(parent) && parent.name === node) ||
        (ts.isQualifiedName(parent) && parent.right === node);
      if (!propertyName) used.add(node.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  used.delete("const");
  for (const name of declared) used.delete(name);
  return used;
}

/** The program path for one example's virtual module. */
function virtualPath(root: string, dir: string, n: number): string {
  return join(root, dir, `__published_example_${n}__.tsx`);
}

/**
 * Names an example may use without declaring: the ones it would import from
 * React.
 */
const REACT_NAMES = new Set([
  "CSSProperties",
  "ComponentType",
  "FC",
  "Fragment",
  "ReactElement",
  "ReactNode",
  "useCallback",
  "useContext",
  "useEffect",
  "useId",
  "useLayoutEffect",
  "useMemo",
  "useReducer",
  "useRef",
  "useState",
]);

/**
 * A free name no entry point exports is the reader's own context, such as
 * `onClose`, `tank` or `StageList`, and is left undeclared in an example and
 * typed `any`. A hook is not: `use` followed by a capital names something an
 * author imports, so a hook no entry point exports is a fault.
 */
const HOOK_NAME = /^use[A-Z]/;

/**
 * Whether a free name is the environment's rather than the reader's. A DOM
 * global is only taken for one when it is capitalised or a runtime service,
 * because `open`, `name` and `status` are also what an example calls its own
 * values.
 */
const RUNTIME_GLOBALS = new Set([
  "console",
  "document",
  "fetch",
  "localStorage",
  "navigator",
  "performance",
  "sessionStorage",
  "setInterval",
  "setTimeout",
  "undefined",
  "window",
]);

function isGlobal(name: string, globals: ReadonlySet<string>): boolean {
  return (
    RUNTIME_GLOBALS.has(name) ||
    (globals.has(name) && name.charAt(0) !== name.charAt(0).toLowerCase())
  );
}

/**
 * Diagnostics that follow from a context name being typed `any` rather than
 * from the example: a generic inferred from an `any` argument is `unknown`.
 */
const CONTEXT_ARTEFACTS = (d: ts.Diagnostic): boolean =>
  d.code === 18046 ||
  ts.flattenDiagnosticMessageText(d.messageText, " ").includes("<unknown>");

/** The module an example is checked as: imports for the names it leaves free, then its body. */
export function wrapExample(
  example: Pick<PublishedExample, "pkg" | "code">,
  byName: ReadonlyMap<string, readonly EntryPoint[]>,
  globals: ReadonlySet<string>,
): string {
  const code = example.code.replace(
    /(\/>|<\/[\w.]+>)[ \t]*\n((?:[ \t]*\/\/.*\n|[ \t]*\n)*)(?=<[A-Za-z>])/g,
    "$1;\n$2",
  );
  const sf = ts.createSourceFile(
    "example.tsx",
    code,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const hoisted: string[] = [];
  const hoistedNames = new Set<string>();
  let body = code;
  for (const statement of [...sf.statements].reverse()) {
    if (
      ts.isModuleDeclaration(statement) &&
      ts.isStringLiteral(statement.name)
    ) {
      hoisted.push(statement.getText(sf));
      body =
        body.slice(0, statement.getFullStart()) + body.slice(statement.end);
      continue;
    }
    if (ts.isImportDeclaration(statement)) {
      hoisted.unshift(statement.getText(sf));
      for (const token of statement.getText(sf).matchAll(/[\w$]+/g)) {
        hoistedNames.add(token[0]);
      }
      body =
        body.slice(0, statement.getFullStart()) + body.slice(statement.end);
      continue;
    }
    const jsx =
      ts.isExpressionStatement(statement) &&
      (ts.isJsxElement(statement.expression) ||
        ts.isJsxSelfClosingElement(statement.expression) ||
        ts.isJsxFragment(statement.expression));
    const text = statement.getText(sf).replace(/;$/, "");
    const rewritten = jsx
      ? `void (${text});`
      : text.replace(/^export\s+(default\s+)?/, "");
    body =
      body.slice(0, statement.getStart(sf)) +
      rewritten +
      body.slice(statement.end);
  }
  const imports = new Map<string, string[]>();
  const context: string[] = [];
  for (const name of freeNames(body)) {
    if (hoistedNames.has(name)) continue;
    const entries = byName.get(name);
    if (!entries && isGlobal(name, globals)) continue;
    if (entries && entries.length > 0) {
      const entry =
        entries.find((e) => e.pkg === example.pkg) ??
        entries.find((e) => e.subpath === ".") ??
        entries[0];
      const specifier = specifierOf(entry);
      imports.set(specifier, [...(imports.get(specifier) ?? []), name]);
      continue;
    }
    if (REACT_NAMES.has(name)) {
      imports.set("react", [...(imports.get("react") ?? []), name]);
      continue;
    }
    if (!HOOK_NAME.test(name)) context.push(name);
  }
  return [
    ...[...imports].map(
      ([specifier, names]) =>
        `import { ${names.sort().join(", ")} } from "${specifier}";`,
    ),
    ...hoisted,
    ...context.map(
      (name) => `declare const ${name}: any;\ndeclare type ${name} = any;`,
    ),
    "export async function __example__() {",
    body,
    "}",
  ].join("\n");
}

/** Typechecks examples as written, a program per package. */
export function checkExamples(
  examples: readonly PublishedExample[],
  entries: readonly EntryPoint[],
  index: { byName: EntriesByName; globals: ReadonlySet<string> },
  root = REPO_ROOT,
): ExampleFault[] {
  const faults: ExampleFault[] = [];
  for (const dir of new Set(examples.map((e) => e.dir))) {
    const own = examples.filter((e) => e.dir === dir);
    const options = optionsFor(root, dir, entries);
    const planted = new Map<string, string>();
    own.forEach((example, n) => {
      planted.set(
        virtualPath(root, dir, n),
        wrapExample(example, index.byName, index.globals),
      );
    });
    const host = ts.createCompilerHost(options);
    const getSourceFile = host.getSourceFile.bind(host);
    host.getSourceFile = (name, languageVersion, ...rest) => {
      const text = planted.get(name);
      return text === undefined
        ? getSourceFile(name, languageVersion, ...rest)
        : ts.createSourceFile(name, text, languageVersion, true);
    };
    const fileExists = host.fileExists.bind(host);
    host.fileExists = (name) => planted.has(name) || fileExists(name);
    const readFile = host.readFile.bind(host);
    host.readFile = (name) => planted.get(name) ?? readFile(name);
    const program = ts.createProgram([...planted.keys()], options, host);
    own.forEach((example, n) => {
      const sf = program.getSourceFile(virtualPath(root, dir, n));
      if (!sf) throw new Error(`the program has no example ${n} of ${dir}`);
      const [first] = [
        ...program.getSyntacticDiagnostics(sf),
        ...program.getSemanticDiagnostics(sf),
      ].filter((d) => !CONTEXT_ARTEFACTS(d));
      if (!first) return;
      faults.push({
        example,
        message: `TS${first.code} ${ts.flattenDiagnosticMessageText(first.messageText, " ")}`,
      });
    });
  }
  return faults;
}

/** Every `@example` of every published author entry point, typechecked. */
export function scanPublishedExamples(root = REPO_ROOT): ExampleScan {
  const entries = publishedEntryPoints(root);
  const examples: PublishedExample[] = [];
  const byName: EntriesByName = new Map();
  const globals = new Set<string>();
  for (const dir of new Set(entries.map((e) => e.dir))) {
    const read = readPackage(root, dir, entries);
    examples.push(...read.examples);
    for (const name of read.globals) globals.add(name);
    for (const [name, found] of read.byName) {
      byName.set(name, [...(byName.get(name) ?? []), ...found]);
    }
  }
  return {
    examples,
    faults: checkExamples(examples, entries, { byName, globals }, root),
    entries,
    byName,
    globals,
  };
}

/**
 * Planted examples against the real entry points, by name: whether each was
 * faulted. The `sound` ones must pass and the rest must fault.
 */
export function gradePlant(
  index: { byName: EntriesByName; globals: ReadonlySet<string> },
  entries: readonly EntryPoint[],
  root = REPO_ROOT,
): Map<string, boolean> {
  const sdk = "@ksp-gonogo/sitrep-sdk";
  const kit = "@ksp-gonogo/ui-kit";
  const plants: { name: string; pkg: string; code: string }[] = [
    {
      name: "soundSdk",
      pkg: sdk,
      code: 'const flight = observedValue(useTelemetry("vessel.flight"));\nvoid flight;',
    },
    {
      name: "soundJsxSiblings",
      pkg: kit,
      code: '// two elements\n<Badge tone="warn">a</Badge>\n<Badge>b</Badge>',
    },
    {
      name: "brokenType",
      pkg: sdk,
      code: 'const flight: number = observedValue(useTelemetry("vessel.flight"));\nvoid flight;',
    },
    { name: "brokenProp", pkg: kit, code: '<Badge tone="bogus">a</Badge>' },
    { name: "missingHook", pkg: sdk, code: "useNoSuchHook();" },
    { name: "syntax", pkg: kit, code: "<Badge tone=>a</Badge>" },
  ];
  const faulted = new Set(
    checkExamples(
      plants.map((p) => {
        const entry = entries.find((e) => e.pkg === p.pkg);
        if (!entry) throw new Error(`no entry point for ${p.pkg}`);
        return {
          pkg: p.pkg,
          dir: entry.dir,
          subpath: ".",
          owner: p.name,
          code: p.code,
        };
      }),
      entries,
      index,
      root,
    ).map((f) => f.example.owner),
  );
  return new Map(plants.map((p) => [p.name, faulted.has(p.name)]));
}
