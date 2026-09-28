import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import {
  CONTRAST_FLOOR,
  contrastRatio,
  DECORATIVE,
  EXEMPT,
  GROUNDS,
  STATUS_FILLS,
} from "@ksp-gonogo/theme";
import ts from "typescript";

/**
 * How a colour token is drawn at one call site: as text, as a mark that
 * carries meaning (a dot, a ring, a fill, a stroke, a border), or as the
 * ground other content sits on.
 */
export type Role = "text" | "non-text" | "ground";

export interface TokenUse {
  readonly file: string;
  readonly line: number;
  readonly token: string;
  /**
   * Where in the file: the styled component and the selector of the rule, or
   * the SVG element. Stable across edits that move lines.
   */
  readonly site: string;
  readonly property: string;
  readonly role: Role;
  /** The grounds the token can be drawn on here. Empty for a ground. */
  readonly grounds: readonly string[];
  /**
   * For an edge, the box's own fill beside it. A fill that stands out from the
   * ground is itself the box's boundary, and the edge then carries nothing.
   */
  readonly beside: readonly string[];
}

export interface TokenNote {
  readonly file: string;
  readonly line: number;
  readonly token: string;
  readonly reason: string;
}

export interface TokenScan {
  readonly uses: TokenUse[];
  /** A token reference the scanner could not trace to a property it paints. */
  readonly unplaced: TokenNote[];
  /** A token it traced and deliberately did not judge, with why. */
  readonly unjudged: TokenNote[];
}

