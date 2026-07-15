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
});
