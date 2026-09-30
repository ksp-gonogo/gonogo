import { forwardRef, type HTMLAttributes, type ReactNode } from "react";
import styled from "styled-components";
import { GAP_VAR, type GapToken } from "./scales";

/**
 * Horizontal distribution for {@link Cluster}: `between` pushes the first and
 * last children to the edges, the others pack children to one side or the
 * middle.
 *
 * @category Layout
 */
export type ClusterJustify = "between" | "start" | "center" | "end";

/**
 * Vertical alignment of {@link Cluster}'s children.
 *
 * @category Layout
 */
export type ClusterAlign = "center" | "start" | "baseline";

/**
 * Props for {@link Cluster}. Any other `div` attribute passes through, and the
 * ref reaches the root `div`.
 *
 * @category Layout
 */
export interface ClusterProps extends HTMLAttributes<HTMLDivElement> {
  /** `justify-content` shorthand. Defaults to `between`. */
  justify?: ClusterJustify;
  /**
   * `align-items` shorthand. Defaults to `center`; use `start` when one side
   * can be taller than the other, such as a label beside a wrapping control.
   */
  align?: ClusterAlign;
  /**
   * Gap between children, as a gap job. Omit it and the gap is
   * `--gap-related`, inherited from whichever container the row lands in, so
   * the same row is 8px on a panel and 6px inside a card. Pass a job only
   * from a container deciding the spacing for what it holds.
   */
  gap?: GapToken;
  /**
   * Let children wrap onto further lines. Off by default, so a row of controls
   * never silently turns into a ragged block; chip strips and tag lists opt in.
   */
  wrap?: boolean;
  children?: ReactNode;
}

const JUSTIFY_CONTENT: Record<ClusterJustify, string> = {
  between: "space-between",
  start: "flex-start",
  center: "center",
  end: "flex-end",
};

const ALIGN_ITEMS: Record<ClusterAlign, string> = {
  center: "center",
  start: "flex-start",
  baseline: "baseline",
};

/**
 * A horizontal flex row. By default its children are vertically centred and
 * spread to both edges (`space-between`), and it carries `min-width: 0` so a
 * truncating child truncates instead of overflowing. Children stay on one
 * line unless `wrap` is set.
 *
 * @category Layout
 */
export const Cluster = forwardRef<HTMLDivElement, ClusterProps>(
  function Cluster(
    {
      justify = "between",
      align = "center",
      gap,
      wrap = false,
      children,
      ...rest
    },
    ref,
  ) {
    return (
      <Cluster__Root
        ref={ref}
        $justify={justify}
        $align={align}
        $gap={gap}
        $wrap={wrap}
        {...rest}
      >
        {children}
      </Cluster__Root>
    );
  },
);

const Cluster__Root = styled.div<{
  $justify: ClusterJustify;
  $align: ClusterAlign;
  $gap?: GapToken;
  $wrap: boolean;
}>`
  display: flex;
  align-items: ${({ $align }) => ALIGN_ITEMS[$align]};
  justify-content: ${({ $justify }) => JUSTIFY_CONTENT[$justify]};
  gap: ${({ $gap }) => ($gap ? GAP_VAR[$gap] : "var(--gap-related)")};
  ${({ $wrap }) => ($wrap ? "flex-wrap: wrap;" : "")}
  min-width: 0;
`;
