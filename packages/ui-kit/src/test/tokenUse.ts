import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { GROUNDS, STATUS_FILLS } from "@ksp-gonogo/theme";
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
    else if (c === ")") paren = Math.max(0, paren - 1);
    if (paren > 0) continue;
    if (c === "{") {
      // A fragment slot on its own line ahead of a selector is a declaration
      // of the enclosing rule, not part of the selector.
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
    } else if (c === "}") {
      flush(i);
      current = current.parent ?? root;
      start = i + 1;
    } else if (c === ";") {
      flush(i);
      start = i + 1;
    }
  }
  flush(css.length);
  return { node, spans, blocks, slotDecl, quasis, component, parent };
}

function listSources(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name !== "__generated__" && e.name !== "test") listSources(p, out);
    } else if (
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

/**
 * Attribute every colour token reference under `srcRoot` to the property it
 * paints, the role that property plays and the ground beneath it.
 *
 * A token's value is followed through the names it passes along the way (a
 * tone map, a helper that returns a token, a local, a default parameter, a
 * prop a styled component is handed) until it reaches a CSS declaration, an
 * SVG colour attribute or an inline style. A reference that reaches none of
 * them is reported as unplaced rather than dropped.
 *
 * A ground is the nearest background the rule or an enclosing rule paints. A
 * rule that paints none sits on the panel, or on any surface the same file
 * paints, since a component's parts sit on the surfaces it draws.
 */
export function scanTokenUses(srcRoot: string): TokenScan {
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
    if (!spec.startsWith(".")) return null;
    const base = resolve(dirname(from), spec);
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
    }
    return null;
  };

  /**
   * What an identifier is bound to where it is used: a local, a parameter's
   * default, a top-level declaration or an import. `bare` is a binding with no
   * value of its own, such as a destructured prop.
   */
  const binding = (
    id: ts.Identifier,
    sf: ts.SourceFile,
  ): { node: ts.Node; sf: ts.SourceFile } | "bare" | null => {
    const name = id.text;
    const inPattern = (
      p: ts.BindingName,
    ): ts.BindingElement | "plain" | null => {
      if (ts.isIdentifier(p)) return p.text === name ? "plain" : null;
      for (const el of p.elements) {
        if (ts.isOmittedExpression(el)) continue;
        if (ts.isIdentifier(el.name) && el.name.text === name) return el;
        if (!ts.isIdentifier(el.name)) {
          const deeper = inPattern(el.name);
          if (deeper) return deeper;
        }
      }
      return null;
    };
    for (let p: ts.Node | undefined = id.parent; p; p = p.parent) {
      if (ts.isFunctionLike(p)) {
        for (const param of p.parameters) {
          const hit = inPattern(param.name);
          if (hit === "plain") {
            return param.initializer ? { node: param.initializer, sf } : "bare";
          }
          if (hit)
            return hit.initializer ? { node: hit.initializer, sf } : "bare";
        }
      }
      if (ts.isBlock(p) || ts.isCaseClause(p)) {
        for (const st of p.statements) {
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
          if (ts.isFunctionDeclaration(st) && st.name?.text === name) {
            return { node: st, sf };
          }
        }
      }
      if (ts.isSourceFile(p)) return topLevel(p, name);
    }
    return null;
  };

  /** What a styled component's callers in the same file pass for one prop. */
  const propTokens = (
    sf: ts.SourceFile,
    component: string,
    prop: string,
    depth: number,
    seen: Set<ts.Node>,
  ): Set<string> => {
    const out = new Set<string>();
    const visit = (n: ts.Node) => {
      if (
        (ts.isJsxOpeningElement(n) || ts.isJsxSelfClosingElement(n)) &&
        n.tagName.getText(sf) === component
      ) {
        for (const a of n.attributes.properties) {
          if (
            ts.isJsxAttribute(a) &&
            a.name.getText(sf) === prop &&
            a.initializer
          ) {
            for (const t of tokensOf(a.initializer, sf, null, depth, seen)) {
              out.add(t);
            }
          }
        }
      }
      ts.forEachChild(n, visit);
    };
    visit(sf);
    return out;
  };

  /** Every token an expression can evaluate to. */
  const tokensOf = (
    node: ts.Node,
    sf: ts.SourceFile,
    component: string | null,
    depth = 0,
    seen = new Set<ts.Node>(),
  ): Set<string> => {
    const out = new Set<string>();
    if (depth > 6 || seen.has(node)) return out;
    seen.add(node);
    const visit = (n: ts.Node) => {
      if (ts.isTaggedTemplateExpression(n) && isStyledTag(n.tag, sf)) return;
      if (isLiteral(n)) {
        const text = n.getText(sf);
        if (HAS_TOKEN.test(text)) {
          cover(sf, n);
          for (const m of text.matchAll(TOKEN)) out.add(m[1]);
          for (const m of text.matchAll(DYNAMIC_TOKEN)) out.add(`${m[1]}*`);
        }
      }
      if (
        ts.isPropertyAccessExpression(n) &&
        n.name.text.startsWith("$") &&
        component
      ) {
        for (const t of propTokens(
          sf,
          component,
          n.name.text,
          depth + 1,
          seen,
        )) {
          out.add(t);
        }
      }
      if (ts.isIdentifier(n)) {
        const parent = n.parent;
        const isName =
          (ts.isPropertyAccessExpression(parent) && parent.name === n) ||
          (ts.isPropertyAssignment(parent) && parent.name === n) ||
          ts.isBindingElement(parent) ||
          ts.isParameter(parent) ||
          ts.isJsxAttribute(parent);
        if (!isName) {
          const b = binding(n, sf);
          if (b === "bare") {
            if (component) {
              for (const t of propTokens(
                sf,
                component,
                n.text,
                depth + 1,
                seen,
              )) {
                out.add(t);
              }
            }
          } else if (b && !ts.isTaggedTemplateExpression(b.node)) {
            for (const t of tokensOf(
              b.node,
              b.sf,
              component,
              depth + 1,
              seen,
            )) {
              out.add(t);
            }
          }
        }
      }
      ts.forEachChild(n, visit);
    };
    visit(node);
    return out;
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
      if (ts.isJsxElement(n))
        rootTag = n.openingElement.tagName.getText(decl.sf);
      else if (ts.isJsxSelfClosingElement(n))
        rootTag = n.tagName.getText(decl.sf);
      else ts.forEachChild(n, find);
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
    const line = lineOf(sf, pos);
    const file = rel(sf.fileName);
    for (const token of tokens) {
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
        site,
        role: r,
        grounds: r === "ground" ? [] : grounds,
        beside,
      });
    }
  };

  const files = listSources(srcRoot);
  for (const file of files) {
    const sf = source(file);
    if (!sf || !HAS_TOKEN.test(sf.text)) continue;

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

    // A styled component with no ground of its own sits on whatever its JSX
    // parents in this file paint; rendered nowhere here, it sits on the panel.
    const rootOf = new Map<Block, Sheet>();
    const byComponent = new Map<string, Sheet>();
    for (const sh of sheets) {
      if (sh.parent === null) rootOf.set(sh.blocks[0], sh);
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
      const sheet = last ? rootOf.get(last) : undefined;
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
      for (const d of p.decls) for (const t of declTokens(sh, d)) out.add(t);
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
    ): { tokens: Set<string>; grounds: string[] }[] | null => {
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
        const grounds = [...tokensOf(g, sf, bgSheet.component)];
        return {
          tokens: tokensOf(f, sf, sh.component),
          grounds: grounds.length > 0 ? grounds : behind,
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
            // A fill under the box's own text is its ground; a status fill with
            // no text of its own is a mark on what is outside the box.
            const text = boxText(b);
            for (const t of tokens) {
              const ground =
                text || (GROUNDS.includes(t) && !STATUS_FILLS.includes(t));
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
            // An edge in the box's own fill colour is that fill's outline, not a mark.
            const p = paint(b);
            const fill = new Set<string>();
            if (p && boxOf(p.block) === boxOf(b)) {
              const psh = sheetOf.get(p.block) as Sheet;
              for (const x of p.decls) {
                if (!clears(psh, x))
                  for (const t of declTokens(psh, x)) fill.add(t);
              }
            }
            const marks = [...tokens].filter((t) => !fill.has(t));
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

    // SVG colour attributes and inline style objects, on the file's grounds.
    const visitJsx = (n: ts.Node) => {
      if (ts.isJsxOpeningElement(n) || ts.isJsxSelfClosingElement(n)) {
        const tag = n.tagName.getText(sf);
        const intrinsic = /^[a-z]/.test(tag);
        for (const a of n.attributes.properties) {
          if (!ts.isJsxAttribute(a) || !a.initializer) continue;
          const name = a.name.getText(sf);
          if (intrinsic && JSX_COLOUR_ATTRIBUTES.has(name)) {
            const tokens = tokensOf(a.initializer, sf, null);
            const asText = SVG_TEXT.has(tag) && name === "fill";
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
              [DEFAULT_GROUND],
            );
          }
          if (
            name === "style" &&
            ts.isJsxExpression(a.initializer) &&
            a.initializer.expression &&
            ts.isObjectLiteralExpression(a.initializer.expression)
          ) {
            for (const p of a.initializer.expression.properties) {
              if (!ts.isPropertyAssignment(p)) continue;
              const prop = kebab(p.name.getText(sf));
              const tokens = tokensOf(p.initializer, sf, null);
              if (prop.startsWith("--")) {
                for (const t of tokens) {
                  unjudged.push({
                    file: rel(sf.fileName),
                    line: lineOf(sf, p.getStart(sf)),
                    token: t,
                    reason: `set as the custom property ${prop}`,
                  });
                }
                continue;
              }
              const role: Role | null = TEXT_PROPERTIES.has(prop)
                ? "text"
                : BACKGROUND_PROPERTIES.has(prop) ||
                    EDGE_PROPERTY.test(prop) ||
                    MARK_PROPERTY.test(prop)
                  ? "non-text"
                  : null;
              record(
                sf,
                p.getStart(sf),
                `<${tag}> style`,
                prop,
                tokens,
                () => role,
                [DEFAULT_GROUND],
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
