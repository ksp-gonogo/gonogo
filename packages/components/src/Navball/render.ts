import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AttitudeDialSvg } from "./AttitudeDialSvg";

export interface RenderAttitudeDialOptions {
  heading: number | null;
  pitch: number | null;
  roll: number | null;
  size?: number;
  /** Background painted behind the dial; defaults to the app surface colour. */
  background?: string;
  idPrefix?: string;
}

/** Renders the attitude dial to a self-contained SVG string, with its CSS variables resolved in an embedded style block. */
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

/** The dial's CSS variables, resolved; must stay in sync with the app's global stylesheet. */
const SVG_STYLE_BLOCK = `<style><![CDATA[
:root {
  --color-text-primary: #ccc;
  --color-text-muted: #888;
  --color-surface-raised: #1a1a1a;
  --color-accent-fg: #00ff88;
  --color-info-mark: #7cf;
  --color-warn-mark: #ff8c00;
}
]]></style>`;
