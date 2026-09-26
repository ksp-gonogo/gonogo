/**
 * Shared @font-face block for every render harness and script: the same
 * JetBrains Mono faces the app self-hosts (`packages/app/src/styles/fonts.css`),
 * inlined as data URIs so a `file://` render (no dev server, no network) still
 * has the real glyphs to draw instead of falling back to a system font.
 *
 * The face list is read out of that fonts.css rather than kept here as a second
 * list that could drift from it. Each `@import` there names an @fontsource CSS
 * file or a sibling one, and each `@font-face` in that file names the woff2 to
 * inline, relative to itself, and the `unicode-range` it covers. The range is carried over: without it every
 * subset's face claims every codepoint, and the browser picks between
 * same-weight faces by declaration order instead of by script.
 */
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const HERE = dirname(fileURLToPath(import.meta.url));
const APP_FONTS_CSS = join(HERE, "../../app/src/styles/fonts.css");

const IMPORT_RE =
  /@import\s+"((?:@fontsource\/jetbrains-mono|\.)\/[\w./-]+\.css)"/g;
const FONT_FACE_RE = /@font-face\s*\{([^}]*)\}/g;

let cached: Promise<string> | undefined;

/**
 * Every face `fonts.css` self-hosts, as inlined `@font-face` rules. Cached
 * per process: the source file and the package it reads from are both
 * static for the life of a render run.
 */
export function jetbrainsMonoFontFace(): Promise<string> {
  cached ??= build();
  return cached;
}

async function build(): Promise<string> {
  const fontsCss = await readFile(APP_FONTS_CSS, "utf8");
  const specifiers = [...fontsCss.matchAll(IMPORT_RE)].map((m) => m[1]);
  if (specifiers.length === 0) {
    throw new Error(
      `jetbrainsMonoFontFace: found no JetBrains Mono @import in ` +
        `${APP_FONTS_CSS}; the harness would have nothing to load and every ` +
        "render would silently fall back to a system font.",
    );
  }

  const faces: string[] = [];
  for (const specifier of specifiers) {
    const cssPath = specifier.startsWith(".")
      ? join(dirname(APP_FONTS_CSS), specifier)
      : require.resolve(specifier);
    const css = await readFile(cssPath, "utf8");
    const blocks = [...css.matchAll(FONT_FACE_RE)].map((m) => m[1]);
    if (blocks.length === 0) {
      throw new Error(
        `jetbrainsMonoFontFace: ${specifier} declared no @font-face`,
      );
    }
    for (const block of blocks) {
      const weight = /font-weight:\s*(\d+)/.exec(block)?.[1];
      const style = /font-style:\s*(\w+)/.exec(block)?.[1] ?? "normal";
      const file = /url\(([\w./-]+\.woff2)\)/.exec(block)?.[1];
      const range = /unicode-range:\s*([^;]+);/.exec(block)?.[1];
      if (!weight || !file) {
        throw new Error(
          `jetbrainsMonoFontFace: an @font-face in ${specifier} has no ` +
            "font-weight or woff2 src",
        );
      }
      const b64 = (await readFile(join(dirname(cssPath), file))).toString(
        "base64",
      );
      faces.push(
        `@font-face{font-family:"JetBrains Mono";font-weight:${weight};font-style:${style};` +
          `src:url(data:font/woff2;base64,${b64}) format("woff2");` +
          `${range ? `unicode-range:${range.trim()};` : ""}}`,
      );
    }
  }
  return faces.join("\n");
}
