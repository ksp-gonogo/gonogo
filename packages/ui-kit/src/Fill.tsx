import type { HTMLAttributes, ReactNode } from "react";
import styled from "styled-components";

/**
 * Props for {@link Fill}.
 *
 * @category Layout
 */
export interface FillProps extends HTMLAttributes<HTMLDivElement> {
  /**
   * Grow to fill a flex parent (`flex: 1 1 auto`) instead of taking full
   * height. Use for a slot nested in a column (e.g. a graph slot sitting
   * above a sibling notice row); omit for the outermost container that
   * fills the dashboard grid cell.
   */
  grow?: boolean;
  /** The content that takes the space. */
  children?: ReactNode;
}

/**
 * An overlay anchor that fills its parent: a `position: relative` flex column
 * that occupies exactly the space its parent gives it, so an absolutely
 * positioned overlay (e.g. a corner notice pill over a graph) has something to
 * sit on. It draws nothing itself. Full width and height by default; `grow`
 * for a slot nested in another flex column.
 *
 * @category Layout
 */
export function Fill({ grow = false, children, ...rest }: FillProps) {
  return (
    <Fill__Root $grow={grow} {...rest}>
      {children}
    </Fill__Root>
  );
}

const Fill__Root = styled.div<{ $grow: boolean }>`
  position: relative;
  display: flex;
  flex-direction: column;
  min-height: 0;

  ${({ $grow }) =>
    $grow
      ? `flex: 1 1 auto;`
      : `
    height: 100%;
    width: 100%;
  `}
`;
