import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";

/**
 * The scan behind `styleguide-button-tooltips.test.ts`: the button tooltip rule
 * held over the built-in widgets and the bundled Uplinks' clients.
 *
 * The rule is three parts. A button that is a glyph alone, or whose label does
 * not say what it does, shows its accessible name as a tip; a disabled button
 * says why in its tip, or is not disabled; a plain button whose label is the
 * whole story carries no tip. The kit's `Button`, `IconButton` and
 * `ToggleButton` apply the first part themselves and take `disabledReason` for
 * the second, so what this scan reads is the code that steps around them: a
 * button with no name, a raw `<button>` or styled one with no tip of its own, a
 * disabled one with no reason, and a tip that only repeats the visible label.
 *
 * It parses rather than greps, so the words inside a string or a comment are
 * never a hit.
 */

const REPO_ROOT = join(import.meta.dirname, "..", "..", "..");

/** Built-in widgets and the bundled Uplinks' clients, tests and stories aside. */
const SCOPE = [
  "packages/components/src/**/*.tsx",
  "mod/*/client/src/**/*.tsx",
  ":!**/*.test.tsx",
  ":!**/*.stories.tsx",
  ":!**/__generated__/**",
  ":!**/*.characterise.tsx",
];

/** Kit components that apply the rule themselves. */
const KIT_BUTTONS = new Set(["Button", "IconButton", "ToggleButton"]);

export const RULES = [
  "unnamed",
  "untipped-icon",
  "disabled-without-reason",
  "tip-repeats-label",
] as const;
export type ButtonRule = (typeof RULES)[number];

export interface ButtonHit {
  rule: ButtonRule;
  line: number;
  text: string;
}

/** Components that draw a glyph and no words. */
const ICON = /(Icon|Marker|Glyph|Chevron)s?$|^svg$/;

type Kind = "kit" | "raw";

function jsxName(node: ts.JsxOpeningLikeElement): string {
  return node.tagName.getText();
}

