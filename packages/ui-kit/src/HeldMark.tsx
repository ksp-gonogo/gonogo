/**
 * The mark a figure carries when it is no longer a reading of now. A held
 * figure takes a square at superscript height in the warning hue the panel badge is
 * painted from; a figure a model carried takes a blue triangle of the same
 * footprint, about a pixel larger so the two weigh alike. One spec, in
 * {@link RECKONING_MARK}, drives these DOM marks and the SVG and canvas faces.
 */
import type { HTMLAttributes, ReactNode } from "react";
import styled, { css } from "styled-components";
import {
  HOLLOW_MARK_STROKE,
  type MarkKind,
  RECKONING_MARK,
} from "./reckoningMarkSpec";
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

/** The room a hollow mark of a kind needs: it is drawn larger than the filled one. */
function reservesHollow(kind: MarkKind) {
  return css`
    &::after {
      content: "";
      display: inline-block;
      width: calc(${RECKONING_MARK[kind].hollowDomSize} + 0.14em);
    }
  `;
}

/** The room to reserve for a kind of mark, hollow where the figure is `elsewhere`. A current figure that is not `elsewhere` carries no mark and reserves nothing. */
export function reservesMark(kind: MarkKind, elsewhere = false) {
  if (elsewhere) return reservesHollow(kind);
  if (kind === "current") return null;
  return kind === "modelled" ? reservesModelledTriangle : reservesHeldMark;
}

/**
 * The square itself. Absolutely positioned in the room its host reserves at the
 * end of the figure (see {@link reservesHeldMark}), at superscript height, so
 * the square is inside the host's box and the line never grows. Sized in `em`
 * with a minimum size in pixels, so it stays a square in small text.
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

const hollowBox = (kind: MarkKind) => css`
  position: absolute;
  right: 0;
  top: 0;
  width: ${RECKONING_MARK[kind].hollowDomSize};
  height: ${RECKONING_MARK[kind].hollowDomSize};
`;

/** The ring: a figure measured now, of something other than its label names. */
const ElsewhereRing = styled.span`
  ${hollowBox("current")}
  border: ${HOLLOW_MARK_STROKE} solid ${RECKONING_MARK.current.color};
  border-radius: var(--radius-circle);
`;

/** The held square emptied: a held figure of something other than its label names. */
const HollowSquare = styled.span`
  ${hollowBox("held")}
  border: ${HOLLOW_MARK_STROKE} solid ${RECKONING_MARK.held.color};
`;

/** The modelled triangle emptied. The hole is cut from the fill, since a clipped box has no border to draw. */
const HollowTriangle = styled.span`
  ${hollowBox("modelled")}
  --stroke: ${HOLLOW_MARK_STROKE};
  background: ${RECKONING_MARK.modelled.color};
  clip-path: polygon(
    50% 0,
    100% 100%,
    0 100%,
    50% 0,
    50% calc(var(--stroke) * 2.4),
    calc(var(--stroke) * 1.9) calc(100% - var(--stroke)),
    calc(100% - var(--stroke) * 1.9) calc(100% - var(--stroke)),
    50% calc(var(--stroke) * 2.4)
  );
`;

const HOLLOW = {
  current: ElsewhereRing,
  held: HollowSquare,
  modelled: HollowTriangle,
} as const;

/**
 * The DOM mark for a kind, silent to a screen reader: the caption beside it is
 * what is spoken.
 *
 * `elsewhere` draws the kind's hollow form, for a figure that is of something
 * other than what its label names: a ring for a current figure, the square or
 * the triangle emptied for a held or modelled one. A current figure that is
 * not `elsewhere` has no mark, and this draws nothing.
 *
 * @category Unit
 */
export function ReckoningMark({
  kind,
  elsewhere = false,
}: {
  kind: MarkKind;
  elsewhere?: boolean;
}) {
  if (kind === "current" && !elsewhere) return null;
  const Mark = elsewhere
    ? HOLLOW[kind]
    : kind === "modelled"
      ? ModelledTriangle
      : HeldMark;
  return (
    <Mark
      aria-hidden="true"
      data-held-mark=""
      data-reckoning-mark={kind}
      data-elsewhere={elsewhere ? "" : undefined}
    />
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
export const HeldHost = styled.span<{
  $kind?: MarkKind;
  $elsewhere?: boolean;
}>`
  position: relative;
  white-space: nowrap;
  ${({ $kind, $elsewhere }) => reservesMark($kind ?? "held", $elsewhere)}
`;

/**
 * The props of {@link HeldFigure}.
 *
 * @category Unit
 */
export interface HeldFigureProps extends HTMLAttributes<HTMLSpanElement> {
  /** What the mark means in words: spoken after the figure, and shown on hover. */
  caption: string | null;
  /** Which mark: a held figure takes the square, a figure a model carried the triangle. `current` is a reading of now, which is marked only when it is `elsewhere`. Defaults to `held`. */
  kind?: MarkKind;
  /** The figure is of something other than what its label names, so its mark is drawn hollow: a ring for a current figure, the square or triangle emptied otherwise. */
  elsewhere?: boolean;
  /** The figure the mark follows. */
  children: ReactNode;
}

/**
 * A figure marked held or modelled, or as being of something other than its
 * label names: the mark for its `kind` (hollow where `elsewhere`), the caption
 * spoken after the figure, and the same caption in the kit's hover tip.
 *
 * @category Unit
 */
export function HeldFigure({
  caption,
  kind = "held",
  elsewhere = false,
  children,
  ...rest
}: HeldFigureProps) {
  const { anchor, tip } = useTooltip(caption);
  return (
    <HeldHost $kind={kind} $elsewhere={elsewhere} {...rest} {...anchor}>
      {children}
      <ReckoningMark kind={kind} elsewhere={elsewhere} />
      {caption !== null && (
        <VisuallyHidden data-unit-currency="">, {caption}</VisuallyHidden>
      )}
      {tip}
    </HeldHost>
  );
}
