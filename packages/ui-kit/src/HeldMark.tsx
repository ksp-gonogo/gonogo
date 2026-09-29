/**
 * The mark a figure carries when it is no longer a reading of now: a dot at
 * superscript height in the warning hue the panel badge is painted from.
 */
import type { HTMLAttributes, ReactNode } from "react";
import styled from "styled-components";
import { severityDotColor } from "./status/severityDotColor";
import { useTooltip } from "./Tooltip";
import { VisuallyHidden } from "./VisuallyHidden";

/**
 * The dot itself. Absolutely positioned, so a column measures the same whether
 * or not it is there, and it follows its value's right edge at superscript
 * height. Sized in `em` with a pixel floor, so it stays a dot in small text.
 *
 * It needs a positioned container to hang off: use {@link HeldHost}, or
 * a container of your own that is `position: relative` and does not wrap.
 */
export const HeldMark = styled.span`
  position: absolute;
  left: 100%;
  top: 0;
  width: max(0.3em, 4px);
  height: max(0.3em, 4px);
  margin-left: 0.14em;
  border-radius: var(--radius-circle);
  background: ${severityDotColor("warning")};
`;

/**
 * Something for the mark to hang off, for a component that renders bare text
 * and so has no box of its own.
 *
 * `nowrap`, since a phrase broken across two lines has two right edges.
 */
export const HeldHost = styled.span`
  position: relative;
  white-space: nowrap;
`;

/**
 * The props of {@link HeldFigure}.
 *
 * @category Held figures
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
 * @category Held figures
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