const TOKEN = /var\(--color-([a-z0-9-]+)(?=[),\s])/g;
const HAS_TOKEN = /var\(--color-/;
const DYNAMIC_TOKEN = /var\(--color-([a-z0-9-]*)\$\{/g;
const MIXED = /gradient\(|color-mix\(/;
/** A background value that can leave the box unpainted. */
const CLEAR = /transparent|\bnone\b|""|''/;
const DECLARATION = /(^|[\s;{])-?[a-z][-a-z]*\s*:\s*\S/;
const DEFAULT_GROUND = "surface-panel";

const TEXT_PROPERTIES = new Set(["color", "-webkit-text-fill-color"]);
const BACKGROUND_PROPERTIES = new Set(["background", "background-color"]);
/** A property drawn at the box's edge, so it sits against the ground outside it. */
const EDGE_PROPERTY =
  /^(border(-(top|right|bottom|left|block|inline)(-(start|end))?)?(-color)?|outline(-color)?|box-shadow)$/;
const MARK_PROPERTY =
  /^(stroke|fill|stop-color|flood-color|accent-color|caret-color|text-decoration(-color)?|text-shadow|column-rule(-color)?)$/;
const JSX_COLOUR_ATTRIBUTES = new Set([
  "fill",
  "stroke",
  "stopColor",
  "floodColor",
  "color",
]);
const SVG_TEXT = new Set(["text", "tspan", "textPath"]);

const kebab = (s: string) =>
  s.replace(/^["']|["']$/g, "").replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);

type CssNode =
  | ts.TaggedTemplateExpression
  | ts.TemplateExpression
  | ts.NoSubstitutionTemplateLiteral
  | ts.StringLiteral;

interface Block {
  readonly parent: Block | null;
  readonly decls: Decl[];
  /** The selector that opened the block, empty for a sheet's top level. */
  readonly selector: string;
}

interface Decl {
  readonly property: string | null;
  readonly text: string;
  readonly slots: number[];
  readonly offset: number;
}

interface Sheet {
  readonly node: CssNode;
  readonly spans: readonly ts.Expression[];
  readonly blocks: Block[];
  readonly slotDecl: Map<number, { block: Block; decl: Decl | null }>;
  readonly quasis: { synthetic: number; source: number }[];
  readonly component: string | null;
  readonly parent: Block | null;
}

const isLiteral = (
  n: ts.Node,
): n is
  | ts.StringLiteral
  | ts.NoSubstitutionTemplateLiteral
  | ts.TemplateHead
  | ts.TemplateMiddle
  | ts.TemplateTail =>
  ts.isStringLiteral(n) ||
  ts.isNoSubstitutionTemplateLiteral(n) ||
  ts.isTemplateHead(n) ||
  ts.isTemplateMiddle(n) ||
  ts.isTemplateTail(n);

function isStyledTag(tag: ts.Expression, sf: ts.SourceFile): boolean {
  return /^(styled\b|css$|keyframes$|createGlobalStyle$)/.test(tag.getText(sf));
}

/** Read one CSS text (a styled template, a plain template, a string) into blocks. */
function parseSheet(
  node: CssNode,
  sf: ts.SourceFile,
  component: string | null,
  parent: Block | null,
): Sheet {
  const tpl = ts.isTaggedTemplateExpression(node) ? node.template : node;
  const quasis: { synthetic: number; source: number }[] = [];
  const spans: ts.Expression[] = [];
  let synthetic = "";
  const push = (lit: ts.Node, lead: number, trail: number) => {
    const full = lit.getText(sf);
    quasis.push({
      synthetic: synthetic.length,
      source: lit.getStart(sf) + lead,
    });
    synthetic += full.slice(lead, full.length - trail);
  };
  if (ts.isTemplateExpression(tpl)) {
    push(tpl.head, 1, 2);
    tpl.templateSpans.forEach((span, i) => {
      synthetic += `\u27e6${i}\u27e7`;
      spans.push(span.expression);
      push(span.literal, 1, ts.isTemplateTail(span.literal) ? 1 : 2);
    });
  } else {
    push(tpl, 1, 1);
  }
  const css = synthetic.replace(/\/\*[\s\S]*?\*\//g, (m) =>
    m.replace(/[^\n]/g, " "),
  );
  const root: Block = { parent: null, decls: [], selector: "" };
  const blocks: Block[] = [root];
  const slotDecl = new Map<number, { block: Block; decl: Decl | null }>();
  let current = root;
  let start = 0;
  let paren = 0;
  let quote: string | null = null;
  const flush = (end: number) => {
    // A fragment slot on its own line needs no semicolon, so it ends before the declaration that follows it.
    const lead = /^\s*\u27e6\d+\u27e7[ \t]*\n(?=\s*\S)/.exec(
      css.slice(start, end),
    );
    if (lead) {
      flush(start + lead[0].length);
      start += lead[0].length;
    }
    const raw = css.slice(start, end);
    const text = raw.trim();
    if (!text) return;
    const slots = [...text.matchAll(/\u27e6(\d+)\u27e7/g)].map((m) =>
      Number(m[1]),
    );
    const m = /^(-?-?[a-zA-Z][-a-zA-Z]*)\s*:/.exec(text);
    const decl: Decl = {
      property: m ? m[1].toLowerCase() : null,
      text,
      slots,
      offset: start + (raw.length - raw.trimStart().length),
    };
    current.decls.push(decl);
    for (const s of slots) {
      slotDecl.set(s, { block: current, decl: m ? decl : null });
    }
  };
  for (let i = 0; i < css.length; i++) {
    const c = css[i];
    if (quote) {
      if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'") {
      quote = c;
      continue;
    }
    if (c === "(") paren++;
    if (c === ")") paren = Math.max(0, paren - 1);
    if (paren > 0) continue;
    if (c === "{") {
      // A fragment slot on its own line ahead of a selector is a declaration of the enclosing rule, not part of the selector.
      const lead = /^\s*\u27e6\d+\u27e7[ \t]*;?[ \t]*\n(?=\s*\S)/.exec(
        css.slice(start, i),
      );
      if (lead) {
        flush(start + lead[0].length);
        start += lead[0].length;
      }
      const selector = css.slice(start, i);
      for (const m of selector.matchAll(/\u27e6(\d+)\u27e7/g)) {
        slotDecl.set(Number(m[1]), { block: current, decl: null });
      }
      const block: Block = {
        parent: current,
        decls: [],
        selector: selector.trim(),
      };
      blocks.push(block);
      current = block;
      start = i + 1;
      continue;
    }
    if (c === "}") {
      flush(i);
      current = current.parent ?? root;
      start = i + 1;
      continue;
    }
    if (c === ";") {
      flush(i);
      start = i + 1;
    }
  }
  flush(css.length);
  return { node, spans, blocks, slotDecl, quasis, component, parent };
}

/** Whether an element wraps anything other than whitespace. */
function hasContent(el: ts.JsxOpeningElement): boolean {
  return el.parent.children.some(
    (c) => !ts.isJsxText(c) || !c.containsOnlyTriviaWhiteSpaces,
  );
}

function listSources(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name !== "__generated__" && e.name !== "test") listSources(p, out);
      continue;
    }
    if (
      /\.tsx?$/.test(e.name) &&
      !/\.test(-d)?\.tsx?$/.test(e.name) &&
      !e.name.endsWith(".d.ts") &&
      e.name !== "testing.ts"
    ) {
      out.push(p);
    }
  }
  return out;
}

export interface ScanOptions {
  /**
   * Packages whose components the scanned source renders, by import specifier,
   * each mapped to its `src` directory. A token handed to one of their props is
   * followed into it to the property it paints, and judged at the call site
   * that handed it over.
   */
  readonly libraries?: Readonly<Record<string, string>>;
}

/**
 * Where a token crossed into another package's component: the call site that
 * handed it over, carried on the token string so the use is reported there.
 */
const HANDED = "\u0000";

/**
 * The entry of an object literal a token was read from, carried on the token
 * so a text colour and a background read from the same entry of a tone map
 * are paired with each other rather than with every entry. A token read by
 * name carries the entry's position; one read through a computed key carries
 * the key itself, so two maps read with one key (`TEXT[$tone]` on
 * `MUTED[$tone]`) pair entry for entry.
 */
const ENTRY = "\u0001";

const untag = (t: string) => t.split(HANDED)[0].split(ENTRY)[0];
/** A token with its call site dropped and its entry kept. */
const unhanded = (t: string) => t.split(HANDED)[0];
const entryOf = (t: string) => t.split(HANDED)[0].split(ENTRY)[1];
/**
 * The tokens drawn with one read from `entry`: those of the same entry, or,
 * for an entry whose own fill is not a token (a clear one), those no entry
 * names.
 */
function ofEntry(all: readonly string[], entry: string | undefined): string[] {
  if (entry === undefined || !all.some((g) => entryOf(g) !== undefined)) {
    return [...all];
  }
  const same = all.filter((g) => entryOf(g) === entry);
  if (same.length > 0) return same;
  return all.filter((g) => entryOf(g) === undefined);
}

/** Stamps the call site a token crossed into another package at, unless one nearer it already did. */
const handOver = (t: string, handed: string) =>
  t.includes(HANDED) ? t : `${t}${HANDED}${handed}`;
const withEntry = (t: string, entry: string) => {
  if (unhanded(t).includes(ENTRY)) return t;
  const at = t.indexOf(HANDED);
  return at < 0
    ? `${t}${ENTRY}${entry}`
    : `${t.slice(0, at)}${ENTRY}${entry}${t.slice(at)}`;
};

/** Array methods whose callback's first parameter is an element of the receiver. */
const ELEMENT_CALLBACK = new Set([
  "map",
  "flatMap",
  "forEach",
  "filter",
  "find",
  "findLast",
  "some",
  "every",
]);
/** Array methods that return one element of the receiver. */
const ELEMENT_RESULT = new Set(["find", "findLast", "at"]);
/** Array methods that return elements of the receiver. */
const SAME_ELEMENTS = new Set([
  "filter",
  "slice",
  "concat",
  "sort",
  "reverse",
  "toSorted",
  "toReversed",
]);

type Bound =
  | {
      readonly kind: "value";
      readonly node: ts.Node;
      readonly sf: ts.SourceFile;
      /** The property names a destructuring pattern selects from the value. */
      readonly keys: readonly string[];
    }
  | {
      readonly kind: "param";
      readonly fn: ts.SignatureDeclaration;
      readonly index: number;
      readonly keys: readonly string[];
      readonly fallback: ts.Node | undefined;
    };

/**
 * Attribute every colour token reference under `srcRoot` to the property it
 * paints, the role that property plays and the ground beneath it.
 *
 * A token's value is followed through the names it passes along the way (a
 * tone map and the key read from it, a helper that returns a token, a local, a
 * default parameter, an array callback's element, a prop a component is
 * handed, a style object) until it reaches a CSS declaration, an SVG colour
 * attribute or an inline style. A reference that reaches none of them is
 * reported as unplaced rather than dropped.
 *
 * A ground is the nearest background the rule or an enclosing rule paints. A
 * rule that paints none sits on the panel, or on any surface the same file
 * paints, since a component's parts sit on the surfaces it draws.
 */
export function scanTokenUses(
  srcRoot: string,
  options: ScanOptions = {},
): TokenScan {
  const libraries = options.libraries ?? {};
  const roots = [srcRoot, ...Object.values(libraries)];
  const rootOf = (file: string) =>
    roots.find((r) => !relative(r, file).startsWith("..")) ?? null;
  const cache = new Map<string, ts.SourceFile>();
  const source = (path: string): ts.SourceFile | null => {
    const hit = cache.get(path);
    if (hit) return hit;
    if (!existsSync(path)) return null;
    const sf = ts.createSourceFile(
      path,
      readFileSync(path, "utf8"),
      ts.ScriptTarget.Latest,
      true,
      path.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
    );
    cache.set(path, sf);
    return sf;
  };
  const moduleFile = (from: string, spec: string): string | null => {
    const library = libraries[spec];
    if (!spec.startsWith(".") && !library) return null;
    const base = library ?? resolve(dirname(from), spec);
    return (
      [
        `${base}.ts`,
        `${base}.tsx`,
        join(base, "index.ts"),
        join(base, "index.tsx"),
      ].find((c) => existsSync(c)) ?? null
    );
  };

  const uses: TokenUse[] = [];
  const unplaced: TokenNote[] = [];
  const unjudged: TokenNote[] = [];
  const covered = new Set<string>();
  const rel = (p: string) => relative(srcRoot, p);
  const lineOf = (sf: ts.SourceFile, pos: number) =>
    sf.getLineAndCharacterOfPosition(pos).line + 1;
  const cover = (sf: ts.SourceFile, n: ts.Node) =>
    covered.add(`${sf.fileName}:${n.getStart(sf)}`);

  /** A top-level declaration named `name`, following a relative import. */
  const topLevel = (
    sf: ts.SourceFile,
    name: string,
  ): { node: ts.Node; sf: ts.SourceFile } | null => {
    for (const st of sf.statements) {
      if (ts.isFunctionDeclaration(st) && st.name?.text === name) {
        return { node: st, sf };
      }
      if (ts.isVariableStatement(st)) {
        for (const d of st.declarationList.declarations) {
          if (
            ts.isIdentifier(d.name) &&
            d.name.text === name &&
            d.initializer
          ) {
            return { node: d.initializer, sf };
          }
        }
      }
      if (
        ts.isImportDeclaration(st) &&
        st.importClause?.namedBindings &&
        ts.isNamedImports(st.importClause.namedBindings) &&
        ts.isStringLiteral(st.moduleSpecifier)
      ) {
        for (const el of st.importClause.namedBindings.elements) {
          if (el.name.text !== name) continue;
          const target = moduleFile(sf.fileName, st.moduleSpecifier.text);
          const tsf = target ? source(target) : null;
          if (tsf) return topLevel(tsf, (el.propertyName ?? el.name).text);
        }
      }
      if (
        ts.isExportDeclaration(st) &&
        st.moduleSpecifier &&
        ts.isStringLiteral(st.moduleSpecifier)
      ) {
        const target = moduleFile(sf.fileName, st.moduleSpecifier.text);
        const tsf = target ? source(target) : null;
        if (!tsf) continue;
        if (!st.exportClause) {
          const hit = topLevel(tsf, name);
          if (hit) return hit;
          continue;
        }
        if (!ts.isNamedExports(st.exportClause)) continue;
        for (const el of st.exportClause.elements) {
          if (el.name.text === name) {
            return topLevel(tsf, (el.propertyName ?? el.name).text);
          }
        }
      }
    }
    return null;
  };

  /**
   * The declaration an exported name comes from, as `file#name`, through
   * re-exports and barrels.
   */
  const exportedKey = (
    file: string,
    name: string,
    depth = 0,
  ): string | null => {
    const sf = source(file);
    if (!sf || depth > 8) return null;
    const local = localKey(sf, name, depth + 1);
    if (local) return local;
    for (const st of sf.statements) {
      if (!ts.isExportDeclaration(st)) continue;
      const spec =
        st.moduleSpecifier && ts.isStringLiteral(st.moduleSpecifier)
          ? st.moduleSpecifier.text
          : null;
      const target = spec ? moduleFile(file, spec) : null;
      if (!st.exportClause) {
        const hit = target ? exportedKey(target, name, depth + 1) : null;
        if (hit) return hit;
        continue;
      }
      if (!ts.isNamedExports(st.exportClause)) continue;
      for (const el of st.exportClause.elements) {
        if (el.name.text !== name) continue;
        const inner = (el.propertyName ?? el.name).text;
        if (target) return exportedKey(target, inner, depth + 1);
        if (!spec) return localKey(sf, inner, depth + 1);
      }
    }
    return null;
  };

  /** What a name in a file's scope is declared as, as `file#name`. */
  const localKey = (
    sf: ts.SourceFile,
    name: string,
    depth = 0,
  ): string | null => {
    const [head, ...rest] = name.split(".");
    const suffix = rest.length > 0 ? `.${rest.join(".")}` : "";
    for (const st of sf.statements) {
      const declares =
        ((ts.isFunctionDeclaration(st) || ts.isClassDeclaration(st)) &&
          st.name?.text === head) ||
        (ts.isVariableStatement(st) &&
          st.declarationList.declarations.some(
            (d) => ts.isIdentifier(d.name) && d.name.text === head,
          ));
      if (declares) return `${sf.fileName}#${head}${suffix}`;
      if (
        ts.isImportDeclaration(st) &&
        st.importClause?.namedBindings &&
        ts.isNamedImports(st.importClause.namedBindings) &&
        ts.isStringLiteral(st.moduleSpecifier)
      ) {
        for (const el of st.importClause.namedBindings.elements) {
          if (el.name.text !== head) continue;
          const target = moduleFile(sf.fileName, st.moduleSpecifier.text);
          const hit = target
            ? exportedKey(target, (el.propertyName ?? el.name).text, depth + 1)
            : null;
          return hit ? `${hit}${suffix}` : null;
        }
      }
    }
    return null;
  };

  const allFiles = roots.flatMap((r) => listSources(r));
  type Caller = {
    readonly sf: ts.SourceFile;
    readonly el: ts.JsxOpeningElement | ts.JsxSelfClosingElement;
  };
  type Call = { readonly sf: ts.SourceFile; readonly call: ts.CallExpression };
  let index: { jsx: Map<string, Caller[]>; calls: Map<string, Call[]> } | null =
    null;
  /** Every JSX element and call, in every scanned file, by the declaration it names. */
  const indexed = () => {
    if (index) return index;
    const jsx = new Map<string, Caller[]>();
    const calls = new Map<string, Call[]>();
    const add = <Entry>(
      m: Map<string, Entry[]>,
      k: string | null,
      v: Entry,
    ) => {
      if (k) m.set(k, [...(m.get(k) ?? []), v]);
    };
    for (const file of allFiles) {
      const sf = source(file);
      if (!sf) continue;
      const visit = (n: ts.Node) => {
        if (
          (ts.isJsxOpeningElement(n) || ts.isJsxSelfClosingElement(n)) &&
          /^[A-Z]/.test(n.tagName.getText(sf))
        ) {
          add(jsx, localKey(sf, n.tagName.getText(sf)), { sf, el: n });
        }
        if (ts.isCallExpression(n) && ts.isIdentifier(n.expression)) {
          add(calls, localKey(sf, n.expression.text), { sf, call: n });
        }
        ts.forEachChild(n, visit);
      };
      visit(sf);
    }
    index = { jsx, calls };
    return index;
  };
  const callersOf = (key: string): readonly Caller[] =>
    indexed().jsx.get(key) ?? [];
  const callsOf = (key: string): readonly Call[] =>
    indexed().calls.get(key) ?? [];

  /** A named function's declaration key. */
  const functionKey = (
    fn: ts.SignatureDeclaration,
    sf: ts.SourceFile,
  ): string | null => {
    if (ts.isFunctionDeclaration(fn)) {
      return fn.name ? `${sf.fileName}#${fn.name.text}` : null;
    }
    let p: ts.Node = fn;
    while (
      p.parent &&
      (ts.isCallExpression(p.parent) ||
        ts.isParenthesizedExpression(p.parent) ||
        ts.isAsExpression(p.parent))
    ) {
      p = p.parent;
    }
    const d = p.parent;
    return d && ts.isVariableDeclaration(d) && ts.isIdentifier(d.name)
      ? `${sf.fileName}#${d.name.text}`
      : null;
  };

  /** The styled component whose interpolation `fn` is, when it is one. */
  const styledOwner = (fn: ts.Node, sf: ts.SourceFile): string | null => {
    for (let p = fn.parent; p; p = p.parent) {
      if (ts.isTaggedTemplateExpression(p) && isStyledTag(p.tag, sf)) {
        return componentName(p);
      }
      if (ts.isFunctionLike(p) || ts.isSourceFile(p)) return null;
    }
    return null;
  };

  /**
   * What an identifier is bound to where it is used: a local, a destructured
   * value, a top-level declaration, an import, or a parameter of the function
   * it is used in.
   */
  const binding = (id: ts.Identifier, sf: ts.SourceFile): Bound | null => {
    const name = id.text;
    const inPattern = (
      p: ts.BindingName,
    ): { el: ts.BindingElement | null; keys: string[] } | null => {
      if (ts.isIdentifier(p))
        return p.text === name ? { el: null, keys: [] } : null;
      for (const el of p.elements) {
        if (ts.isOmittedExpression(el)) continue;
        const key = ts.isArrayBindingPattern(p)
          ? "*"
          : (el.propertyName ?? el.name).getText(sf);
        if (ts.isIdentifier(el.name) && el.name.text === name) {
          return { el, keys: [key] };
        }
        if (!ts.isIdentifier(el.name)) {
          const deeper = inPattern(el.name);
          if (deeper) return { el: deeper.el, keys: [key, ...deeper.keys] };
        }
      }
      return null;
    };
    for (let p: ts.Node | undefined = id.parent; p; p = p.parent) {
      if (ts.isFunctionLike(p)) {
        for (const [index, param] of p.parameters.entries()) {
          const hit = inPattern(param.name);
          if (!hit) continue;
          return {
            kind: "param",
            fn: p,
            index,
            keys: hit.keys,
            fallback: hit.el ? hit.el.initializer : param.initializer,
          };
        }
      }
      if (
        ts.isForOfStatement(p) &&
        ts.isVariableDeclarationList(p.initializer)
      ) {
        for (const d of p.initializer.declarations) {
          const hit = inPattern(d.name);
          if (hit) {
            return {
              kind: "value",
              node: p.expression,
              sf,
              keys: ["*", ...hit.keys],
            };
          }
        }
      }
      if (ts.isBlock(p) || ts.isCaseClause(p) || ts.isSourceFile(p)) {
        for (const st of p.statements) {
          if (ts.isVariableStatement(st)) {
            for (const d of st.declarationList.declarations) {
              if (!d.initializer) continue;
              const hit = inPattern(d.name);
              if (hit)
                return {
                  kind: "value",
                  node: d.initializer,
                  sf,
                  keys: hit.keys,
                };
            }
          }
          if (ts.isFunctionDeclaration(st) && st.name?.text === name) {
            return { kind: "value", node: st, sf, keys: [] };
          }
        }
      }
      if (ts.isSourceFile(p)) {
        const top = topLevel(p, name);
        return top ? { kind: "value", ...top, keys: [] } : null;
      }
    }
    return null;
  };

  /**
   * What reaching a value collects: token names, or, for a style, the object
   * literals it can be.
   */
  interface Reach {
    readonly want: "tokens" | "objects";
    readonly tokens: Set<string>;
    readonly objects: {
      node: ts.ObjectLiteralExpression;
      sf: ts.SourceFile;
      tag: string | null;
    }[];
    readonly seen: Set<string>;
  }

  /**
   * Every value `node` can evaluate to, following `path`: the property names
   * still to be read from it, outermost first. `*` reads any element or key.
   */
  const reach = (
    node: ts.Node,
    sf: ts.SourceFile,
    component: string | null,
    path: readonly string[],
    depth: number,
    r: Reach,
  ): void => {
    if (depth > 200) return;
    /**
     * Reach another value. `handed` is the call site where it crosses into
     * another package, stamped on what comes back unless something nearer the
     * value already stamped it.
     */
    const sub = (
      n: ts.Node,
      nsf: ts.SourceFile,
      comp: string | null,
      at: readonly string[],
      handed: string | null = null,
    ) => {
      if (at.length > 5) return;
      if (r.want === "objects") {
        const from = r.objects.length;
        reach(n, nsf, comp, at, depth + 1, r);
        for (const o of r.objects.slice(from)) o.tag ??= handed;
        return;
      }
      for (const x of memoTokens(n, nsf, comp, at, depth + 1)) {
        r.tokens.add(handed === null ? x : handOver(x, handed));
      }
    };
    const visit = (n: ts.Node, at: readonly string[]): void => {
      const key = `${sf.fileName}:${n.pos}:${n.end}:${at.join(".")}`;
      if (r.seen.has(key)) return;
      r.seen.add(key);
      if (ts.isTaggedTemplateExpression(n) && isStyledTag(n.tag, sf)) return;
      // An element or a type is never a colour.
      if (
        ts.isJsxElement(n) ||
        ts.isJsxSelfClosingElement(n) ||
        ts.isJsxFragment(n) ||
        ts.isTypeNode(n)
      ) {
        return;
      }
      // A function evaluates to what it returns.
      if (ts.isFunctionLike(n) && "body" in n && n.body) {
        const fnBody = n.body as ts.Node;
        if (!ts.isBlock(fnBody)) {
          visit(fnBody, at);
          return;
        }
        const returns = (x: ts.Node) => {
          if (ts.isReturnStatement(x) && x.expression) visit(x.expression, at);
          if (!ts.isFunctionLike(x)) ts.forEachChild(x, returns);
        };
        ts.forEachChild(fnBody, returns);
        return;
      }
      if (isLiteral(n)) {
        const text = n.getText(sf);
        if (r.want === "tokens" && at.length === 0 && HAS_TOKEN.test(text)) {
          cover(sf, n);
          for (const m of text.matchAll(TOKEN)) r.tokens.add(m[1]);
          for (const m of text.matchAll(DYNAMIC_TOKEN)) {
            r.tokens.add(`${m[1]}*`);
          }
        }
        if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n))
          return;
      }
      if (ts.isObjectLiteralExpression(n)) {
        if (at.length === 0) {
          if (r.want === "objects") {
            r.objects.push({ node: n, sf, tag: null });
            return;
          }
          ts.forEachChild(n, (c) => visit(c, at));
          return;
        }
        const [head, ...rest] = at;
        for (const p of n.properties) {
          if (ts.isSpreadAssignment(p)) {
            visit(p.expression, at);
            continue;
          }
          if (!p.name) continue;
          const named = p.name.getText(sf).replace(/^["']|["']$/g, "");
          if (head !== "*" && named !== head) continue;
          const value = ts.isPropertyAssignment(p) ? p.initializer : p.name;
          if (head === "*" && r.want === "tokens") {
            for (const t of memoTokens(value, sf, component, rest, depth + 1)) {
              r.tokens.add(withEntry(t, `key:${named}`));
            }
            continue;
          }
          if (head === "*" || r.want === "objects") {
            visit(value, rest);
            continue;
          }
          const entry = `${sf.fileName}:${n.pos}`;
          for (const t of memoTokens(value, sf, component, rest, depth + 1)) {
            r.tokens.add(withEntry(t, entry));
          }
        }
        return;
      }
      if (ts.isArrayLiteralExpression(n)) {
        const inner = at[0] === "*" ? at.slice(1) : at;
        for (const e of n.elements) {
          visit(ts.isSpreadElement(e) ? e.expression : e, inner);
        }
        return;
      }
      if (ts.isPropertyAccessExpression(n)) {
        const prop = n.name.text;
        if (prop.startsWith("$") && component) {
          styledProp(sf, component, prop, at);
          return;
        }
        visit(n.expression, [prop, ...at]);
        return;
      }
      if (ts.isElementAccessExpression(n)) {
        const arg = n.argumentExpression;
        const named =
          ts.isStringLiteral(arg) || ts.isNoSubstitutionTemplateLiteral(arg)
            ? arg.text
            : "*";
        visit(n.expression, [named, ...at]);
        return;
      }
      if (
        ts.isCallExpression(n) &&
        ts.isPropertyAccessExpression(n.expression)
      ) {
        const method = n.expression.name.text;
        const receiver = n.expression.expression;
        const [first] = n.arguments;
        if (receiver.getText(sf) === "Object" && first) {
          if (method === "values") visit(first, at);
          if (method === "entries" && at[0] === "*" && at[1] !== "0") {
            visit(first, ["*", ...at.slice(2)]);
          }
          if (method === "values" || method === "entries") return;
        }
        if (ELEMENT_RESULT.has(method)) {
          visit(receiver, ["*", ...at]);
          return;
        }
        if (SAME_ELEMENTS.has(method)) {
          visit(receiver, at);
          for (const a of n.arguments) if (method === "concat") visit(a, at);
          return;
        }
        if (method === "map" || method === "flatMap") {
          const each = method === "map" && at[0] === "*" ? at.slice(1) : at;
          for (const a of n.arguments) visit(a, each);
          return;
        }
        // Any other method returns something of its own, not a property of its receiver.
        for (const a of n.arguments) visit(a, at);
        return;
      }
      // A call to a function the scan can read is what it returns; its arguments reach it through its parameters.
      if (ts.isCallExpression(n) && ts.isIdentifier(n.expression)) {
        const b = binding(n.expression, sf);
        if (b?.kind === "value" && ts.isFunctionLike(b.node)) {
          visit(n.expression, at);
          return;
        }
        // A call it cannot resolve still follows its callee, which may be a function handed in as a prop; a dependency list is never the value.
        visit(n.expression, at);
        for (const a of n.arguments) {
          if (!ts.isArrayLiteralExpression(a)) visit(a, at);
        }
        return;
      }
      // A condition decides which value, and is never one.
      if (ts.isConditionalExpression(n)) {
        visit(n.whenTrue, at);
        visit(n.whenFalse, at);
        return;
      }
      if (ts.isBinaryExpression(n)) {
        const op = n.operatorToken.kind;
        if (op === ts.SyntaxKind.AmpersandAmpersandToken) {
          visit(n.right, at);
          return;
        }
        if (
          op === ts.SyntaxKind.QuestionQuestionToken ||
          op === ts.SyntaxKind.BarBarToken ||
          op === ts.SyntaxKind.PlusToken
        ) {
          visit(n.left, at);
          visit(n.right, at);
        }
        return;
      }
      if (ts.isIdentifier(n)) {
        const parent = n.parent;
        const isName =
          (ts.isPropertyAccessExpression(parent) && parent.name === n) ||
          (ts.isPropertyAssignment(parent) && parent.name === n) ||
          ts.isBindingElement(parent) ||
          ts.isParameter(parent) ||
          ts.isJsxAttribute(parent);
        if (!isName) identifier(n, at);
      }
      ts.forEachChild(n, (c) => visit(c, at));
    };

    const identifier = (n: ts.Identifier, at: readonly string[]) => {
      const b = binding(n, sf);
      if (!b) return;
      if (b.kind === "value") {
        if (ts.isTaggedTemplateExpression(b.node)) return;
        if (ts.isArrayLiteralExpression(b.node))
          pushed(n.text, b.node, b.sf, at);
        sub(b.node, b.sf, component, [...b.keys, ...at]);
        return;
      }
      if (b.fallback) {
        sub(b.fallback, sf, component, at);
      }
      const call = b.fn.parent;
      if (
        b.index === 0 &&
        ts.isCallExpression(call) &&
        call.arguments.includes(b.fn as ts.Expression) &&
        ts.isPropertyAccessExpression(call.expression) &&
        ELEMENT_CALLBACK.has(call.expression.name.text)
      ) {
        sub(call.expression.expression, sf, component, ["*", ...b.keys, ...at]);
        return;
      }
      const owner = styledOwner(b.fn, sf);
      if (owner) {
        const prop = b.keys[0];
        if (prop) styledProp(sf, owner, prop, [...b.keys.slice(1), ...at]);
        return;
      }
      const fnKey = functionKey(b.fn, sf);
      if (!fnKey) return;
      const all = [...b.keys, ...at];
      if (b.index === 0 && /#[A-Z][^.]*$/.test(fnKey) && all.length > 0) {
        supply(fnKey, all[0], all.slice(1));
      }
      for (const c of callsOf(fnKey)) {
        const arg = c.call.arguments[b.index];
        if (arg)
          sub(
            arg,
            c.sf,
            null,
            all,
            crossing(c.sf, arg, `${c.call.expression.getText(c.sf)}()`),
          );
      }
    };

    /** What is pushed onto an array after it is declared, in the scope that declares it. */
    const pushed = (
      name: string,
      array: ts.Node,
      asf: ts.SourceFile,
      at: readonly string[],
    ) => {
      let scope: ts.Node = array;
      while (scope.parent && !ts.isBlock(scope) && !ts.isSourceFile(scope)) {
        scope = scope.parent;
      }
      const each = at[0] === "*" ? at.slice(1) : at;
      const find = (x: ts.Node) => {
        if (
          ts.isCallExpression(x) &&
          ts.isPropertyAccessExpression(x.expression) &&
          (x.expression.name.text === "push" ||
            x.expression.name.text === "unshift") &&
          x.expression.expression.getText(asf) === name
        ) {
          for (const a of x.arguments) sub(a, asf, component, each);
        }
        ts.forEachChild(x, find);
      };
      find(scope);
    };

    /** The call site a token is reported at when it crosses into another package here. */
    const crossing = (from: ts.SourceFile, at: ts.Node, site: string) =>
      rootOf(from.fileName) !== rootOf(sf.fileName)
        ? `${from.fileName}${HANDED}${at.getStart(from)}${HANDED}${site}`
        : null;

    /** What callers of the declaration `key` pass for one prop. */
    const supply = (key: string, prop: string, at: readonly string[]) => {
      for (const c of callersOf(key)) {
        const site = `<${c.el.tagName.getText(c.sf)} ${prop}>`;
        for (const a of c.el.attributes.properties) {
          if (ts.isJsxSpreadAttribute(a)) {
            sub(
              a.expression,
              c.sf,
              null,
              [prop, ...at],
              crossing(c.sf, a, site),
            );
            continue;
          }
          if (a.name.getText(c.sf) !== prop || !a.initializer) continue;
          sub(a.initializer, c.sf, null, at, crossing(c.sf, a, site));
        }
      }
    };

    const styledProp = (
      file: ts.SourceFile,
      owner: string,
      prop: string,
      at: readonly string[],
    ) => supply(`${file.fileName}#${owner}`, prop, at);

    visit(node, path);
  };

  const memo = new Map<string, Set<string>>();
  const pending = new Set<string>();
  /** `reach` for tokens, once per value and path. */
  const memoTokens = (
    node: ts.Node,
    sf: ts.SourceFile,
    component: string | null,
    path: readonly string[],
    depth: number,
  ): Set<string> => {
    const key = `${sf.fileName}:${node.pos}:${node.end}:${component}:${path.join(".")}`;
    const hit = memo.get(key);
    if (hit) return hit;
    // A value already being resolved further up is a cycle, whatever path it is read at now.
    const cycle = `${sf.fileName}:${node.pos}:${node.end}`;
    if (pending.has(cycle)) return new Set();
    pending.add(cycle);
    const r: Reach = {
      want: "tokens",
      tokens: new Set(),
      objects: [],
      seen: new Set(),
    };
    reach(node, sf, component, path, depth, r);
    pending.delete(cycle);
    memo.set(key, r.tokens);
    return r.tokens;
  };

  /** Every token an expression can evaluate to. */
  const tokensOf = (
    node: ts.Node,
    sf: ts.SourceFile,
    component: string | null,
    handed: string | null = null,
  ): Set<string> => {
    const found = memoTokens(node, sf, component, [], 0);
    if (handed === null) return found;
    return new Set([...found].map((t) => handOver(t, handed)));
  };

  /** The object literals a style expression can be. */
  const objectsOf = (node: ts.Node, sf: ts.SourceFile): Reach["objects"] => {
    const r: Reach = {
      want: "objects",
      tokens: new Set(),
      objects: [],
      seen: new Set(),
    };
    reach(node, sf, null, [], 0, r);
    return r.objects;
  };

  /** The styled component a tagged template defines, by its variable name. */
  const componentName = (node: ts.Node): string | null => {
    let p: ts.Node = node;
    while (
      p.parent &&
      (ts.isCallExpression(p.parent) ||
        ts.isPropertyAccessExpression(p.parent) ||
        ts.isAsExpression(p.parent))
    ) {
      p = p.parent;
    }
    const keys: string[] = [];
    while (
      p.parent &&
      ts.isPropertyAssignment(p.parent) &&
      ts.isObjectLiteralExpression(p.parent.parent)
    ) {
      keys.unshift(p.parent.name.getText());
      p = p.parent.parent;
      while (
        p.parent &&
        (ts.isAsExpression(p.parent) ||
          ts.isSatisfiesExpression(p.parent) ||
          ts.isParenthesizedExpression(p.parent))
      ) {
        p = p.parent;
      }
    }
    const d = p.parent;
    return d && ts.isVariableDeclaration(d) && ts.isIdentifier(d.name)
      ? [d.name.text, ...keys].join(".")
      : null;
  };

  /**
   * The ground a function component paints at its root, when that root is a
   * styled component with a background: what anything rendered inside it sits on.
   */
  const componentGround = (sf: ts.SourceFile, tag: string): string[] | null => {
    const decl = topLevel(sf, tag);
    if (!decl || ts.isTaggedTemplateExpression(decl.node)) return null;
    let rootTag: string | null = null;
    const find = (n: ts.Node) => {
      if (rootTag) return;
      if (ts.isJsxElement(n)) {
        rootTag = n.openingElement.tagName.getText(decl.sf);
        return;
      }
      if (ts.isJsxSelfClosingElement(n)) {
        rootTag = n.tagName.getText(decl.sf);
        return;
      }
      ts.forEachChild(n, find);
    };
    find(decl.node);
    if (!rootTag) return null;
    const root = topLevel(decl.sf, rootTag);
    if (
      !root ||
      !ts.isTaggedTemplateExpression(root.node) ||
      !isStyledTag(root.node.tag, root.sf)
    ) {
      return null;
    }
    const sheet = parseSheet(root.node, root.sf, rootTag, null);
    const grounds: string[] = [];
    for (const d of sheet.blocks[0].decls) {
      if (!d.property || !BACKGROUND_PROPERTIES.has(d.property)) continue;
      for (const m of d.text.matchAll(TOKEN)) {
        if (GROUNDS.includes(m[1]) && !STATUS_FILLS.includes(m[1]))
          grounds.push(m[1]);
      }
    }
    return grounds.length > 0 ? grounds : null;
  };

  const record = (
    sf: ts.SourceFile,
    pos: number,
    site: string,
    property: string,
    tokens: Iterable<string>,
    role: (token: string) => Role | null,
    grounds: readonly string[],
    beside: readonly string[] = [],
  ) => {
    for (const tagged of tokens) {
      const [named, handedFile, handedPos, handedSite] = tagged.split(HANDED);
      const token = untag(named);
      const entry = entryOf(named);
      const paired = ofEntry(grounds, entry);
      const drawnOn = paired.length > 0 ? paired : grounds;
      const at = handedFile ? source(handedFile) : sf;
      if (!at || rootOf(at.fileName) !== srcRoot) continue;
      const line = lineOf(at, handedFile ? Number(handedPos) : pos);
      const file = rel(at.fileName);
      if (token.endsWith("*")) {
        if (!token.startsWith("marker-")) {
          unplaced.push({
            file,
            line,
            token,
            reason: "a token name built at runtime",
          });
        }
        continue;
      }
      const r = role(token);
      if (!r) {
        unjudged.push({
          file,
          line,
          token,
          reason: `painted by ${property}, which carries no contrast floor`,
        });
        continue;
      }
      uses.push({
        file,
        line,
        token,
        property,
        site: handedSite ?? site,
        role: r,
        grounds: r === "ground" ? [] : [...new Set(drawnOn.map(untag))],
        beside: ofEntry(beside, entry).map(untag),
      });
    }
  };

  const files = listSources(srcRoot);
  for (const file of allFiles) {
    const sf = source(file);
    if (!sf) continue;

    const sheets: Sheet[] = [];
    const collect = (
      n: ts.Node,
      parent: Block | null,
      component: string | null,
      fragment: boolean,
    ) => {
      const styled = ts.isTaggedTemplateExpression(n) && isStyledTag(n.tag, sf);
      const plain =
        !styled &&
        (ts.isTemplateExpression(n) ||
          ts.isNoSubstitutionTemplateLiteral(n) ||
          ts.isStringLiteral(n)) &&
        !ts.isTaggedTemplateExpression(n.parent) &&
        (fragment || parent === null) &&
        DECLARATION.test(n.getText(sf).slice(1, -1)) &&
        (HAS_TOKEN.test(n.getText(sf)) || ts.isTemplateExpression(n));
      if (styled || plain) {
        const sheet = parseSheet(
          n as CssNode,
          sf,
          styled ? (componentName(n) ?? component) : component,
          parent,
        );
        sheets.push(sheet);
        sheet.spans.forEach((expr, i) => {
          const at = sheet.slotDecl.get(i);
          collect(
            expr,
            at?.block ?? sheet.blocks[0],
            sheet.component,
            !at?.decl,
          );
        });
        return;
      }
      ts.forEachChild(n, (c) => collect(c, parent, component, fragment));
    };
    collect(sf, null, null, false);

    const parentOf = new Map<Block, Block | null>();
    for (const s of sheets) {
      for (const b of s.blocks) parentOf.set(b, b.parent ?? s.parent);
    }

    const declTokens = (s: Sheet, d: Decl): Set<string> => {
      const out = new Set<string>();
      for (const m of d.text.matchAll(TOKEN)) out.add(m[1]);
      for (const i of d.slots) {
        const expr = s.spans[i];
        if (expr) for (const t of tokensOf(expr, sf, s.component)) out.add(t);
      }
      return out;
    };
    const declMixed = (s: Sheet, d: Decl) =>
      MIXED.test(d.text) ||
      d.slots.some((i) => MIXED.test(s.spans[i]?.getText(sf) ?? ""));
    const declPos = (s: Sheet, d: Decl) => {
      let best = s.quasis[0];
      for (const q of s.quasis) if (q.synthetic <= d.offset) best = q;
      return best.source + (d.offset - best.synthetic);
    };

    for (const s of sheets) {
      const tpl = ts.isTaggedTemplateExpression(s.node)
        ? s.node.template
        : s.node;
      const parts = ts.isTemplateExpression(tpl)
        ? [tpl.head, ...tpl.templateSpans.map((x) => x.literal)]
        : [tpl];
      for (const q of parts) if (HAS_TOKEN.test(q.getText(sf))) cover(sf, q);
    }

    const sheetFile = sf.fileName;
    /** Whether a styled component of this file is rendered around content anywhere. */
    function holdsContent(component: string | null): boolean {
      return (
        component !== null &&
        callersOf(`${sheetFile}#${component}`).some(
          (c) => ts.isJsxOpeningElement(c.el) && hasContent(c.el),
        )
      );
    }

    const sheetOf = new Map<Block, Sheet>();
    for (const sh of sheets) for (const b of sh.blocks) sheetOf.set(b, sh);

    /** A block styling the same box as its parent: a state, a pseudo, a fragment. */
    const sameBox = (b: Block): boolean => {
      const sh = sheetOf.get(b);
      if (b === sh?.blocks[0]) return sh.parent !== null;
      return /^&(?:(?:::?[-a-z]+(?:\([^)]*\))?)|\[[^\]]*\])*$/.test(b.selector);
    };
    /** The block that styles the box itself, above any states of it. */
    const boxOf = (b: Block): Block => {
      let cur = b;
      while (sameBox(cur)) {
        const up = parentOf.get(cur);
        if (!up) break;
        cur = up;
      }
      return cur;
    };
    const inactive = (b: Block | null): boolean => {
      for (let cur = b; cur; cur = parentOf.get(cur) ?? null) {
        const own = cur.selector.replace(/:not\((?:[^()]|\([^()]*\))*\)/g, "");
        if (/:disabled|\[disabled|\[aria-disabled="true"\]/.test(own))
          return true;
      }
      return false;
    };
    const names = (b: Block, props: Set<string>): Decl[] =>
      b.decls.filter(
        (d) =>
          d.property !== null &&
          props.has(d.property) &&
          !declMixed(sheetOf.get(b) as Sheet, d) &&
          declTokens(sheetOf.get(b) as Sheet, d).size > 0,
      );
    /** Whether the box names its own text colour, in this block or a state of it. */
    const boxText = (b: Block): boolean => {
      for (let cur: Block | null = b; cur; cur = parentOf.get(cur) ?? null) {
        if (names(cur, TEXT_PROPERTIES).length > 0) return true;
        if (!sameBox(cur)) return false;
      }
      return false;
    };
    const clears = (sh: Sheet, d: Decl) =>
      CLEAR.test(d.text.replace(/\u27e6\d+\u27e7/g, "")) ||
      d.slots.some((i) => CLEAR.test(sh.spans[i]?.getText(sf) ?? ""));

    /** The nearest painted background at or above a block, and the block painting it. */
    const paint = (b: Block | null): { block: Block; decls: Decl[] } | null => {
      for (let cur = b; cur; cur = parentOf.get(cur) ?? null) {
        const bg = names(cur, BACKGROUND_PROPERTIES);
        if (bg.length > 0) return { block: cur, decls: bg };
      }
      return null;
    };

    // A styled component with no ground of its own sits on whatever its JSX parents in this file paint; rendered nowhere here, it sits on the panel.
    const sheetRoot = new Map<Block, Sheet>();
    const byComponent = new Map<string, Sheet>();
    for (const sh of sheets) {
      if (sh.parent === null) sheetRoot.set(sh.blocks[0], sh);
      if (
        sh.parent === null &&
        sh.component &&
        ts.isTaggedTemplateExpression(sh.node)
      ) {
        byComponent.set(sh.component, sh);
      }
    }
    const rendered = (component: string, depth: number): string[] => {
      const found = new Set<string>();
      const visit = (n: ts.Node) => {
        if (
          (ts.isJsxOpeningElement(n) || ts.isJsxSelfClosingElement(n)) &&
          n.tagName.getText(sf) === component
        ) {
          const start = ts.isJsxOpeningElement(n) ? n.parent : n;
          let placed = false;
          for (let p = start.parent; p && !placed; p = p.parent) {
            const tag = ts.isJsxElement(p)
              ? p.openingElement.tagName.getText(sf)
              : ts.isJsxSelfClosingElement(p)
                ? p.tagName.getText(sf)
                : null;
            if (!tag) continue;
            const outer = byComponent.get(tag);
            const g = outer
              ? groundsOf(outer.blocks[0], depth + 1)
              : componentGround(sf, tag);
            if (!g) continue;
            for (const x of g) found.add(x);
            placed = true;
          }
          if (!placed) found.add(DEFAULT_GROUND);
        }
        ts.forEachChild(n, visit);
      };
      visit(sf);
      return found.size > 0 ? [...found] : [DEFAULT_GROUND];
    };
    /** Where the top of a block's chain is drawn, for a chain that paints nothing. */
    const beneath = (b: Block | null, depth: number): string[] => {
      let last: Block | null = null;
      for (let cur = b; cur; cur = parentOf.get(cur) ?? null) last = cur;
      const sheet = last ? sheetRoot.get(last) : undefined;
      if (sheet?.component && depth < 6)
        return rendered(sheet.component, depth);
      return [DEFAULT_GROUND];
    };
    /**
     * Every ground content in `b` can sit on: the nearest painted background,
     * and what is beneath that too wherever the background can be clear.
     */
    const groundsOf = (b: Block | null, depth: number): string[] => {
      const p = paint(b);
      if (!p) return beneath(b, depth);
      const sh = sheetOf.get(p.block) as Sheet;
      const out = new Set<string>();
      for (const d of p.decls) {
        for (const t of declTokens(sh, d)) out.add(unhanded(t));
      }
      if (p.decls.some((d) => clears(sh, d))) {
        for (const t of outside(p.block, depth)) out.add(t);
      }
      return [...out];
    };
    /** What surrounds the box a block styles. */
    const outside = (b: Block, depth: number): string[] => {
      const box = boxOf(b);
      const up = parentOf.get(box);
      return up ? groundsOf(up, depth) : beneath(box, depth);
    };
    const outsideOf = (b: Block) => outside(b, 0);

    /** Both sides of one ternary, when a value is exactly that. */
    const ternary = (
      expr: ts.Expression | undefined,
    ): { test: string; yes: ts.Node; no: ts.Node } | null => {
      let e: ts.Node | undefined = expr;
      while (e && (ts.isArrowFunction(e) || ts.isParenthesizedExpression(e))) {
        e = ts.isArrowFunction(e) ? e.body : e.expression;
      }
      if (!e || !ts.isConditionalExpression(e)) return null;
      return {
        test: e.condition.getText(sf).replace(/\b(props|p)\./g, ""),
        yes: e.whenTrue,
        no: e.whenFalse,
      };
    };

    /**
     * Text and a background chosen by the same ternary are drawn together only
     * branch by branch, so they are paired that way rather than crossed.
     */
    const pairedGrounds = (
      sh: Sheet,
      d: Decl,
      b: Block,
    ): { tokens: Set<string>; grounds: string[]; fill: string[] }[] | null => {
      const p = paint(b);
      if (!p || p.decls.length !== 1 || d.slots.length !== 1) return null;
      const bg = p.decls[0];
      const bgSheet = sheetOf.get(p.block) as Sheet;
      if (bg.slots.length !== 1) return null;
      const fg = ternary(sh.spans[d.slots[0]]);
      const under = ternary(bgSheet.spans[bg.slots[0]]);
      if (!fg || !under || fg.test !== under.test) return null;
      const behind = outside(p.block, 0);
      return [
        [fg.yes, under.yes],
        [fg.no, under.no],
      ].map(([f, g]) => {
        const grounds = [...tokensOf(g, sf, bgSheet.component)].map(untag);
        return {
          tokens: tokensOf(f, sf, sh.component),
          grounds: grounds.length > 0 ? grounds : behind,
          fill: grounds.filter((t) => !CLEAR.test(t)),
        };
      });
    };

    for (const sh of sheets) {
      for (const b of sh.blocks) {
        const site = [
          sh.component ?? "(rule)",
          b.selector.replace(/\u27e6\d+\u27e7/g, "*").replace(/\s+/g, " "),
        ]
          .filter(Boolean)
          .join(" ");
        for (const d of b.decls) {
          const prop = d.property;
          if (!prop || prop.startsWith("--")) continue;
          const tokens = declTokens(sh, d);
          if (tokens.size === 0) continue;
          const pos = declPos(sh, d);
          const note = (reason: string) => {
            if (rootOf(sf.fileName) !== srcRoot) return;
            for (const t of tokens) {
              unjudged.push({
                file: rel(sf.fileName),
                line: lineOf(sf, pos),
                token: t,
                reason,
              });
            }
          };
          if (declMixed(sh, d)) {
            note(`mixed or graded in ${prop}`);
            continue;
          }
          if (inactive(b) && !BACKGROUND_PROPERTIES.has(prop)) {
            note("drawn on an inactive control, which has no contrast floor");
            continue;
          }
          if (BACKGROUND_PROPERTIES.has(prop)) {
            // A fill under the box's own text, or around other content, is its ground; a status fill on an empty box is a mark on what is outside it.
            const box = boxOf(b);
            const boxSheet = sheetOf.get(box);
            const text =
              boxText(b) ||
              (boxSheet !== undefined &&
                box === boxSheet.blocks[0] &&
                boxSheet.parent === null &&
                holdsContent(boxSheet.component));
            for (const t of tokens) {
              const ground =
                text ||
                (GROUNDS.includes(untag(t)) &&
                  !STATUS_FILLS.includes(untag(t)));
              record(
                sf,
                pos,
                site,
                prop,
                [t],
                () => (ground ? "ground" : "non-text"),
                outsideOf(b),
              );
            }
            continue;
          }
          if (EDGE_PROPERTY.test(prop)) {
            // An edge in the box's own fill colour is that fill's outline, not a mark; a fill chosen by the same ternary as the edge is paired branch by branch.
            const p = paint(b);
            const branches =
              p && boxOf(p.block) === boxOf(b) ? pairedGrounds(sh, d, b) : null;
            if (branches) {
              for (const x of branches) {
                const marks = [...x.tokens].filter(
                  (t) => !x.fill.includes(untag(t)),
                );
                record(
                  sf,
                  pos,
                  site,
                  prop,
                  marks,
                  () => "non-text",
                  outsideOf(b),
                  x.fill,
                );
              }
              continue;
            }
            const fill = new Set<string>();
            if (p && boxOf(p.block) === boxOf(b)) {
              const psh = sheetOf.get(p.block) as Sheet;
              for (const x of p.decls) {
                if (!clears(psh, x))
                  for (const t of declTokens(psh, x)) fill.add(untag(t));
              }
            }
            const marks = [...tokens].filter((t) => !fill.has(untag(t)));
            record(sf, pos, site, prop, marks, () => "non-text", outsideOf(b), [
              ...fill,
            ]);
            continue;
          }
          if (TEXT_PROPERTIES.has(prop)) {
            const paired = pairedGrounds(sh, d, b);
            if (paired) {
              for (const x of paired)
                record(sf, pos, site, prop, x.tokens, () => "text", x.grounds);
            } else {
              record(
                sf,
                pos,
                site,
                prop,
                tokens,
                () => "text",
                groundsOf(b, 0),
              );
            }
            continue;
          }
          const role: Role | null = MARK_PROPERTY.test(prop)
            ? "non-text"
            : null;
          record(sf, pos, site, prop, tokens, () => role, groundsOf(b, 0));
        }
      }
    }

    /** The element a tag renders: itself, or the one a styled component in this file wraps. */
    const intrinsicOf = (tag: string): string | null => {
      if (/^[a-z]/.test(tag)) return tag;
      const sheet = byComponent.get(tag);
      if (!sheet || !ts.isTaggedTemplateExpression(sheet.node)) return null;
      const m =
        /^styled(?:\.([a-z][a-zA-Z]*)|\(\s*["']([a-z][a-zA-Z]*)["']\s*\))/.exec(
          sheet.node.tag.getText(sf),
        );
      return m ? (m[1] ?? m[2]) : null;
    };

    /** The ground an element is drawn on: the nearest enclosing element that paints one. */
    const placed = (
      el: ts.JsxOpeningElement | ts.JsxSelfClosingElement,
    ): string[] => {
      const start = ts.isJsxOpeningElement(el) ? el.parent : el;
      for (let p: ts.Node | undefined = start; p; p = p.parent) {
        const tag = ts.isJsxElement(p)
          ? p.openingElement.tagName.getText(sf)
          : ts.isJsxSelfClosingElement(p)
            ? p.tagName.getText(sf)
            : null;
        if (!tag) continue;
        const outer = byComponent.get(tag);
        if (outer) {
          if (paint(outer.blocks[0])) return groundsOf(outer.blocks[0], 1);
          continue;
        }
        const g = /^[A-Z]/.test(tag) ? componentGround(sf, tag) : null;
        if (g) return g;
      }
      return [DEFAULT_GROUND];
    };

    interface StyleProp {
      readonly name: string;
      readonly value: ts.Node;
      readonly sf: ts.SourceFile;
      readonly tag: string | null;
    }
    /** The properties one style object sets, its spreads included. */
    const styleProps = (
      obj: ts.ObjectLiteralExpression,
      osf: ts.SourceFile,
      tag: string | null,
      depth = 0,
    ): StyleProp[] => {
      const out: StyleProp[] = [];
      for (const p of obj.properties) {
        if (ts.isSpreadAssignment(p) && depth < 6) {
          for (const o of objectsOf(p.expression, osf)) {
            out.push(...styleProps(o.node, o.sf, tag ?? o.tag, depth + 1));
          }
          continue;
        }
        if (ts.isPropertyAssignment(p)) {
          out.push({
            name: kebab(p.name.getText(osf)),
            value: p.initializer,
            sf: osf,
            tag,
          });
        }
        if (ts.isShorthandPropertyAssignment(p)) {
          out.push({ name: kebab(p.name.text), value: p.name, sf: osf, tag });
        }
      }
      return out;
    };

    // SVG colour attributes and style objects, on the grounds the element is drawn on.
    const visitJsx = (n: ts.Node) => {
      if (ts.isJsxOpeningElement(n) || ts.isJsxSelfClosingElement(n)) {
        const tag = n.tagName.getText(sf);
        const element = intrinsicOf(tag);
        const intrinsic = element !== null;
        const attr = (name: string) =>
          n.attributes.properties.find(
            (a): a is ts.JsxAttribute =>
              ts.isJsxAttribute(a) && a.name.getText(sf) === name,
          );
        for (const a of n.attributes.properties) {
          if (!ts.isJsxAttribute(a) || !a.initializer) continue;
          const name = a.name.getText(sf);
          if (intrinsic && JSX_COLOUR_ATTRIBUTES.has(name)) {
            const tokens = tokensOf(a.initializer, sf, null);
            const asText = SVG_TEXT.has(element) && name === "fill";
            const fill = attr("fill")?.initializer;
            // A stroke around a fill that stands out is the fill's keyline, as an edge beside a box's own fill is.
            const beside =
              name === "stroke" && fill
                ? [...tokensOf(fill, sf, null)].map(untag)
                : [];
            record(
              sf,
              a.getStart(sf),
              `<${tag}>`,
              name,
              tokens,
              (t) =>
                asText
                  ? "text"
                  : name === "fill" &&
                      GROUNDS.includes(t) &&
                      !STATUS_FILLS.includes(t)
                    ? "ground"
                    : "non-text",
              placed(n),
              beside,
            );
          }
          if (name !== "style" || !ts.isJsxExpression(a.initializer)) continue;
          const expr = a.initializer.expression;
          if (!expr) continue;
          for (const obj of objectsOf(expr, sf)) {
            const props = styleProps(obj.node, obj.sf, obj.tag);
            const valueTokens = (p: StyleProp) =>
              tokensOf(p.value, p.sf, null, p.tag);
            const hasText =
              (ts.isJsxOpeningElement(n) && hasContent(n)) ||
              props.some(
                (p) => TEXT_PROPERTIES.has(p.name) && valueTokens(p).size > 0,
              );
            const fills = [
              ...props.filter((p) => p.name === "fill").map(valueTokens),
              ...[attr("fill")?.initializer]
                .filter((x) => x !== undefined)
                .map((x) => tokensOf(x, sf, null)),
            ].flatMap((set) => [...set].map(untag));
            const own = props
              .filter((p) => BACKGROUND_PROPERTIES.has(p.name))
              .flatMap((p) => [...valueTokens(p)].map(unhanded))
              .filter((t) => GROUNDS.includes(untag(t)));
            const ownNames = own.map(untag);
            const outside = placed(n);
            for (const p of props) {
              const tokens = valueTokens(p);
              if (tokens.size === 0) continue;
              const at = p.value.getStart(p.sf);
              if (p.name.startsWith("--")) {
                if (rootOf(p.sf.fileName) !== srcRoot) continue;
                for (const t of tokens) {
                  unjudged.push({
                    file: rel(p.sf.fileName),
                    line: lineOf(p.sf, at),
                    token: untag(t),
                    reason: `set as the custom property ${p.name}`,
                  });
                }
                continue;
              }
              if (BACKGROUND_PROPERTIES.has(p.name)) {
                for (const t of tokens) {
                  const ground =
                    hasText ||
                    (GROUNDS.includes(untag(t)) &&
                      !STATUS_FILLS.includes(untag(t)));
                  record(
                    p.sf,
                    at,
                    `<${tag}> style`,
                    p.name,
                    [t],
                    () => (ground ? "ground" : "non-text"),
                    outside,
                  );
                }
                continue;
              }
              const role: Role | null = TEXT_PROPERTIES.has(p.name)
                ? "text"
                : EDGE_PROPERTY.test(p.name) || MARK_PROPERTY.test(p.name)
                  ? "non-text"
                  : null;
              const edge = EDGE_PROPERTY.test(p.name);
              record(
                p.sf,
                at,
                `<${tag}> style`,
                p.name,
                edge
                  ? [...tokens].filter((t) => !ownNames.includes(untag(t)))
                  : tokens,
                () => role,
                edge || own.length === 0
                  ? outside
                  : own.some((g) => entryOf(g) !== undefined)
                    ? [...own, ...outside.map(untag)]
                    : own,
                edge ? own : p.name === "stroke" ? fills : [],
              );
            }
          }
        }
      }
      ts.forEachChild(n, visitJsx);
    };
    visitJsx(sf);
  }

  for (const file of files) {
    const sf = source(file);
    if (!sf || !HAS_TOKEN.test(sf.text)) continue;
    const visit = (n: ts.Node) => {
      if (
        isLiteral(n) &&
        HAS_TOKEN.test(n.getText(sf)) &&
        !covered.has(`${sf.fileName}:${n.getStart(sf)}`)
      ) {
        for (const m of n.getText(sf).matchAll(TOKEN)) {
          unplaced.push({
            file: rel(sf.fileName),
            line: lineOf(sf, n.getStart(sf)),
            token: m[1],
            reason: "not traced to a property it paints",
          });
        }
      }
      ts.forEachChild(n, visit);
    };
    visit(sf);
  }

  return { uses, unplaced, unjudged };
}

export interface Finding {
  /** `file site: token property on ground`, stable across edits that move lines. */
  readonly key: string;
  readonly detail: string;
}

/**
 * Every use drawn on a ground it does not clear, against the floor its role
 * sets, and every token or ground the theme does not declare.
 */
export function judgeTokenUses(
  scan: TokenScan,
  tokens: ReadonlyMap<string, string>,
): { findings: Finding[]; unknown: string[] } {
  const findings = new Map<string, Finding>();
  const unknown: string[] = [];
  for (const u of scan.uses) {
    if (!tokens.has(u.token) && !u.token.startsWith("marker-")) {
      unknown.push(`${u.file}:${u.line} ${u.token}`);
      continue;
    }
    if (u.role === "ground" || EXEMPT[u.token]) continue;
    if (DECORATIVE.includes(u.token) && u.role !== "text") continue;
    const fg = tokens.get(u.token) as string;
    for (const ground of u.grounds) {
      const bg = tokens.get(ground);
      if (!bg) {
        unknown.push(`${u.file}:${u.line} ground ${ground}`);
        continue;
      }
      const ratio = contrastRatio(fg, bg);
      const floor = CONTRAST_FLOOR[u.role];
      const fillCarries = u.beside.some((f) => {
        const hex = tokens.get(f);
        return (
          hex !== undefined &&
          contrastRatio(hex, bg) >= CONTRAST_FLOOR["non-text"]
        );
      });
      if (ratio >= floor || fillCarries) continue;
      const key = `${u.file} ${u.site}: ${u.token} ${u.property} on ${ground}`;
      const at = `${u.file}:${u.line}`;
      const prior = findings.get(key);
      findings.set(key, {
        key,
        detail: prior
          ? `${prior.detail}, ${at}`
          : `${u.site}: ${u.token} as ${u.role} (${u.property}) on ${ground}, ${ratio.toFixed(2)}:1 where ${floor}:1 is needed, at ${at}`,
      });
    }
  }
  return { findings: [...findings.values()], unknown };
}
