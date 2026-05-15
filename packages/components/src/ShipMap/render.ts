import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ServerStyleSheet } from "styled-components";
import { ShipDiagramSvg } from "./ShipDiagramSvg";
import type { ShipMapPart } from "./shipTopology";

export interface RenderShipMapOptions {
  width?: number;
  height?: number;
  highlight?: string | null;
  highlightColor?: string;
  /** Background colour painted behind the diagram. Defaults to the app
   *  surface colour so the SVG looks the same as in the dashboard. */
  background?: string;
}

/**
 * Render the ship diagram to a self-contained SVG string.
 *
 * Output is portable: CSS-variable references are resolved via an embedded
 * `<style>` block carrying the dark-mode palette from
 * `packages/app/src/styles/global.css`, so the SVG renders correctly in
 * any viewer (browser, IDE preview, screenshot diff). styled-components
 * classes (non-deterministic `sc-…` hashes) are stripped so snapshot
 * tests stay stable.
 */
export function renderShipMapToSvg(
  parts: readonly ShipMapPart[],
  opts: RenderShipMapOptions = {},
): string {
  const width = opts.width ?? 800;
  const height = opts.height ?? 800;
  const background = opts.background ?? "#050505";

  const sheet = new ServerStyleSheet();
  let rendered: string;
  try {
    rendered = renderToStaticMarkup(
      sheet.collectStyles(
        createElement(ShipDiagramSvg, {
          parts,
          width,
          height,
          highlight: opts.highlight ?? null,
          highlightColor: opts.highlightColor,
        }),
      ),
    );
  } finally {
    sheet.seal();
  }

  const stripped = stripNonDeterministicClasses(rendered);

  // Inject xmlns, a background <rect>, and a <style> block that resolves
  // the CSS variables. We do this by rebuilding the opening <svg> tag.
  const withChrome = stripped.replace(
    /^<svg([^>]*)>/,
    `<svg$1 xmlns="http://www.w3.org/2000/svg">${SVG_STYLE_BLOCK}<rect width="${width}" height="${height}" fill="${background}" />`,
  );

  return withChrome;
}

function stripNonDeterministicClasses(html: string): string {
  // styled-components v6 emits `class="sc-XXXXXX hashYYYY"` on every styled
  // element — both tokens vary per build. Strip any class attribute that
  // contains an `sc-` token. Deterministic classes (e.g. `focus-ring` on
  // the keyboard-focus rect) have no `sc-` prefix and are untouched.
  return html.replace(/\sclass="[^"]*\bsc-[^"]*"/g, "");
}

/**
 * Resolved CSS variables — must stay in sync with
 * `packages/app/src/styles/global.css`. Inlined here so the SVG output
 * is standalone (no dependency on the app's stylesheet). Only the
 * variables the ship diagram actually references are duplicated; the
 * rest of the palette is intentionally omitted.
 */
const SVG_STYLE_BLOCK = `<style><![CDATA[
:root {
  --color-text-primary: #ccc;
  --color-text-muted: #888;
  --color-text-dim: #666;
  --color-text-inverse: #050505;
  --color-surface-raised: #1a1a1a;
  --color-border-strong: #333;
  --color-accent-fg: #00ff88;
  --color-status-go-fg: #cfe;
  --color-status-warning-bg: #ff8c00;
  --color-status-nogo-bg: #ff4d4d;
  --color-status-info-fg: #7cf;
  --color-tag-yellow-fg: #ffeb3b;
  --color-tag-cyan-fg: #00cccc;
}
]]></style>`;
