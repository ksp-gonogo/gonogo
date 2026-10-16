/**
 * The page's colours and type from Gonogo's own design system, read out of
 * `packages/theme/src/tokens.css` when the page is generated. The type is the
 * theme's font stack, which uses JetBrains Mono where it is installed and the
 * system's monospace otherwise, so the page stays a light, readable file.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../../..");
const TOKENS = join(REPO_ROOT, "packages/theme/src/tokens.css");

/** The page's own colour names, each taken from a theme token. */
const FROM_TOKENS = {
  "--bg": "--color-surface-app",
  "--surface": "--color-surface-panel",
  "--raised": "--color-surface-raised",
  "--sunken": "--color-surface-sunken",
  "--text": "--color-text-primary",
  "--muted": "--color-text-muted",
  "--border": "--color-border-subtle",
  "--border-strong": "--color-border-strong",
  "--accent": "--color-accent-bg",
  "--accent-text": "--color-accent-fg",
  "--accent-ink": "--color-text-inverse",
  "--telemetry": "--color-info-text",
  "--command": "--color-caution-text",
  "--danger": "--color-nogo-mark",
  "--mono": "--font-family-mono",
};

/** Every custom property the theme's `:root` declares, with `var()` references followed. */
export function readTokens(css = readFileSync(TOKENS, "utf8")) {
  const declared = new Map();
  const uncommented = css.replace(/\/\*[\s\S]*?\*\//g, "");
  for (const [, name, value] of uncommented.matchAll(
    /(--[\w-]+)\s*:\s*([^;]+);/g,
  ))
    if (!declared.has(name))
      declared.set(name, value.trim().replace(/\s+/g, " "));
  const resolve = (value, depth = 0) =>
    depth > 8
      ? value
      : value.replace(/var\((--[\w-]+)\)/g, (whole, name) =>
          declared.has(name) ? resolve(declared.get(name), depth + 1) : whole,
        );
  return new Map([...declared].map(([name, value]) => [name, resolve(value)]));
}

/** The theme's own border-box reset, copied verbatim so the page sizes boxes as every Gonogo page does. */
export function resetRule(css = readFileSync(TOKENS, "utf8")) {
  const rule =
    /\*,\s*\*::before,\s*\*::after\s*\{\s*box-sizing:\s*border-box;\s*\}/.exec(
      css,
    );
  if (!rule) throw new Error("the theme has no border-box reset to copy");
  return rule[0];
}

export function tokenDeclarations(tokens = readTokens()) {
  return Object.entries(FROM_TOKENS)
    .map(([local, token]) => {
      const value = tokens.get(token);
      if (!value) throw new Error(`the theme has no ${token} token`);
      return `  ${local}: ${value};`;
    })
    .join("\n");
}
