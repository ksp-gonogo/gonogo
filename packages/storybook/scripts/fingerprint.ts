/**
 * What a review-sheet item is judged on, reduced to one hash per item: the
 * source of the thing itself and the stories that show it.
 *
 * The source half is the file that registers the widget or extension (or, for
 * a ui-kit component, the file its export is declared in) and every file that
 * file reaches through relative imports. The story half is each of the item's
 * stories as written: its own export and the file's meta, the top-level
 * declarations those reach, the fixtures and story-local helpers they import,
 * and the one entry of a harness table they index (a ui-kit preset).
 *
 * Package imports are not followed, and neither is the story harness under
 * `packages/storybook/src`: a change to the ui-kit, the theme, the sdk or the
 * harness alters what many items render without changing their fingerprints.
 * A ui-kit component is an item of its own, so its change is reviewed there.
 *
 * Source is hashed as its syntax, reprinted without comments, so a comment or
 * a reformat leaves an approval standing; other files as their text with line
 * endings normalised. Each piece is keyed by its path relative to the tree it
 * was read from, so the same commit gives the same fingerprints on every
 * machine.
 */
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { loadCsf } from "storybook/internal/csf-tools";
import { ts } from "ts-morph";
import type { TargetKind } from "./generate-stories";

/** One review-sheet item and the story ids it is shown under. */
export interface Subject {
  kind: TargetKind;
  id: string;
  stories: string[];
}

/** An item's fingerprint, or why it has none. */
export type Fingerprint =
  | { hash: string; pieces: string[] }
  | { fault: string };

const REGISTER_CALL = /\bregister(Component|Augment|Contribution)\s*[<(]/;
/** The probe's helper that registers a stand-in augment for one slot, and the id prefix it gives it. */
const SLOT_STUB_HELPER = "plantSlot";
const SLOT_STUB_PREFIX = "planted-slot:";
const SKIPPED_DIRS = new Set(["node_modules", "dist", ".git", ".turbo"]);
const SKIPPED_FILES = /\.(test|spec|stories)\.tsx?$|\.test-d\.ts$/;
const STORY_FILES = /\.stories\.tsx?$/;
const HARNESS = "packages/storybook/src/";
const HARNESS_STORIES = "packages/storybook/src/stories/";
const UI_KIT_INDEX = "packages/ui-kit/src/index.ts";
const STORY_ROOTS = [
  "packages/storybook/dist/stories",
  "packages/storybook/src/stories",
];
const EXTENSIONS = [".ts", ".tsx", ".json"];

function toPosix(path: string): string {
  return path.split(sep).join("/");
}

function read(file: string): string {
  return readFileSync(file, "utf8").replace(/\r\n/g, "\n");
}

function parse(file: string): ts.SourceFile {
  return ts.createSourceFile(
    file,
    read(file),
    ts.ScriptTarget.Latest,
    true,
    file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
}

const PRINTER = ts.createPrinter({ removeComments: true });

/** A source file as its syntax, without comments or formatting; any other file as its text. */
function code(file: string): string {
  if (!/\.tsx?$/.test(file)) return read(file);
  return PRINTER.printFile(parse(file));
}

function walk(dir: string, keep: (file: string) => boolean, out: string[]) {
  if (!existsSync(dir)) return;
  for (const entry of readdirSync(dir)) {
    if (SKIPPED_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      walk(full, keep, out);
      continue;
    }
    if (keep(full)) out.push(full);
  }
}

/** The file a relative specifier names, trying the extensions a bundler would. */
function resolveRelative(from: string, spec: string): string | undefined {
  const base = resolve(dirname(from), spec);
  const stem = base.replace(/\.js$/, "");
  const candidates = [
    base,
    ...EXTENSIONS.map((ext) => `${stem}${ext}`),
    ...EXTENSIONS.map((ext) => join(base, `index${ext}`)),
  ];
  return candidates.find((c) => existsSync(c) && statSync(c).isFile());
}

function isRelative(spec: string): boolean {
  return spec.startsWith("./") || spec.startsWith("../");
}

function stringArg(node: ts.Node | undefined): string | undefined {
  if (!node) return undefined;
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node))
    return node.text;
  return undefined;
}

