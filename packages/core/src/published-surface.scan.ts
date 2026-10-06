import { join, relative, sep } from "node:path";
import ts from "typescript";
import {
  compilerOptions,
  type EntryPoint,
  publishedEntryPoints,
} from "./published-entry-points";

/**
 * The scan behind `styleguide-published-surface.test.ts`: the type surface a
 * published package presents, derived from its export map and printed as one
 * line per export and one per own member of an interface, class, enum or
 * object-typed alias.
 *
 * A line is `<key> :: <text>`. The key is `<package> <subpath> <Name>` for a
 * declaration and `<package> <subpath> <Name>#<member>` for a member, with a
 * `?` after an optional member's name. Text is printed from the declaration as
 * written, comments stripped and whitespace collapsed, so a doc pass or a
 * reflow never moves it. A function prints as its resolved signature, and a
 * value with no annotation as the checker's type for it.
 *
 * A declaration under `__generated__/` is left out by path: the C# contract
 * gate owns those. A symbol a third-party package declares and the entry point
 * passes through is recorded by name, so upgrading that package does not read
 * as a break of ours.
 */

const REPO_ROOT = join(import.meta.dirname, "..", "..", "..");

const SEPARATOR = " :: ";

/** The key a shape line is declared under. */
export function keyOf(line: string): string {
  const at = line.indexOf(SEPARATOR);
  return at === -1 ? line : line.slice(0, at);
}

/** The key of the declaration a member key belongs to; a declaration key is its own owner. */
function ownerOf(key: string): string {
  const at = key.indexOf("#");
  return at === -1 ? key : key.slice(0, at);
}

/** Whether a key names a member that a caller constructing the type must supply. */
function isRequiredMember(key: string): boolean {
  return key.includes("#") && !key.endsWith("?");
}

export interface ShapeDiff {
  /** Keys the current shape removed or retyped, or added as a required member of an existing owner. */
  breaks: string[];
  /** Keys the current shape added that no frozen line carries. */
  additions: string[];
}

/**
 * What changed between a frozen shape and the current one, by key. A key
 * whose text changed, or that gained a second line (an overload), is a break;
 * so is a new required member on an owner the frozen shape already had, since
 * it breaks everyone who builds that type.
 */
export function diffShape(
  frozen: readonly string[],
  current: readonly string[],
): ShapeDiff {
  const frozenLines = new Set(frozen);
  const currentLines = new Set(current);
  const frozenKeys = new Set(frozen.map(keyOf));
  const frozenOwners = new Set(frozen.map((line) => ownerOf(keyOf(line))));
  const breaks = new Set<string>();
  const additions = new Set<string>();
  for (const line of frozen) {
    if (!currentLines.has(line)) breaks.add(keyOf(line));
  }
  for (const line of current) {
    if (frozenLines.has(line)) continue;
    const key = keyOf(line);
    const retyped = frozenKeys.has(key);
    const newRequired = isRequiredMember(key) && frozenOwners.has(ownerOf(key));
    (retyped || newRequired ? breaks : additions).add(key);
  }
  for (const key of breaks) additions.delete(key);
  return { breaks: [...breaks].sort(), additions: [...additions].sort() };
}

const printer = ts.createPrinter({ removeComments: true });

function print(node: ts.Node, sf: ts.SourceFile): string {
  return printer
    .printNode(ts.EmitHint.Unspecified, node, sf)
    .replace(/\s+/g, " ")
    .trim();
}

const NO_TRUNCATION = ts.TypeFormatFlags.NoTruncation;

/**
 * The checker prints a type it cannot name in scope as `import("<absolute
 * path>")`, which would tie a line to one machine's checkout and one package
 * manager layout. A third-party path reduces to its package name and a
 * workspace path to its package directory, so only a change of package moves it.
 */
function portable(text: string): string {
  return text.replace(/import\("([^"]*)"\)/g, (_, path: string) => {
    const marker = "/node_modules/";
    const at = path.lastIndexOf(marker);
    if (at !== -1) {
      const parts = path.slice(at + marker.length).split("/");
      const name = parts[0].startsWith("@")
        ? `${parts[0]}/${parts[1]}`
        : parts[0];
      return `import("${name}")`;
    }
    const relative = path.startsWith(`${REPO_ROOT}/`)
      ? path.slice(REPO_ROOT.length + 1)
      : path.replace(/^\/virtual\//, "");
    return `import("${relative.replace(/\/(src|dist)\/.*$/, "")}")`;
  });
}

