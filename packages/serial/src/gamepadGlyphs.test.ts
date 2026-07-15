import { describe, expect, it } from "vitest";
import { GAMEPAD_GLYPHS, getGamepadGlyph } from "./gamepadGlyphs";
import type { LabelPack } from "./gamepadLabels";
import { GAMEPAD_ROLES } from "./gamepadRoles";

const GLYPH_PACKS: readonly Exclude<LabelPack, "positional">[] = [
  "xbox",
  "playstation",
  "nintendo",
];

describe("GAMEPAD_GLYPHS (vendored)", () => {
  it("resolves all 63 role x pack entries (21 roles x 3 packs)", () => {
    let count = 0;
    for (const pack of GLYPH_PACKS) {
      for (const role of GAMEPAD_ROLES) {
        const svg = getGamepadGlyph(pack, role);
        expect(svg, `${pack}/${role} should resolve`).toBeTruthy();
        count++;
      }
    }
    expect(count).toBe(63);
  });

  it("has no glyph set for the positional pack (name-only)", () => {
    expect(GAMEPAD_GLYPHS.positional).toBeUndefined();
  });

  it("contains no leftover <style>, class=, or #fff in any glyph", () => {
    for (const pack of GLYPH_PACKS) {
      for (const role of GAMEPAD_ROLES) {
        const svg = getGamepadGlyph(pack, role);
        expect(svg).toBeDefined();
        if (!svg) continue;
        expect(svg).not.toMatch(/<style/);
        expect(svg).not.toMatch(/<defs/);
        expect(svg).not.toMatch(/class=/);
        expect(svg).not.toMatch(/#fff/i);
      }
    }
  });

  it("every glyph is a well-formed <svg ...>...</svg> string", () => {
    for (const pack of GLYPH_PACKS) {
      for (const role of GAMEPAD_ROLES) {
        const svg = getGamepadGlyph(pack, role);
        expect(svg).toMatch(/^<svg[^>]*>/);
        expect(svg?.trim().endsWith("</svg>")).toBe(true);
      }
    }
  });

  it("recolours via currentColor rather than a fixed colour", () => {
    const faceSouthXbox = getGamepadGlyph("xbox", "face-south");
    expect(faceSouthXbox).toContain("currentColor");
  });

  // Regression for the "renders solid black or invisible" defect: the
  // vendoring transform inlined a `style="stroke-width:Npx;"`-only
  // attribute onto ~51 drawable elements across the 63 glyphs, with no
  // `fill`/`stroke` colour at all. SVG initial values then apply — `fill`
  // defaults to black (not `currentColor`), `stroke` defaults to `none` —
  // so those elements rendered as solid black blobs (fill shapes) or were
  // fully invisible (stroked-only shapes with no stroke colour). The prior
  // mechanical test only sampled one glyph (`xbox/face-south`) for
  // `currentColor` presence, which a glyph with this defect still passes
  // (its *other* elements carry `currentColor` fine). This audits every
  // drawable element in all 63 glyphs, not just one sampled glyph per pack.
  describe("every drawable element resolves to currentColor (no default-black-fill, no default-none-stroke)", () => {
    const DRAWABLE_TAG =
      /<(circle|ellipse|line|rect|polyline|polygon|path)\b([^>]*)\/>/g;
    const STYLE_ATTR = /style="([^"]*)"/;

    function findBrokenElements(svg: string): string[] {
      const broken: string[] = [];
      for (const match of svg.matchAll(DRAWABLE_TAG)) {
        const [full, , attrs] = match;
        const styleMatch = STYLE_ATTR.exec(attrs);
        const style = styleMatch?.[1] ?? "";
        const hasFillColor = /fill:\s*currentColor/.test(style);
        const hasFillNone = /fill:\s*none/.test(style);
        const hasStrokeColor = /stroke:\s*currentColor/.test(style);

        if (!hasFillColor && !hasFillNone) {
          // No fill declared at all -> defaults to black.
          broken.push(`${full} — no fill declared (defaults to black)`);
          continue;
        }
        if (hasFillNone && !hasStrokeColor) {
          // fill:none with no stroke colour -> fully invisible.
          broken.push(`${full} — fill:none with no stroke colour (invisible)`);
        }
      }
      return broken;
    }

    it("has no broken drawable element in any of the 63 role x pack glyphs", () => {
      const failures: string[] = [];
      for (const pack of GLYPH_PACKS) {
        for (const role of GAMEPAD_ROLES) {
          const svg = getGamepadGlyph(pack, role);
          if (!svg) continue;
          const broken = findBrokenElements(svg);
          for (const b of broken) {
            failures.push(`${pack}/${role}: ${b}`);
          }
        }
      }
      expect(failures).toEqual([]);
    });
  });
});