/** Every module specifier a file imports or re-exports, dynamic imports included. */
function specifiers(source: ts.SourceFile): string[] {
  const out: string[] = [];
  const visit = (node: ts.Node) => {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier
    ) {
      const spec = stringArg(node.moduleSpecifier);
      if (spec) out.push(spec);
    }
    if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword
    ) {
      const spec = stringArg(node.arguments[0]);
      if (spec) out.push(spec);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return out;
}

/** The value of an `id` property, when it is a literal or a same-file `const` of one. */
function literalId(
  arg: ts.ObjectLiteralExpression,
  source: ts.SourceFile,
): string | undefined {
  for (const prop of arg.properties) {
    if (!ts.isPropertyAssignment(prop)) continue;
    if (!ts.isIdentifier(prop.name) || prop.name.text !== "id") continue;
    const direct = stringArg(prop.initializer);
    if (direct !== undefined) return direct;
    if (!ts.isIdentifier(prop.initializer)) return undefined;
    const name = prop.initializer.text;
    for (const statement of source.statements) {
      if (!ts.isVariableStatement(statement)) continue;
      for (const decl of statement.declarationList.declarations) {
        if (ts.isIdentifier(decl.name) && decl.name.text === name) {
          return stringArg(decl.initializer);
        }
      }
    }
  }
  return undefined;
}

interface Site {
  kind: "widget" | "extension";
  /** The id as registered: prefixed with its Uplink client's id when it registers through one. */
  id: string;
  /** Whether the id is known in full, rather than possibly prefixed by an owner the call does not name. */
  full: boolean;
  file: string;
}

/** A call's callee name, and the identifier it is a method of. */
function callee(node: ts.CallExpression): { name: string; on?: string } {
  const expr = node.expression;
  if (ts.isIdentifier(expr)) return { name: expr.text };
  if (!ts.isPropertyAccessExpression(expr)) return { name: "" };
  return {
    name: expr.name.text,
    on: ts.isIdentifier(expr.expression) ? expr.expression.text : undefined,
  };
}

function eachCall(
  source: ts.SourceFile,
  fn: (call: ts.CallExpression) => void,
) {
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node)) fn(node);
    ts.forEachChild(node, visit);
  };
  visit(source);
}

