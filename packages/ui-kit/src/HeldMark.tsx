/**
 * The mark a figure carries when it is no longer a reading of now: a dot at
 * superscript height in the warning hue the panel badge is painted from.
 */
import type { HTMLAttributes, ReactNode } from "react";
import styled, { css } from "styled-components";
import { useTooltip } from "./Tooltip";
import { TONE_MARK } from "./tone";
import { VisuallyHidden } from "./VisuallyHidden";

const MARK_SIZE = "max(0.3em, 4px)";

/**
 * The room a host holds at the end of its figure for the dot and the gap
 * before it, so a held figure keeps its mark inside its own box whatever clips
 * or wraps around it. It is a generated box with no content: it adds nothing
 * to the host's accessible name and nothing to the clipboard.
 */
export const reservesHeldMark = css`
  &::after {
    content: "";
    display: inline-block;
    width: calc(${MARK_SIZE} + 0.14em);
  }
`;

/**
 * The dot itself. Absolutely positioned in the room its host reserves at the
 * end of the figure (see {@link reservesHeldMark}), at superscript height, so
 * the dot is inside the host's box and the line never grows. Sized in `em`
 * with a pixel floor, so it stays a dot in small text.
 *
 * It needs a positioned container that reserves that room: use
 * {@link HeldHost}, or give a container of your own `position: relative`,
 * `nowrap` and `reservesHeldMark`.
 *
 * @category Unit
 */
export const HeldMark = styled.span`
  position: absolute;
  right: 0;
  top: 0;
  width: ${MARK_SIZE};
  height: ${MARK_SIZE};
  border-radius: var(--radius-circle);
  background: ${TONE_MARK.warn};
`;

/**
 * Something for the mark to hang off, for a component that renders bare text
 * and so has no box of its own.
 *
 * `nowrap`, since a phrase broken across two lines has two right edges.
 *
 * @category Unit
 */
export const HeldHost = styled.span`
  position: relative;
  white-space: nowrap;
  ${reservesHeldMark}
`;

/**
 * The props of {@link HeldFigure}.
 *
 * @category Unit
 */
export interface HeldFigureProps extends HTMLAttributes<HTMLSpanElement> {
  /** What the mark means in words: spoken after the figure, and shown on hover. */
  caption: string | null;
  children: ReactNode;
}

/**
 * A figure marked held: the dot, the caption spoken after the figure, and the
 * same caption in the kit's hover tip.
 *
 * @category Unit
 */
export function HeldFigure({ caption, children, ...rest }: HeldFigureProps) {
  const { anchor, tip } = useTooltip(caption);
  return (
    <HeldHost {...rest} {...anchor}>
      {children}
      <HeldMark aria-hidden="true" data-held-mark="" />
      {caption !== null && (
        <VisuallyHidden data-unit-currency="">, {caption}</VisuallyHidden>
      )}
      {tip}
    </HeldHost>
  );
}
