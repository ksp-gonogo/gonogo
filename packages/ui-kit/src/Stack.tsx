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
  /**
   * Rendered tag. Defaults to `div`. Declared for the same reason `Row`
   * declares it: a widget adopting this in place of its own `styled.section`
   * should not have to give up the semantic element to do so.
   */
  as?: ElementType;
  /**
   * Take the remaining space in a flex parent, and allow shrinking below the
   * content's natural height. That pair is what lets a scroller nested inside
   * actually scroll instead of growing the whole column, which is otherwise
   * the most-copied two lines of inline style in the widget set.
   */
  fill?: boolean;
  children?: ReactNode;
}

/**
 * Vertical flex list: the most common container shape in the dashboard.
 * Replaces the many ad-hoc `styled.div\`flex-direction:column;gap:...\`` blocks
 * scattered across widgets (e.g. ScienceOfficer's `Group`/`InstrumentList`/
 * `LabList`).
 */
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
