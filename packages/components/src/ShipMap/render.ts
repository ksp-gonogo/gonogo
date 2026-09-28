import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
// Folds PartGroup's styled CSS (an SVG <g> focus ring) into the standalone SVG string.
// biome-ignore lint/style/noRestrictedImports: collects PartGroup's CSS for standalone SVG export (see above)
import { ServerStyleSheet } from "styled-components";
import { ShipDiagramSvg } from "./ShipDiagramSvg";
import type { ShipMapPart } from "./shipTopology";

export interface RenderShipMapOptions {
  width?: number;
  height?: number;
  /** `ShipMapPart.flightId`, stringified, of the one part to ring. */
  highlightPartId?: string | null;
  highlightColor?: string;
  /** Background painted behind the diagram. Defaults to the app surface colour. */
  background?: string;
}

/**
 * Render the ship diagram to a self-contained SVG string: CSS variables
 * resolve through an embedded dark-palette `<style>` block, so it renders in
 * any viewer, and nondeterministic `sc-` classes are stripped.
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
          highlightPartId: opts.highlightPartId ?? null,
          highlightColor: opts.highlightColor,
        }),
      ),
    );
  } finally {
    sheet.seal();
  }

  const stripped = stripNonDeterministicClasses(rendered);

  // xmlns, a background rect and the variable-resolving style block, by rebuilding the opening <svg> tag.
  const withChrome = stripped.replace(
    /^<svg([^>]*)>/,
    `<svg$1 xmlns="http://www.w3.org/2000/svg">${SVG_STYLE_BLOCK}<rect width="${width}" height="${height}" fill="${background}" />`,
  );

  return withChrome;
}

function stripNonDeterministicClasses(html: string): string {
  // Both tokens of a styled-components class vary per build; deterministic classes such as `focus-ring` carry no `sc-` and stay.
  return html.replace(/\sclass="[^"]*\bsc-[^"]*"/g, "");
}

/** Resolved CSS variables, only those the diagram references. Must stay in sync with `packages/app/src/styles/global.css`. */
const SVG_STYLE_BLOCK = `<style><![CDATA[
:root {
  --color-text-primary: #ccc;
  --color-text-muted: #888;
  --color-text-dim: #858585;
  --color-text-inverse: #050505;
  --color-surface-raised: #1a1a1a;
  --color-border-strong: #333;
  --color-accent-fg: #00ff88;
  --color-go-text: #cfe;
  --color-warn-mark: #ff8c00;
  --color-nogo-mark: #ff4d4d;
  --color-info-mark: #7cf;
  --color-tag-yellow-fg: #ffeb3b;
  --color-tag-yellow-border: #6a5a2a;
  --color-tag-blue-bg: #0a0a1a;
  --color-tag-cyan-fg: #00cccc;
}
]]></style>`;