/** `const X = styled.button` and `styled(Button)` declarations in one file, by kind. */
function styledButtons(sf: ts.SourceFile): Map<string, Kind> {
  const found = new Map<string, Kind>();
  const visit = (node: ts.Node): void => {
    // A widget's own `WarpButton`-style wrapper that hands its props to a kit button is that kit button.
    if (
      ts.isFunctionDeclaration(node) &&
      node.name &&
      /Button$/.test(node.name.text) &&
      /<(Button|IconButton|ToggleButton)\b/.test(node.getText())
    ) {
      found.set(node.name.text, "kit");
    }
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer
    ) {
      const init = node.initializer;
      const tag = ts.isTaggedTemplateExpression(init)
        ? init.tag
        : ts.isCallExpression(init) && ts.isCallExpression(init.expression)
          ? init.expression
          : ts.isCallExpression(init)
            ? init.expression
            : null;
      if (tag) {
        const text = tag.getText();
        if (/^styled\.button\b/.test(text)) found.set(node.name.text, "raw");
        const wrapped = /^styled\(\s*(\w+)\s*\)/.exec(text);
        if (wrapped && KIT_BUTTONS.has(wrapped[1])) {
          found.set(node.name.text, "kit");
        }
        if (wrapped && wrapped[1] === "TextButton") {
          found.set(node.name.text, "raw");
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return found;
}

function attr(
  node: ts.JsxOpeningLikeElement,
  name: string,
): ts.JsxAttribute | undefined {
  return node.attributes.properties.find(
    (p): p is ts.JsxAttribute =>
      ts.isJsxAttribute(p) && p.name.getText() === name,
  );
}

function hasSpread(node: ts.JsxOpeningLikeElement): boolean {
  return node.attributes.properties.some(ts.isJsxSpreadAttribute);
}

function literalOf(a: ts.JsxAttribute | undefined): string | undefined {
  const init = a?.initializer;
  if (init && ts.isStringLiteral(init)) return init.text;
  if (
    init &&
    ts.isJsxExpression(init) &&
    init.expression &&
    ts.isStringLiteralLike(init.expression)
  ) {
    return init.expression.text;
  }
  return undefined;
}

/** `disabled`, `disabled={true}` or `disabled={expr}`; not `disabled={false}`. */
function isDisabled(node: ts.JsxOpeningLikeElement): boolean {
  const a = attr(node, "disabled");
  if (!a) return false;
  const init = a.initializer;
  if (
    init &&
    ts.isJsxExpression(init) &&
    init.expression?.kind === ts.SyntaxKind.FalseKeyword
  ) {
    return false;
  }
  return true;
}

interface Content {
  /** The element has visible words, or something that could be words. */
  hasText: boolean;
  /** Its only text, when every child is a plain literal. */
  literal?: string;
}

function contentOf(el: ts.JsxElement | ts.JsxSelfClosingElement): Content {
  if (ts.isJsxSelfClosingElement(el)) return { hasText: false };
  const parts: string[] = [];
  let plain = true;
  let hasText = false;
  for (const child of el.children) {
    if (ts.isJsxText(child)) {
      const t = child.text.trim();
      if (t !== "") {
        hasText = true;
        parts.push(t);
      }
      continue;
    }
    if (ts.isJsxExpression(child)) {
      if (!child.expression) continue;
      if (ts.isStringLiteralLike(child.expression)) {
        hasText = true;
        parts.push(child.expression.text);
        continue;
      }
      // Anything computed could be words, so it is not an icon-only button.
      hasText = true;
      plain = false;
      continue;
    }
    if (ts.isJsxElement(child) || ts.isJsxSelfClosingElement(child)) {
      const opening = ts.isJsxElement(child) ? child.openingElement : child;
      const name = jsxName(opening);
      // A component that is not an icon (a quantity, a badge) draws words of its own; an element that holds words counts as words.
      const draws = /^[A-Z]/.test(name) && !ICON.test(name);
      const inner = contentOf(child);
      if (draws || inner.hasText) {
        hasText = true;
        plain = false;
      }
    }
  }
  return { hasText, literal: plain && hasText ? parts.join(" ") : undefined };
}

function tooltipAncestor(node: ts.Node): ts.JsxOpeningLikeElement | undefined {
  for (let p = node.parent; p; p = p.parent) {
    if (
      ts.isJsxElement(p) &&
      /^(Tooltip|HoverCard)$/.test(jsxName(p.openingElement))
    ) {
      return p.openingElement;
    }
  }
  return undefined;
}

/** Every breach of the button tooltip rule in one source text. */
export function buttonTooltipHits(
  source: string,
  file = "planted.tsx",
  known: ReadonlyMap<string, Kind> = new Map(),
): ButtonHit[] {
  const sf = ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const styled = new Map([...known, ...styledButtons(sf)]);
  const lines = source.split("\n");
  const hits: ButtonHit[] = [];
  const hit = (rule: ButtonRule, node: ts.Node): void => {
    const { line } = sf.getLineAndCharacterOfPosition(node.getStart(sf));
    hits.push({ rule, line: line + 1, text: lines[line].trim() });
  };
  const visit = (node: ts.Node): void => {
    if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node)) {
      const opening = ts.isJsxElement(node) ? node.openingElement : node;
      const name = jsxName(opening);
      const kind: Kind | undefined = KIT_BUTTONS.has(name)
        ? "kit"
        : name === "button" || name === "TextButton"
          ? "raw"
          : styled.get(name);
      const hidden = literalOf(attr(opening, "aria-hidden")) === "true";
      if (kind && !hasSpread(opening) && !hidden) {
        const content = contentOf(node);
        const named =
          attr(opening, "aria-label") !== undefined ||
          attr(opening, "aria-labelledby") !== undefined;
        const tip = tooltipAncestor(node);
        if (!content.hasText && !named) hit("unnamed", opening);
        if (!content.hasText && named && kind === "raw" && !tip) {
          hit("untipped-icon", opening);
        }
        if (isDisabled(opening)) {
          const reasoned = attr(opening, "disabledReason") !== undefined;
          if (!(kind === "kit" ? reasoned : tip !== undefined)) {
            hit("disabled-without-reason", opening);
          }
        }
        const tipText = tip ? literalOf(attr(tip, "text")) : undefined;
        if (
          tipText !== undefined &&
          content.literal !== undefined &&
          tipText.trim().toLowerCase() === content.literal.toLowerCase()
        ) {
          hit("tip-repeats-label", opening);
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return hits;
}

/** Every styled button the scope declares, so one defined in a `.styles.tsx` is known where it is used. */
export function styledButtonsIn(
  files: readonly string[],
  root = REPO_ROOT,
): Map<string, Kind> {
  const all = new Map<string, Kind>();
  for (const file of files) {
    let source: string;
    try {
      source = readFileSync(join(root, file), "utf8");
    } catch {
      continue;
    }
    const sf = ts.createSourceFile(
      file,
      source,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TSX,
    );
    for (const [name, kind] of styledButtons(sf)) all.set(name, kind);
  }
  return all;
}

export interface ButtonTooltipScan {
  /** Every file parsed; empty means the listing failed, not that the tree is clean. */
  read: string[];
  hits: Map<string, ButtonHit[]>;
}

export function scopedSources(root = REPO_ROOT): string[] {
  return execFileSync("git", ["ls-files", "-z", "--", ...SCOPE], {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  })
    .split("\0")
    .filter(Boolean);
}

export function scanButtonTooltips(
  files: readonly string[] = scopedSources(),
  root = REPO_ROOT,
): ButtonTooltipScan {
  const hits = new Map<string, ButtonHit[]>();
  const read: string[] = [];
  const known = styledButtonsIn(files, root);
  for (const file of files) {
    let source: string;
    try {
      source = readFileSync(join(root, file), "utf8");
    } catch {
      continue;
    }
    read.push(file);
    const found = buttonTooltipHits(source, file, known);
    if (found.length > 0) hits.set(file, found);
  }
  return { read, hits };
}

/**
 * The gate's verdict on one scan, or `null` when it passes.
 *
 * A scan that read nothing fails as `BLIND` rather than passing: a listing that
 * errored into an empty string, a wrong cwd or a pathspec that stopped
 * matching would otherwise look exactly like a clean tree.
 */
export function buttonTooltipVerdict(scan: ButtonTooltipScan): string | null {
  if (scan.read.length === 0) {
    return "BLIND: the button tooltip scan read no files, so a clean result means nothing";
  }
  if (scan.hits.size === 0) return null;
  const lines = [...scan.hits].flatMap(([file, found]) =>
    found.map((hit) => `  ${file}:${hit.line}  ${hit.rule}  ${hit.text}`),
  );
  return [
    `${lines.length} button(s) break the tooltip rule. A glyph-only button needs an aria-label (the kit shows it as the tip); a disabled button needs a disabledReason; a tip that only repeats the visible label should go:`,
    ...lines,
  ].join("\n");
}