/** A literal's non-ASCII characters as escapes, so a line is the same bytes on every machine and no dash lands in the ledger. */
function ascii(text: string): string {
  return text.replace(
    /\P{ASCII}/gu,
    (c) => `\\u{${(c.codePointAt(0) ?? 0).toString(16)}}`,
  );
}

/** A source file's path from the repo root, without its extension. */
function workspacePath(file: string): string {
  return file
    .replace(`${REPO_ROOT}/`, "")
    .replace(/^\/virtual\//, "")
    .replace(/\.d\.ts$|\.tsx?$/, "");
}

function isGenerated(file: string): boolean {
  return file.includes("/__generated__/");
}

function thirdPartyPackage(file: string): string | null {
  const marker = "/node_modules/";
  const at = file.lastIndexOf(marker);
  if (at === -1) return null;
  const parts = file.slice(at + marker.length).split("/");
  return parts[0].startsWith("@") ? `${parts[0]}/${parts[1]}` : parts[0];
}

function isTypeDeclaration(node: ts.Declaration): boolean {
  return (
    ts.isInterfaceDeclaration(node) ||
    ts.isClassDeclaration(node) ||
    ts.isTypeAliasDeclaration(node) ||
    ts.isEnumDeclaration(node)
  );
}

class Walker {
  readonly lines = new Set<string>();
  readonly names = new Set<string>();
  private readonly exported = new Set<ts.Symbol>();
  private readonly reached = new Map<ts.Symbol, ts.Declaration[]>();

  constructor(
    private readonly checker: ts.TypeChecker,
    private readonly prefix: string,
    private readonly ownedElsewhere: (file: string) => boolean,
  ) {}

  /**
   * Records every export of an entry file, then every type of this package
   * those exports reach without exporting it: an author passes one as a
   * prop or a definition, so a change to it breaks them all the same.
   */
  entry(sf: ts.SourceFile): void {
    const moduleSymbol = this.checker.getSymbolAtLocation(sf);
    if (!moduleSymbol) return;
    this.exports(moduleSymbol, "");
    this.unexported();
  }

  private unexported(): void {
    const queue = [...this.exported].flatMap(
      (symbol) => symbol.declarations ?? [],
    );
    while (queue.length > 0) {
      const node = queue.pop();
      if (!node) continue;
      for (const symbol of this.referencedBy(node)) {
        if (this.exported.has(symbol) || this.reached.has(symbol)) continue;
        const declarations = (symbol.declarations ?? []).filter(
          isTypeDeclaration,
        );
        this.reached.set(symbol, declarations);
        queue.push(...declarations);
      }
    }
    const ordered = [...this.reached].sort(([a], [b]) => {
      const left = a.declarations?.[0]?.getSourceFile().fileName ?? "";
      const right = b.declarations?.[0]?.getSourceFile().fileName ?? "";
      return a.name.localeCompare(b.name) || left.localeCompare(right);
    });
    const taken = new Set<string>();
    for (const [symbol, declarations] of ordered) {
      const file = declarations[0]?.getSourceFile().fileName ?? "";
      const plain = `~${symbol.name}`;
      const name = taken.has(plain) ? `${plain}@${workspacePath(file)}` : plain;
      taken.add(plain);
      for (const declaration of declarations)
        this.declaration(declaration, symbol, name);
    }
  }

  /** The workspace types a declaration's signature or members name, bodies and initialisers left out. */
  private referencedBy(root: ts.Node): ts.Symbol[] {
    const found: ts.Symbol[] = [];
    const visit = (node: ts.Node): void => {
      const name = ts.isTypeReferenceNode(node)
        ? node.typeName
        : ts.isExpressionWithTypeArguments(node)
          ? node.expression
          : null;
      if (name) {
        const raw = this.checker.getSymbolAtLocation(name);
        const symbol =
          raw && raw.flags & ts.SymbolFlags.Alias
            ? this.checker.getAliasedSymbol(raw)
            : raw;
        const files = (symbol?.declarations ?? []).map(
          (d) => d.getSourceFile().fileName,
        );
        if (
          symbol &&
          files.length > 0 &&
          files.every(
            (file) =>
              !isGenerated(file) &&
              thirdPartyPackage(file) === null &&
              !this.ownedElsewhere(file),
          ) &&
          symbol.declarations?.some(isTypeDeclaration)
        ) {
          found.push(symbol);
        }
      }
      ts.forEachChild(node, (child) => {
        if (ts.isBlock(child)) return;
        if (child === Reflect.get(node, "initializer")) return;
        visit(child);
      });
    };
    visit(root);
    return found;
  }

  private exports(moduleSymbol: ts.Symbol, path: string): void {
    for (const exported of this.checker.getExportsOfModule(moduleSymbol)) {
      this.symbol(
        exported,
        path === "" ? exported.name : `${path}.${exported.name}`,
      );
    }
  }

  private add(name: string, text: string, member?: string): void {
    const key = member === undefined ? name : `${name}#${member}`;
    this.lines.add(`${this.prefix} ${key}${SEPARATOR}${ascii(portable(text))}`);
  }

  private symbol(exported: ts.Symbol, name: string): void {
    const symbol =
      exported.flags & ts.SymbolFlags.Alias
        ? this.checker.getAliasedSymbol(exported)
        : exported;
    const declarations = symbol.declarations ?? [];
    const own = declarations.filter(
      (d) => !isGenerated(d.getSourceFile().fileName),
    );
    if (declarations.length > 0 && own.length === 0) return;
    const foreign = own.map((d) =>
      thirdPartyPackage(d.getSourceFile().fileName),
    );
    if (foreign.length > 0 && foreign.every((pkg) => pkg !== null)) {
      this.names.add(name);
      this.add(name, `reexport ${foreign[0]}`);
      return;
    }
    this.names.add(name);
    this.exported.add(symbol);
    const overloaded = own.some(
      (d) => ts.isFunctionDeclaration(d) && d.body === undefined,
    );
    for (const declaration of own) {
      if (
        overloaded &&
        ts.isFunctionDeclaration(declaration) &&
        declaration.body !== undefined
      ) {
        continue;
      }
      this.declaration(declaration, symbol, name);
    }
  }

  private declaration(
    node: ts.Declaration,
    symbol: ts.Symbol,
    name: string,
  ): void {
    const sf = node.getSourceFile();
    if (ts.isInterfaceDeclaration(node)) {
      this.add(
        name,
        `interface${this.typeParameters(node.typeParameters, sf)}${this.heritage(node.heritageClauses, sf)}`,
      );
      this.members(node.members, name, sf);
      return;
    }
    if (ts.isClassDeclaration(node)) {
      const abstract = node.modifiers?.some(
        (m) => m.kind === ts.SyntaxKind.AbstractKeyword,
      );
      this.add(
        name,
        `${abstract ? "abstract " : ""}class${this.typeParameters(node.typeParameters, sf)}${this.heritage(node.heritageClauses, sf)}`,
      );
      this.members(node.members, name, sf);
      return;
    }
    if (ts.isTypeAliasDeclaration(node)) {
      this.typeAlias(node, name, sf);
      return;
    }
    if (ts.isEnumDeclaration(node)) {
      this.enumeration(node, name, sf);
      return;
    }
    if (ts.isFunctionDeclaration(node)) {
      this.add(name, this.signature(node, sf));
      return;
    }
    if (ts.isVariableDeclaration(node)) {
      this.add(
        name,
        node.type
          ? print(node.type, sf)
          : this.checker.typeToString(
              this.checker.getTypeOfSymbolAtLocation(symbol, node),
              node,
              NO_TRUNCATION,
            ),
      );
      return;
    }
    const namespaced =
      ts.isModuleDeclaration(node) ||
      ts.isNamespaceExport(node) ||
      ts.isNamespaceImport(node);
    if (!namespaced) {
      this.add(name, ts.SyntaxKind[node.kind]);
      return;
    }
    this.add(name, "namespace");
    this.exports(symbol, name);
  }

  private typeAlias(
    node: ts.TypeAliasDeclaration,
    name: string,
    sf: ts.SourceFile,
  ): void {
    const head = `type${this.typeParameters(node.typeParameters, sf)}`;
    if (!ts.isTypeLiteralNode(node.type)) {
      this.add(name, `${head} = ${print(node.type, sf)}`);
      return;
    }
    this.add(name, `${head} = {}`);
    this.members(node.type.members, name, sf);
  }

  private enumeration(
    node: ts.EnumDeclaration,
    name: string,
    sf: ts.SourceFile,
  ): void {
    const isConst = ts.getCombinedModifierFlags(node) & ts.ModifierFlags.Const;
    this.add(name, isConst ? "const enum" : "enum");
    for (const member of node.members) {
      const value = this.checker.getConstantValue(member);
      this.add(
        name,
        `= ${JSON.stringify(value) ?? "computed"}`,
        member.name.getText(sf),
      );
    }
  }

  private typeParameters(
    parameters: ts.NodeArray<ts.TypeParameterDeclaration> | undefined,
    sf: ts.SourceFile,
  ): string {
    return parameters
      ? `<${parameters.map((p) => print(p, sf)).join(", ")}>`
      : "";
  }

  private heritage(
    clauses: ts.NodeArray<ts.HeritageClause> | undefined,
    sf: ts.SourceFile,
  ): string {
    return (clauses ?? []).map((c) => ` ${print(c, sf)}`).join("");
  }

  private signature(node: ts.SignatureDeclaration, sf: ts.SourceFile): string {
    const resolved = this.checker.getSignatureFromDeclaration(node);
    if (!resolved) return print(node, sf);
    return this.checker.signatureToString(resolved, node, NO_TRUNCATION);
  }

  private members(
    members: ts.NodeArray<ts.TypeElement | ts.ClassElement>,
    owner: string,
    sf: ts.SourceFile,
  ): void {
    for (const member of members) {
      const flags = ts.getCombinedModifierFlags(member);
      if (flags & ts.ModifierFlags.Private) continue;
      if (member.name && ts.isPrivateIdentifier(member.name)) continue;
      if (
        ts.isSemicolonClassElement(member) ||
        ts.isClassStaticBlockDeclaration(member)
      ) {
        continue;
      }
      const optional =
        "questionToken" in member && member.questionToken ? "?" : "";
      const prefix = [
        flags & ts.ModifierFlags.Static ? "static" : "",
        flags & ts.ModifierFlags.Abstract ? "abstract" : "",
        flags & ts.ModifierFlags.Protected ? "protected" : "",
        flags & ts.ModifierFlags.Readonly ? "readonly" : "",
      ]
        .filter(Boolean)
        .join(" ");
      const label = this.memberLabel(member, sf);
      const body = this.memberText(member, sf);
      this.add(
        owner,
        `${prefix ? `${prefix} ` : ""}${body}`,
        `${label}${optional}`,
      );
    }
  }

  private memberLabel(
    member: ts.TypeElement | ts.ClassElement,
    sf: ts.SourceFile,
  ): string {
    if (ts.isConstructorDeclaration(member)) return "constructor";
    if (ts.isCallSignatureDeclaration(member)) return "()";
    if (ts.isConstructSignatureDeclaration(member)) return "new()";
    if (ts.isIndexSignatureDeclaration(member)) {
      return `[${member.parameters.map((p) => print(p.type ?? p, sf)).join(", ")}]`;
    }
    const kind = ts.isGetAccessorDeclaration(member)
      ? "get "
      : ts.isSetAccessorDeclaration(member)
        ? "set "
        : "";
    return `${kind}${member.name ? member.name.getText(sf) : "?"}`;
  }

  private memberText(
    member: ts.TypeElement | ts.ClassElement,
    sf: ts.SourceFile,
  ): string {
    if (
      ts.isMethodSignature(member) ||
      ts.isMethodDeclaration(member) ||
      ts.isConstructorDeclaration(member) ||
      ts.isCallSignatureDeclaration(member) ||
      ts.isConstructSignatureDeclaration(member) ||
      ts.isGetAccessorDeclaration(member) ||
      ts.isSetAccessorDeclaration(member)
    ) {
      return this.signature(member, sf);
    }
    if (ts.isPropertySignature(member) || ts.isPropertyDeclaration(member)) {
      if (member.type) return print(member.type, sf);
      return this.checker.typeToString(
        this.checker.getTypeAtLocation(member),
        member,
        NO_TRUNCATION,
      );
    }
    if (ts.isIndexSignatureDeclaration(member)) {
      return member.type ? print(member.type, sf) : "any";
    }
    return print(member, sf);
  }
}

/** The shape lines one entry file exports, and the names behind them. */
export function shapeOfEntry(
  program: ts.Program,
  entryFile: string,
  prefix: string,
  ownedElsewhere: (file: string) => boolean = () => false,
): { lines: string[]; names: number } {
  const sf = program.getSourceFile(entryFile);
  if (!sf) throw new Error(`the program has no ${entryFile}`);
  const walker = new Walker(program.getTypeChecker(), prefix, ownedElsewhere);
  walker.entry(sf);
  return { lines: [...walker.lines], names: walker.names.size };
}

/**
 * The shape of a module held in memory, for the planted self-tests: `files` is
 * keyed by path relative to a virtual root, and a `node_modules/` path stands in
 * for a third-party package.
 */
export function shapeOfSource(
  files: Readonly<Record<string, string>>,
  entry: string,
): string[] {
  const root = "/virtual";
  const planted = new Map(
    Object.entries(files).map(([name, text]) => [`${root}/${name}`, text]),
  );
  const options: ts.CompilerOptions = {
    noEmit: true,
    strict: true,
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    skipLibCheck: true,
    types: [],
  };
  const host = ts.createCompilerHost(options);
  const getSourceFile = host.getSourceFile.bind(host);
  host.getSourceFile = (name, version) => {
    const text = planted.get(name);
    return text === undefined
      ? getSourceFile(name, version)
      : ts.createSourceFile(name, text, version);
  };
  host.fileExists = (name) => planted.has(name) || ts.sys.fileExists(name);
  host.readFile = (name) => planted.get(name) ?? ts.sys.readFile(name);
  host.directoryExists = (name) =>
    [...planted.keys()].some((file) => file.startsWith(`${name}/`)) ||
    (ts.sys.directoryExists?.(name) ?? false);
  const entryFile = `${root}/${entry}`;
  const program = ts.createProgram([entryFile], options, host);
  const { lines } = shapeOfEntry(program, entryFile, "plant .");
  return lines.sort();
}

export interface PackageShape {
  /** The shape lines, sorted, keyed `<package> <subpath> <Name>`. */
  lines: string[];
  /** Exported names counted over every entry point, for the census floor. */
  names: number;
  /** The entry points read; empty means discovery failed. */
  entries: EntryPoint[];
}

/** The shape of every published package, by package name. */
export function scanPublishedSurface(
  root = REPO_ROOT,
): Map<string, PackageShape> {
  const all = publishedEntryPoints(root, { authorSurfaceOnly: false });
  const result = new Map<string, PackageShape>();
  const publishedDirs = [...new Set(all.map((e) => e.dir))];
  for (const dir of publishedDirs) {
    const own = all.filter((e) => e.dir === dir);
    const program = ts.createProgram(
      own.map((e) => join(root, dir, e.file)),
      compilerOptions(dir, root),
    );
    const ownedElsewhere = (file: string) => {
      const rel = repoRelative(file, root);
      return publishedDirs.some(
        (other) => other !== dir && rel.startsWith(`${other}/`),
      );
    };
    const lines = new Set<string>();
    let names = 0;
    for (const entry of own) {
      const label = entry.pkg.replace(/^@ksp-gonogo\//, "");
      const found = shapeOfEntry(
        program,
        join(root, dir, entry.file),
        `${label} ${entry.subpath}`,
        ownedElsewhere,
      );
      for (const line of found.lines) lines.add(line);
      names += found.names;
    }
    result.set(own[0].pkg, { lines: [...lines].sort(), names, entries: own });
  }
  return result;
}

/** A path relative to the repo, for messages. */
export function repoRelative(file: string, root = REPO_ROOT): string {
  return relative(root, file).split(sep).join("/");
}
