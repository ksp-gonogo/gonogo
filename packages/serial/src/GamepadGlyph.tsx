import styled from "styled-components";
import { getGamepadGlyph } from "./gamepadGlyphs";
import type { LabelPack } from "./gamepadLabels";
import type { GamepadRole } from "./gamepadRoles";

interface Props {
  role: GamepadRole;
  pack: LabelPack;
  size?: number;
}

/**
 * Renders a vendored button/axis glyph inline, recoloured via
 * `currentColor` so it follows the active theme in both light and dark.
 * Purely decorative: renders nothing for the `positional` pack (name-only)
 * or a role with no art in the chosen pack. Always `aria-hidden` — callers
 * MUST render the input's resolved name alongside it (see
 * `describeGamepadInput`) so the meaning isn't glyph-only.
 */
export function GamepadGlyph({ role, pack, size = 16 }: Readonly<Props>) {
  const svg = getGamepadGlyph(pack, role);
  if (!svg) return null;
  return (
    <GlyphWrap
      $size={size}
      aria-hidden="true"
      // biome-ignore lint/security/noDangerouslySetInnerHtml: vendored asset from a fixed pack×role table (gamepadGlyphs.ts) — never user input.
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}

const GlyphWrap = styled.span<{ $size: number }>`
  display: inline-flex;
  flex-shrink: 0;
  width: ${({ $size }) => $size}px;
  height: ${({ $size }) => $size}px;
  color: inherit;

  svg {
    width: 100%;
    height: 100%;
    display: block;
  }
`;
