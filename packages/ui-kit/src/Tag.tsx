import type { HTMLAttributes, ReactNode } from "react";
import styled, { css } from "styled-components";

interface TagColours {
  bg: string;
  fg: string;
  border: string;
}

const TAG_COLOURS: Record<string, TagColours> = {
  telemetry: {
    bg: "var(--color-go-status)",
    fg: "var(--color-accent-fg)",
    border: "var(--color-go-status)",
  },
  control: {
    bg: "var(--color-tag-dark-brown-bg)",
    fg: "var(--color-tag-yellow-fg)",
    border: "var(--color-tag-dark-brown-border)",
  },
  system: {
    bg: "var(--color-tag-blue-bg)",
    fg: "var(--color-tag-blue-fg)",
    border: "var(--color-tag-blue-border)",
  },
  kos: {
    bg: "var(--color-tag-purple-bg)",
    fg: "var(--color-tag-purple-fg)",
    border: "var(--color-tag-blue-border)",
  },
};

const FALLBACK: TagColours = {
  bg: "var(--color-surface-panel)",
  fg: "var(--color-text-dim)",
  border: "var(--color-border-subtle)",
};

function getTagColours(label: string): TagColours {
  return TAG_COLOURS[label] ?? FALLBACK;
}

/**
 * Props for {@link Tag}: its words and an optional symbol. Any other `span`
 * attribute (`title`, `aria-label`) passes through to the tag.
 * Useful for naming a property of something the operator is looking at, such as
 * a widget's subject or the Uplink that extends it. Used by the Add widget
 * picker.
 *
 * @category Tag
 */
export interface TagProps
  extends Omit<HTMLAttributes<HTMLSpanElement>, "children"> {
  /** The tag's words, drawn uppercase. A few known words (`telemetry`, `control`, `system`, `kos`) take their own colours and any other word is grey. */
  label: string;
  /**
   * A mark in a filled segment at the start of the tag, before its words: a
   * "+" for something added, a count, a glyph. The segment is filled with the
   * tag's text colour and its content takes the panel background colour.
   * Useful for marking what kind of property the tag names, such as an Uplink
   * that extends a widget. Used by the Add widget picker. The segment is
   * hidden from screen readers, so anything the operator must hear goes in
   * `label` or `aria-label`. Absent, the tag has no segment.
   */
  symbol?: ReactNode;
  /**
   * The tag names a specific thing, such as an Uplink, rather than a
   * category. A name keeps its own spelling, so the words are drawn as written
   * at regular weight, in the compact text size and line height, with almost no
   * padding. Useful for a tag that sits beside a title, where it should not
   * stand out more than the thing it labels. Used by the Add widget picker.
   * Absent, the tag names a category (such as crew or video) and is drawn
   * uppercase and bold.
   */
  name?: boolean;
}

/**
 * A small squared uppercase label for a fixed property of the thing it labels,
 * such as a widget's kind, its owner or an Uplink that extends it, drawn in a
 * colour chosen by its words. It does not change while the operator watches.
 * Useful for telling the operator what a widget is about or which Uplink adds
 * to it. Used by the Add widget picker. Something that can change, including a
 * neutral statement of state such as "1 of 2 crew", is a {@link Badge}
 * instead.
 *
 * @example
 * ```tsx
 * <Tag label="telemetry" />
 * ```
 *
 * @category Tag
 * @categoryDescription Tag
 * Squared labels that name a property of a widget or a vessel.
 */
export function Tag({ label, symbol, name = false, ...rest }: TagProps) {
  const colours = getTagColours(label);
  return (
    <TagBadge
      $bg={colours.bg}
      $fg={colours.fg}
      $border={colours.border}
      $symbol={symbol !== undefined}
      $name={name}
      {...rest}
    >
      {symbol !== undefined && (
        <TagSymbol $name={name} aria-hidden="true">
          <TagSymbolInk>{symbol}</TagSymbolInk>
        </TagSymbol>
      )}
      {symbol !== undefined ? <TagLabel $name={name}>{label}</TagLabel> : label}
    </TagBadge>
  );
}

const TagBadge = styled.span<{
  $bg: string;
  $fg: string;
  $border: string;
  $symbol: boolean;
  $name: boolean;
}>`
  display: ${({ $symbol }) => ($symbol ? "inline-flex" : "inline-block")};
  ${({ $symbol, $name }) => {
    if ($symbol) return css`padding: 0;`;
    return $name
      ? css`padding: 0 var(--gap-glyph);`
      : css`padding: var(--inset-chip);`;
  }}
  border-radius: var(--radius-regular);
  ${({ $symbol }) => $symbol && "overflow: hidden;"}
  ${({ $name }) =>
    $name
      ? css`
          font-size: var(--font-size-compact);
        `
      : css`
          font-size: var(--font-size-caption);
          font-weight: 600;
          letter-spacing: 0.08em;
          text-transform: uppercase;
        `}

  ${({ $bg, $fg, $border }) => css`
    background: ${$bg};
    color: ${$fg};
    border: 1px solid ${$border};
  `}
`;

/* The fill is the tag's own text colour and the symbol is drawn in the panel colour on top of it, so the segment inverts whatever colour the tag carries and meets the border with no gap because the tag clips it to its own rounded edge. */
const TagSymbol = styled.span<{ $name: boolean }>`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  ${({ $name }) =>
    $name
      ? css`padding: 0 var(--gap-glyph);`
      : css`padding: var(--inset-chip);`}
  background: currentColor;
`;

const TagSymbolInk = styled.span`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 1.3em;
  font-weight: 800;
  line-height: var(--line-height-flush);
  color: var(--color-surface-panel);
`;

const TagLabel = styled.span<{ $name: boolean }>`
  ${({ $name }) =>
    $name
      ? css`padding: 0 var(--gap-glyph) 0 var(--gap-glyph-tray);`
      : css`padding: var(--inset-chip);`}
`;
