import type { HTMLAttributes, ReactNode } from "react";
import styled from "styled-components";

export interface FillProps extends HTMLAttributes<HTMLDivElement> {
  /**
   * Grow to fill a flex parent (`flex: 1 1 auto`) instead of taking full
   * height. Use for a slot nested in a column (e.g. a graph slot sitting
   * above a sibling notice row); omit for the outermost container that
   * fills the dashboard grid cell.
   */
  grow?: boolean;
  children?: ReactNode;
}

/**
 * Fill container, a `position: relative` flex column that occupies
 * exactly the space its parent gives it, and can host an
 * absolutely-positioned overlay on top of its content (e.g. a canvas
 * graph plus a corner notice pill).
 *
 * Default (`grow` omitted): `height: 100%; width: 100%`, the outermost
 * shell of a widget, sized to its dashboard grid cell.
 *
 * `grow`: `flex: 1 1 auto` instead, a slot nested inside another flex
 * column, taking the remaining space alongside sibling content (e.g. a
 * degraded-state notice rendered below the graph rather than over it).
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
