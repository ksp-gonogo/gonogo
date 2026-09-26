import type { ElementType, HTMLAttributes, ReactNode } from "react";
import styled from "styled-components";
import { GAP_VAR, type GapToken } from "./scales";

export interface StackProps extends HTMLAttributes<HTMLDivElement> {
  /**
   * Gap between children, as a gap job. Omit it and the gap is
   * `--gap-related`, inherited from whichever container the stack lands in, so
   * the same stack is 8px on a panel and 6px inside a card. Pass a job only
   * from a container deciding the spacing for what it holds.
   */
  gap?: GapToken;
  /** Rendered tag. Defaults to `div`. */
  as?: ElementType;
  /**
   * Take the remaining space in a flex parent, and allow shrinking below the
   * content's natural height. That pair is what lets a scroller nested inside
   * actually scroll instead of growing the whole column.
   */
  fill?: boolean;
  children?: ReactNode;
}

/** Vertical flex list: the most common container shape in the dashboard. */
export function Stack({ gap, fill = false, children, ...rest }: StackProps) {
  return (
    <Stack__Root $gap={gap} $fill={fill} {...rest}>
      {children}
    </Stack__Root>
  );
}

const Stack__Root = styled.div<{ $gap?: GapToken; $fill: boolean }>`
  display: flex;
  flex-direction: column;
  gap: ${({ $gap }) => ($gap ? GAP_VAR[$gap] : "var(--gap-related)")};
  ${({ $fill }) => ($fill ? "flex: 1; min-height: 0;" : "")}
`;
