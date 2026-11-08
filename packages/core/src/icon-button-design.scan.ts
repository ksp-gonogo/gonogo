import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";
import { ratchetRepoRoot } from "./ratchetBaseRef";

/**
 * The scan behind `styleguide-icon-button.test.ts`: a button that is a glyph
 * alone is the kit's `IconButton`, drawn one way, and nothing in the tree
 * restyles it or stands in for it.
 *
 * Three breaches are looked for: `styled(IconButton)`, an `IconButton` given a
 * `style`, `className` or `css` prop, and a glyph-only button of any other
 * kind (a raw `button`, a `styled.button`, a `styled(Button)`, or the kit's
 * `Button`). It parses rather than greps, so the words inside a string or a
 * comment are never a hit.
 */

/** Every tracked source file that draws UI, tests, stories and generated code aside. */
const SCOPE = [
  "packages/*/src/**/*.tsx",
  "mod/**/*.tsx",
  ":!**/*.test.tsx",
  ":!**/*.stories.tsx",
  ":!**/*.characterise.tsx",
  ":!**/__generated__/**",
  ":!**/node_modules/**",
];

/** Files whose button is a drawn mark or a hit area over a surface, never a boxed glyph control, each with why. */
const EXEMPT_FILES: Record<string, string> = {
  "packages/ui-kit/src/CommandDelay/PanelDelayRail.tsx":
    "a hit area over the whole rail with a mark inside it",
  "packages/components/src/GroundTrack/MapPoiLayer.styles.tsx":
    "a map marker, drawn by its own style and placed by the map",
};

export const RULES = [
  "styled-icon-button",
  "icon-button-look-prop",
  "glyph-only-button",
] as const;
export type IconButtonRule = (typeof RULES)[number];

export interface IconButtonHit {
  rule: IconButtonRule;
  line: number;
  text: string;
}

/** Components that draw a glyph and no words. */
const ICON = /(Icon|Marker|Glyph|Chevron)s?$|^svg$/;

/** Tags that draw a button; a styled one is added per file. */
const BUTTON_TAGS = new Set(["button", "Button", "TextButton"]);

/** Props that change how an `IconButton` looks. */
const LOOK_PROPS = new Set(["style", "className", "css"]);

function jsxName(node: ts.JsxOpeningLikeElement): string {
  return node.tagName.getText();
}

/** `const X = styled.button` and `styled(Button|TextButton)` declarations in one file. */
function styledButtons(sf: ts.SourceFile): Set<string> {
  const found = new Set<string>();
  const visit = (node: ts.Node): void => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer &&
      /^styled(\.button\b|\(\s*(Button|TextButton)\s*\))/.test(
        node.initializer.getText(),
      )
    ) {
      found.add(node.name.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return found;
}

/** A string that is a mark and not a word: `×`, `✕`, `▶`, `❚❚`, `?`, `+`. */
function isGlyphText(text: string): boolean {
  const t = text.trim();
  return t !== "" && t.length <= 2 && !/[\p{L}\p{N}]/u.test(t);
}

/** Whether an expression is a glyph on every branch (`a ? "▶" : "❚❚"`). */
function glyphExpression(expr: ts.Expression): boolean {
  if (ts.isStringLiteralLike(expr)) return isGlyphText(expr.text);
  if (ts.isParenthesizedExpression(expr)) {
    return glyphExpression(expr.expression);
  }
  if (ts.isConditionalExpression(expr)) {
    return glyphExpression(expr.whenTrue) && glyphExpression(expr.whenFalse);
  }
  if (ts.isJsxElement(expr) || ts.isJsxSelfClosingElement(expr)) {
    return glyphOnly(expr);
  }
  return false;
}

/**
 * Whether an element's children are a glyph and nothing else: an icon
 * component, a one or two character mark, or a wrapper of either.
 */
function glyphOnly(el: ts.JsxElement | ts.JsxSelfClosingElement): boolean {
  if (ts.isJsxSelfClosingElement(el)) return ICON.test(jsxName(el));
  let glyphs = 0;
  for (const child of el.children) {
    if (ts.isJsxText(child)) {
      const t = child.text.trim();
      if (t === "") continue;
      if (!isGlyphText(t)) return false;
      glyphs += 1;
      continue;
    }
    if (ts.isJsxExpression(child)) {
      if (!child.expression) continue;
      if (!glyphExpression(child.expression)) return false;
      glyphs += 1;
      continue;
    }
    if (ts.isJsxElement(child) || ts.isJsxSelfClosingElement(child)) {
      if (!glyphOnly(child)) return false;
      glyphs += 1;
      continue;
    }
    return false;
  }
  return glyphs > 0;
}

/** Every breach of the icon button design in one source text. */
export function iconButtonHits(
  source: string,
  file = "planted.tsx",
): IconButtonHit[] {
  const sf = ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const styled = styledButtons(sf);
  const lines = source.split("\n");
  const hits: IconButtonHit[] = [];
  const hit = (rule: IconButtonRule, node: ts.Node): void => {
    const { line } = sf.getLineAndCharacterOfPosition(node.getStart(sf));
    hits.push({ rule, line: line + 1, text: lines[line].trim() });
  };
  const visit = (node: ts.Node): void => {
    if (
      ts.isVariableDeclaration(node) &&
      node.initializer &&
      /^styled\(\s*IconButton\s*\)/.test(node.initializer.getText())
    ) {
      hit("styled-icon-button", node);
    }
    if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node)) {
      const opening = ts.isJsxElement(node) ? node.openingElement : node;
      const name = jsxName(opening);
      if (
        name === "IconButton" &&
        opening.attributes.properties.some(
          (p) => ts.isJsxAttribute(p) && LOOK_PROPS.has(p.name.getText()),
        )
      ) {
        hit("icon-button-look-prop", opening);
      }
      if (
        (BUTTON_TAGS.has(name) || styled.has(name)) &&
        ts.isJsxElement(node) &&
        glyphOnly(node)
      ) {
        hit("glyph-only-button", opening);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return hits;
}

export interface IconButtonScan {
  read: string[];
  hits: (IconButtonHit & { file: string })[];
}

/** Every tracked source file in scope, run through {@link iconButtonHits}. */
export function scanIconButtons(): IconButtonScan {
  const REPO_ROOT = ratchetRepoRoot();
  const read = execFileSync("git", ["ls-files", "--", ...SCOPE], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  })
    .split("\n")
    .filter(Boolean);
  const hits: IconButtonScan["hits"] = [];
  for (const file of read) {
    const source = readFileSync(join(REPO_ROOT, file), "utf8");
    if (file in EXEMPT_FILES) continue;
    if (!/IconButton|<button|Button\b/.test(source)) continue;
    for (const h of iconButtonHits(source, file)) hits.push({ ...h, file });
  }
  return { read, hits };
}
