import type { ReactNode } from "react";
import styled from "styled-components";
import {
  BLOCK_PARTS,
  Block__Root,
  type BlockProps,
  renderBlockAnatomy,
} from "./Block";
import type { ReadoutTone } from "./Readout";

export interface CardProps extends BlockProps {
  /**
   * How this record is DOING, drawn as a 2px accent rule down the leading edge.
   * Status only; identity is `identityColor`.
   */
  tone?: ReadoutTone;
  /**
   * Dims the card to signal unavailable-but-still-listed: a crew member on a
   * mission, a part not yet unlocked. Its text drops to the muted tier, which
   * still reads at 4.5:1, and its `tone` rule and identity tab go half-strength.
   */
  dimmed?: boolean;
  /**
   * WHICH THING this record is about, drawn as a short centred tab on the TOP
   * edge: a resource's own colour, a category's hue. Never a status, that is
   * `tone`; the two compose. The tab is short so it reads as a label, not a
   * gauge.
   *
   * A plain CSS colour, not a resource name: resolve it first, e.g.
   * `identityColor={resourceColor(name)}`.
   */
  identityColor?: string;
  /**
   * The roomier inset for a card that IS its screen rather than one record in a
   * list, such as a panel of device cards each holding its own controls. A prop
   * rather than a density tier, because it describes this card's role, not its
   * descendants.
   */
  standalone?: boolean;
  children?: ReactNode;
}

/** The status vocabulary, as edge colours. Shared with `Notice`. */
export const TONE_COLOR: Record<ReadoutTone, string> = {
  default: "var(--color-border-subtle)",
  go: "var(--color-accent-fg)",
  warning: "var(--color-status-warning-bg)",
  alert: "var(--color-status-nogo-bg)",
};

/** Wider than the 2px `tone` rule, so identity reads as a different mark from status. */
const STRIP_WIDTH = "3px";

/**
 * `Block` plus a surface, as a styled extension of the same root.
 *
 * A card is the COMPACT density tier: it re-declares `--gap-related` and
 * `--gap-section` one rung down, so anything inside it written as
 * `gap: var(--gap-related)` tightens without a conditional, including a third
 * party's CSS. Only those two gap names step; insets do not, because a chip
 * inside a card is still a chip.
 */
const Card__Root = styled(Block__Root)<{
  $tone?: ReadoutTone;
  $dimmed?: boolean;
  $identityColor?: string;
  $standalone?: boolean;
}>`
  --gap-related: var(--gap-related-compact);
  --gap-section: var(--gap-section-compact);

  position: relative;
  background: var(--color-surface-sunken);
  border: 1px solid var(--color-border-subtle);
  border-radius: var(--radius-regular);
  ${({ $standalone }) =>
    $standalone
      ? "padding: var(--inset-surface-standalone);"
      : "padding: var(--inset-surface);"}
  ${({ $tone }) =>
    $tone ? `border-left: 2px solid ${TONE_COLOR[$tone]};` : ""}
  ${({ $identityColor }) =>
    $identityColor
      ? `
    &::before {
      content: "";
      position: absolute;
      top: -1px;
      left: 50%;
      transform: translateX(-50%);
      width: var(--size-mark);
      height: ${STRIP_WIDTH};
      background: ${$identityColor};
      border-radius: var(--radius-regular) var(--radius-regular) 0 0;
    }
  `
      : ""}
  ${({ $dimmed, $tone }) =>
    $dimmed
      ? `
    --color-text-primary: var(--color-text-muted);
    color: var(--color-text-muted);
    ${$tone ? `border-left-color: color-mix(in srgb, ${TONE_COLOR[$tone]} 50%, transparent);` : ""}
    &::before {
      opacity: 0.5;
    }
  `
      : ""}
`;

function CardRoot({
  tone,
  dimmed,
  identityColor,
  standalone,
  ...props
}: CardProps): ReactNode {
  return renderBlockAnatomy(Card__Root, {
    ...props,
    $tone: tone,
    $dimmed: dimmed,
    $identityColor: identityColor,
    $standalone: standalone,
  });
}

/**
 * A record on a sunken surface: `Block`'s arrangement inside a bordered, inset
 * box. Its parts are `Block`'s own objects (`Card.Title === Block.Title`). A
 * widget that wants the grouping without the box writes `Block`.
 */
export const Card = Object.assign(CardRoot, BLOCK_PARTS);
