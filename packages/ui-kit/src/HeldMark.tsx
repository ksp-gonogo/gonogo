/**
 * The mark a figure carries when it is no longer a reading of now. A held
 * figure takes a square at superscript height in the warning hue the panel badge is
 * painted from; a figure a model carried takes a blue triangle of the same
 * footprint, about a pixel larger so the two weigh alike. One spec, in
 * {@link RECKONING_MARK}, drives these DOM marks and the SVG and canvas faces.
 */
import type { HTMLAttributes, ReactNode } from "react";
import styled, { css } from "styled-components";
import { RECKONING_MARK, type ReckoningKind } from "./reckoningMarkSpec";
import { useTooltip } from "./Tooltip";
import { VisuallyHidden } from "./VisuallyHidden";

const MARK_SIZE = RECKONING_MARK.held.domSize;
const MODELLED_MARK_SIZE = RECKONING_MARK.modelled.domSize;

/**
 * The room a host holds at the end of its figure for the square and the gap
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

/** {@link reservesHeldMark} for the modelled mark's slightly larger box. */
export const reservesModelledTriangle = css`
  &::after {
    content: "";
    display: inline-block;
    width: calc(${MODELLED_MARK_SIZE} + 0.14em);
  }
`;

/** The room to reserve for a kind of mark. */
export function reservesMark(kind: ReckoningKind) {
  return kind === "modelled" ? reservesModelledTriangle : reservesHeldMark;
}

/**
 * The square itself. Absolutely positioned in the room its host reserves at the
 * end of the figure (see {@link reservesHeldMark}), at superscript height, so
 * the square is inside the host's box and the line never grows. Sized in `em`
 * with a pixel floor, so it stays a square in small text.
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
  background: ${RECKONING_MARK.held.color};
`;

/**
 * The modelled mark: a triangle, point up, in the modelled hue, hung off its
 * host exactly as {@link HeldMark} is.
 *
 * @category Unit
 */
export const ModelledTriangle = styled.span`
  position: absolute;
  right: 0;
  top: 0;
  width: ${MODELLED_MARK_SIZE};
  height: ${MODELLED_MARK_SIZE};
  clip-path: polygon(50% 0, 100% 100%, 0 100%);
  background: ${RECKONING_MARK.modelled.color};
`;

/**
 * The DOM mark for a kind, silent to a screen reader: the caption beside it is
 * what is spoken.
 *
 * @category Unit
 */
export function ReckoningMark({ kind }: { kind: ReckoningKind }) {
  const Mark = kind === "modelled" ? ModelledTriangle : HeldMark;
  return (
    <Mark aria-hidden="true" data-held-mark="" data-reckoning-mark={kind} />
  );
}

/**
 * Something for the mark to hang off, for a component that renders bare text
 * and so has no box of its own.
 *
 * `nowrap`, since a phrase broken across two lines has two right edges.
 *
 * @category Unit
 */
export const HeldHost = styled.span<{ $kind?: ReckoningKind }>`
  position: relative;
  white-space: nowrap;
  ${({ $kind }) => reservesMark($kind ?? "held")}
`;

/**
 * The props of {@link HeldFigure}.
 *
 * @category Unit
 */
export interface HeldFigureProps extends HTMLAttributes<HTMLSpanElement> {
  /** What the mark means in words: spoken after the figure, and shown on hover. */
  caption: string | null;
  /** Which mark: a held figure takes the square, a figure a model carried the triangle. Defaults to `held`. */
  kind?: ReckoningKind;
  children: ReactNode;
}

/**
 * A figure marked held or modelled: the mark for its `kind`, the caption spoken after the figure, and the
 * same caption in the kit's hover tip.
 *
 * @category Unit
 */
export function HeldFigure({
  caption,
  kind = "held",
  children,
  ...rest
}: HeldFigureProps) {
  const { anchor, tip } = useTooltip(caption);
  return (
    <HeldHost $kind={kind} {...rest} {...anchor}>
      {children}
      <ReckoningMark kind={kind} />
      {caption !== null && (
        <VisuallyHidden data-unit-currency="">, {caption}</VisuallyHidden>
      )}
      {tip}
    </HeldHost>
  );
}
