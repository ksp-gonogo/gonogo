import { forwardRef, type HTMLAttributes, type ReactNode } from "react";
import styled from "styled-components";
import type { SpaceToken } from "./Stack";

export type ClusterJustify = "between" | "start" | "center" | "end";
export type ClusterAlign = "center" | "start" | "baseline";

export interface ClusterProps extends HTMLAttributes<HTMLDivElement> {
  /** `justify-content` shorthand. Defaults to `between`. */
  justify?: ClusterJustify;
  /**
   * `align-items` shorthand. Defaults to `center`, which is right for a row of
   * single-line items and wrong the moment one side is taller than the other:
   * a settings row whose control wraps to two lines wants its label at the
   * TOP, not floating in the middle of it. Added for that case rather than
   * leaving the widget with its own flex row.
   */
  align?: ClusterAlign;
  /** Gap between children, snapped to the space scale. Defaults to `md`. */
  gap?: SpaceToken;
  /**
   * Let children wrap onto further lines. Off by default: a cluster that wraps
   * silently is how a row of controls turns into a ragged block at a narrow
   * width without anyone noticing, so wrapping is opted into by the chip strips
   * and tag lists that actually want it.
   */
  wrap?: boolean;
  children?: ReactNode;
}

const JUSTIFY_CONTENT: Record<ClusterJustify, string> = {
  between: "space-between",
  start: "flex-start",
  // Added when Navball's "Dial" turned out to be a centring box and nothing
  // else. Centring is the most basic justification there is and the kit
  // simply did not offer it.
  center: "center",
  end: "flex-end",
};

const ALIGN_ITEMS: Record<ClusterAlign, string> = {
  center: "center",
  start: "flex-start",
  baseline: "baseline",
};

/**
 * The single most-repeated block in the dashboard: a horizontal row with
 * centred items, spread-out justification, and a `min-width: 0` so a
 * truncating child inside actually truncates instead of overflowing the flex
 * item. Verbatim source: ScienceOfficer's `TitleRow` and `LabHeader`.
 */
export const Cluster = forwardRef<HTMLDivElement, ClusterProps>(
  function Cluster(
    {
      justify = "between",
      align = "center",
      gap = "md",
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
  $gap: SpaceToken;
  $wrap: boolean;
}>`
  display: flex;
  align-items: ${({ $align }) => ALIGN_ITEMS[$align]};
  justify-content: ${({ $justify }) => JUSTIFY_CONTENT[$justify]};
  gap: ${({ theme, $gap }) => theme.space[$gap]};
  ${({ $wrap }) => ($wrap ? "flex-wrap: wrap;" : "")}
  min-width: 0;
`;
