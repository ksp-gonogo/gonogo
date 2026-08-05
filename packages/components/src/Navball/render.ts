import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
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
 * `packages/app/src/styles/global.css`. `AttitudeDialSvg` is plain inline SVG
 * (no styled-components), so no server-side style extraction is needed.
 */
export function renderAttitudeDialToSvg(
  opts: RenderAttitudeDialOptions,
): string {
  const size = opts.size ?? 320;
  const background = opts.background ?? "#050505";

  const rendered = renderToStaticMarkup(
    createElement(AttitudeDialSvg, {
      heading: opts.heading,
      pitch: opts.pitch,
      roll: opts.roll,
      size,
      idPrefix: opts.idPrefix,
    }),
  );

  return rendered.replace(
    /^<svg([^>]*)>/,
    `<svg$1 xmlns="http://www.w3.org/2000/svg">${SVG_STYLE_BLOCK}<rect width="${size}" height="${size}" fill="${background}" />`,
  );
}

/**
 * Resolved CSS variables: must stay in sync with
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
