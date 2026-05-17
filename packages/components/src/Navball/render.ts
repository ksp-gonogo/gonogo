import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ServerStyleSheet } from "styled-components";
import { AttitudeDialSvg } from "./AttitudeDialSvg";

export interface RenderAttitudeDialOptions {
  heading: number | null;
  pitch: number | null;
  roll: number | null;
  size?: number;
  /** Background colour painted behind the dial. Defaults to the app
   *  surface colour so the SVG matches the dashboard. */
  background?: string;
  idPrefix?: string;
}

/**
 * Render the attitude dial to a self-contained SVG string.
 *
 * Output is portable: CSS-variable references are resolved via an embedded
 * `<style>` block carrying the dark-mode palette from
 * `packages/app/src/styles/global.css`. styled-components hashes are
 * stripped so snapshot tests stay stable.
 */
export function renderAttitudeDialToSvg(
  opts: RenderAttitudeDialOptions,
): string {
  const size = opts.size ?? 320;
  const background = opts.background ?? "#050505";

  const sheet = new ServerStyleSheet();
  let rendered: string;
  try {
    rendered = renderToStaticMarkup(
      sheet.collectStyles(
        createElement(AttitudeDialSvg, {
          heading: opts.heading,
          pitch: opts.pitch,
          roll: opts.roll,
          size,
          idPrefix: opts.idPrefix,
        }),
      ),
    );
  } finally {
    sheet.seal();
  }

  const stripped = stripNonDeterministicClasses(rendered);

  return stripped.replace(
    /^<svg([^>]*)>/,
    `<svg$1 xmlns="http://www.w3.org/2000/svg">${SVG_STYLE_BLOCK}<rect width="${size}" height="${size}" fill="${background}" />`,
  );
}

function stripNonDeterministicClasses(html: string): string {
  return html.replace(/\sclass="[^"]*\bsc-[^"]*"/g, "");
}

/**
 * Resolved CSS variables — must stay in sync with
 * `packages/app/src/styles/global.css`. Inlined here so the SVG output is
 * standalone. Only the variables the dial actually references are
 * duplicated.
 */
const SVG_STYLE_BLOCK = `<style><![CDATA[
:root {
  --color-text-primary: #ccc;
  --color-text-muted: #888;
  --color-surface-raised: #1a1a1a;
  --color-accent-fg: #00ff88;
  --color-status-info-fg: #7cf;
  --color-status-warning-bg: #ff8c00;
}
]]></style>`;