/** Each `const X = defineUplinkClient({ id })`, as the id its registrations are prefixed with. */
function uplinkClients(files: string[]): Map<string, string> {
  const out = new Map<string, string>();
  for (const file of files) {
    const text = read(file);
    if (!text.includes("defineUplinkClient(")) continue;
    const source = parse(file);
    const visit = (node: ts.Node) => {
      if (
        ts.isVariableDeclaration(node) &&
        ts.isIdentifier(node.name) &&
        node.initializer &&
        ts.isCallExpression(node.initializer) &&
        callee(node.initializer).name === "defineUplinkClient"
      ) {
        const arg = node.initializer.arguments[0];
        const id =
          arg && ts.isObjectLiteralExpression(arg)
            ? literalId(arg, source)
            : undefined;
        if (id !== undefined) out.set(node.name.text, id);
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  return out;
}

/**
 * Every literal-id registration in the tree's non-test source, plus the
 * planted slot stubs, which register through {@link SLOT_STUB_HELPER} under
 * {@link SLOT_STUB_PREFIX} and their slot's name.
 */
function registrationSites(root: string): Site[] {
  const files: string[] = [];
  const keep = (file: string) =>
    /\.tsx?$/.test(file) &&
    !SKIPPED_FILES.test(file) &&
    !toPosix(relative(root, file)).startsWith(HARNESS_STORIES);
  walk(join(root, "packages"), keep, files);
  for (const entry of existsSync(join(root, "mod"))
    ? readdirSync(join(root, "mod"))
    : []) {
    walk(join(root, "mod", entry, "client", "src"), keep, files);
  }
  walk(join(root, "mod", "sitrep-sdk", "src"), keep, files);
  const clients = uplinkClients(files);
  const sites: Site[] = [];
  for (const file of files) {
    const text = read(file);
    if (!REGISTER_CALL.test(text) && !text.includes(`${SLOT_STUB_HELPER}(`))
      continue;
    const source = parse(file);
    eachCall(source, (call) => {
      const { name, on } = callee(call);
      const arg = call.arguments[0];
      if (name === SLOT_STUB_HELPER) {
        const slot = stringArg(arg);
        if (slot === undefined) return;
        sites.push({
          kind: "extension",
          id: `${SLOT_STUB_PREFIX}${slot}`,
          full: true,
          file,
        });
        return;
      }
      const match = /^register(Component|Augment|Contribution)$/.exec(name);
      if (!match || !arg || !ts.isObjectLiteralExpression(arg)) return;
      const id = literalId(arg, source);
      if (id === undefined) return;
      const client = on ? clients.get(on) : undefined;
      sites.push({
        kind: match[1] === "Component" ? "widget" : "extension",
        id: client ? `${client}:${id}` : id,
        full: client !== undefined,
        file,
      });
    });
  }
  return sites;
}

/** Each name a module exports, mapped to the file that declares it. */
function exportsOf(
  file: string,
  seen = new Set<string>(),
): Map<string, string> {
  const out = new Map<string, string>();
  if (seen.has(file)) return out;
  seen.add(file);
  const source = parse(file);
  for (const statement of source.statements) {
    if (ts.isExportDeclaration(statement)) {
      const spec = stringArg(statement.moduleSpecifier);
      const target =
        spec && isRelative(spec) ? resolveRelative(file, spec) : undefined;
      if (!statement.exportClause) {
        if (!target) continue;
        for (const [name, at] of exportsOf(target, seen)) {
          if (!out.has(name)) out.set(name, at);
        }
        continue;
      }
      if (!ts.isNamedExports(statement.exportClause)) continue;
      for (const el of statement.exportClause.elements) {
        const inner = (el.propertyName ?? el.name).text;
        const declared = target
          ? (exportsOf(target, new Set(seen)).get(inner) ?? target)
          : file;
        out.set(el.name.text, declared);
      }
      continue;
    }
    const exported = ts
      .getModifiers(statement as ts.HasModifiers)
      ?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
    if (!exported) continue;
    if (ts.isVariableStatement(statement)) {
      for (const decl of statement.declarationList.declarations) {
        if (ts.isIdentifier(decl.name)) out.set(decl.name.text, file);
      }
      continue;
    }
    const named = statement as ts.Statement & { name?: ts.Identifier };
    if (named.name && ts.isIdentifier(named.name))
      out.set(named.name.text, file);
  }
  return out;
}

interface StoryAt {
  file: string;
  exportName: string;
}

/** Every story id the tree's story files declare, with where it is written. */
function storyIndex(root: string): Map<string, StoryAt> {
  const files: string[] = [];
  for (const dir of STORY_ROOTS) {
    walk(join(root, dir), (f) => STORY_FILES.test(f), files);
  }
  const out = new Map<string, StoryAt>();
  for (const file of files) {
    const csf = loadCsf(read(file), {
      fileName: file,
      makeTitle: (title) => title,
    }).parse();
    for (const [exportName, story] of Object.entries(csf._stories)) {
      out.set(story.id, { file, exportName });
    }
  }
  return out;
}

/** A top-level statement's declared names, imports included. */
function declaredNames(statement: ts.Statement): string[] {
  if (ts.isVariableStatement(statement)) {
    return statement.declarationList.declarations.flatMap((d) =>
      ts.isIdentifier(d.name) ? [d.name.text] : [],
    );
  }
  if (ts.isImportDeclaration(statement)) {
    const clause = statement.importClause;
    if (!clause) return [];
    const names = clause.name ? [clause.name.text] : [];
    const bindings = clause.namedBindings;
    if (bindings && ts.isNamespaceImport(bindings))
      names.push(bindings.name.text);
    if (bindings && ts.isNamedImports(bindings))
      names.push(...bindings.elements.map((e) => e.name.text));
    return names;
  }
  const named = statement as ts.Statement & { name?: ts.Node };
  return named.name && ts.isIdentifier(named.name) ? [named.name.text] : [];
}

/** Identifiers a node reads, and the `X.Y` accesses among them. */
function uses(node: ts.Node): { names: Set<string>; members: Set<string> } {
  const names = new Set<string>();
  const members = new Set<string>();
  const visit = (n: ts.Node) => {
    if (ts.isIdentifier(n)) names.add(n.text);
    if (
      ts.isPropertyAccessExpression(n) &&
      ts.isIdentifier(n.expression) &&
      ts.isIdentifier(n.name)
    ) {
      members.add(`${n.expression.text}.${n.name.text}`);
    }
    ts.forEachChild(n, visit);
  };
  visit(node);
  return { names, members };
}

/**
 * What a statement or table entry is called, so that moving it within its
 * file leaves its piece of the fingerprint alone.
 */
function label(node: ts.Node, source: ts.SourceFile): string {
  if (ts.isExportAssignment(node)) return "default";
  if (ts.isStatement(node)) {
    const names = declaredNames(node);
    if (names.length > 0) return names.join(",");
  }
  const named = node as ts.Node & { name?: ts.Node };
  if (
    named.name &&
    (ts.isIdentifier(named.name) || ts.isStringLiteral(named.name))
  ) {
    return `.${named.name.text}`;
  }
  return createHash("sha256").update(node.getText(source)).digest("hex");
}

/** Collects the path-keyed pieces of text one fingerprint is taken over. */
class Pieces {
  readonly parts = new Map<string, string>();
  private readonly modules = new Set<string>();

  constructor(private readonly root: string) {}

  private key(file: string): string {
    return toPosix(relative(this.root, file));
  }

  /** A file's text and everything it reaches through relative imports. */
  module(file: string): void {
    if (this.modules.has(file)) return;
    this.modules.add(file);
    this.parts.set(this.key(file), code(file));
    if (!/\.tsx?$/.test(file)) return;
    for (const spec of specifiers(parse(file))) {
      if (!isRelative(spec)) continue;
      const target = resolveRelative(file, spec);
      if (target) this.module(target);
    }
  }

  private isHarness(file: string): boolean {
    const key = this.key(file);
    return key.startsWith(HARNESS) && !key.startsWith(HARNESS_STORIES);
  }

  /**
   * The statements of `file` that `start` reaches by name, and what they
   * import. Harness imports contribute only the table entries read as `X.Y`.
   */
  statements(file: string, start: ts.Node[], source: ts.SourceFile): void {
    const byName = new Map<string, ts.Statement>();
    for (const statement of source.statements) {
      for (const name of declaredNames(statement)) byName.set(name, statement);
    }
    const queue = [...start];
    const taken = new Set<ts.Node>();
    while (queue.length > 0) {
      const node = queue.pop();
      if (!node || taken.has(node)) continue;
      taken.add(node);
      const { names, members } = uses(node);
      if (!ts.isImportDeclaration(node)) {
        this.parts.set(
          `${this.key(file)}#${label(node, source)}`,
          PRINTER.printNode(ts.EmitHint.Unspecified, node, source),
        );
      }
      for (const name of names) {
        const statement = byName.get(name);
        if (!statement || taken.has(statement)) continue;
        if (!ts.isImportDeclaration(statement)) {
          queue.push(statement);
          continue;
        }
        const spec = stringArg(statement.moduleSpecifier);
        if (!spec || !isRelative(spec)) continue;
        const target = resolveRelative(file, spec);
        if (!target) continue;
        if (!this.isHarness(target)) {
          this.module(target);
          continue;
        }
        const indexed = [...members]
          .filter((m) => m.startsWith(`${name}.`))
          .map((m) => m.slice(name.length + 1));
        if (indexed.length > 0) this.tableEntries(target, name, indexed);
      }
    }
  }

  /** The named properties of an exported object-literal table, and what they reach. */
  private tableEntries(file: string, table: string, keys: string[]): void {
    const source = parse(file);
    const entries: ts.Node[] = [];
    for (const statement of source.statements) {
      if (!ts.isVariableStatement(statement)) continue;
      for (const decl of statement.declarationList.declarations) {
        if (!ts.isIdentifier(decl.name) || decl.name.text !== table) continue;
        let init = decl.initializer;
        while (
          init &&
          (ts.isAsExpression(init) || ts.isSatisfiesExpression(init))
        ) {
          init = init.expression;
        }
        if (!init || !ts.isObjectLiteralExpression(init)) {
          if (decl.initializer) entries.push(decl.initializer);
          continue;
        }
        for (const prop of init.properties) {
          const name =
            prop.name &&
            (ts.isIdentifier(prop.name) || ts.isStringLiteral(prop.name))
              ? prop.name.text
              : undefined;
          if (name && keys.includes(name)) entries.push(prop);
        }
      }
    }
    this.statements(file, entries, source);
  }

  /** One story: its own export, the file's default export, and what they reach. */
  story(at: StoryAt): void {
    const source = parse(at.file);
    const start: ts.Node[] = [];
    for (const statement of source.statements) {
      if (ts.isExportAssignment(statement)) start.push(statement);
      if (
        ts.isVariableStatement(statement) &&
        declaredNames(statement).includes(at.exportName)
      ) {
        start.push(statement);
      }
      if (
        ts.isFunctionDeclaration(statement) &&
        statement.name?.text === at.exportName
      ) {
        start.push(statement);
      }
    }
    this.statements(at.file, start, source);
  }

  hash(): string {
    const h = createHash("sha256");
    for (const key of [...this.parts.keys()].sort()) {
      h.update(key);
      h.update("\0");
      h.update(
        createHash("sha256")
          .update(this.parts.get(key) ?? "")
          .digest(),
      );
      h.update("\0");
    }
    return h.digest("hex").slice(0, 16);
  }
}

/** Reads a tree once and fingerprints its items against it. */
export class Fingerprinter {
  private readonly sites: Site[];
  private readonly primitives: Map<string, string>;
  private readonly stories: Map<string, StoryAt>;

  constructor(readonly root: string) {
    this.sites = registrationSites(root);
    const index = join(root, UI_KIT_INDEX);
    this.primitives = existsSync(index) ? exportsOf(index) : new Map();
    this.stories = storyIndex(root);
  }

  /** The file an item's source half starts from, or why none can be named. */
  sourceOf(subject: Subject): { file: string } | { fault: string } {
    if (subject.kind === "primitive") {
      const file = this.primitives.get(subject.id);
      if (file) return { file };
      return { fault: `ui-kit exports no ${subject.id}` };
    }
    const local = subject.id.slice(subject.id.indexOf(":") + 1);
    const wanted = subject.kind === "widget" ? "widget" : "extension";
    const ofKind = this.sites.filter((s) => s.kind === wanted);
    const exact = ofKind.filter((s) => s.id === subject.id);
    const matched =
      exact.length > 0
        ? exact
        : ofKind.filter((s) => !s.full && s.id === local);
    const files = [...new Set(matched.map((s) => s.file))];
    if (files.length === 1) return { file: files[0] };
    const where = files.map((f) => toPosix(relative(this.root, f))).join(", ");
    return {
      fault:
        files.length === 0
          ? `no file registers ${subject.kind} ${subject.id} with a literal id`
          : `${subject.kind} ${subject.id} is registered in more than one file: ${where}`,
    };
  }

  fingerprint(subject: Subject): Fingerprint {
    const source = this.sourceOf(subject);
    if ("fault" in source) return source;
    if (subject.stories.length === 0) {
      return { fault: `${subject.kind} ${subject.id} has no story` };
    }
    const pieces = new Pieces(this.root);
    pieces.module(source.file);
    for (const id of subject.stories) {
      const at = this.stories.get(id);
      if (!at) return { fault: `story ${id} is in no story file` };
      pieces.story(at);
    }
    return { hash: pieces.hash(), pieces: [...pieces.parts.keys()].sort() };
  }
}
