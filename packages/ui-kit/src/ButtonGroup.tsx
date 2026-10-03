import { forwardRef, type HTMLAttributes, type ReactNode } from "react";
import styled from "styled-components";
import { GAP_VAR, type GapToken } from "./scales";

/**
 * Props for {@link ButtonGroup}. Any other `div` attribute passes through, and
 * the ref reaches the root `div`.
 *
 * @category Button
 */
export interface ButtonGroupProps extends HTMLAttributes<HTMLDivElement> {
  /**
   * Give every button the width of the widest one. On by default, since a row of
   * actions that differ only in the length of their word reads as a mistake.
   * Turn it off for a group whose members are meant to size to their own content.
   */
  equalWidth?: boolean;
  /** Gap between buttons, as a gap job. Omit it for `--gap-related`. */
  gap?: GapToken;
  children?: ReactNode;
}

/**
 * A row of related buttons that share a size: the same height whatever each
 * button's own `size` or content, and by default the same width. It hugs its
 * buttons rather than filling the row, so place it with a layout primitive.
 *
 * Name the group with `aria-label` when it is a toolbar a screen reader should
 * announce as one.
 *
 * @example
 * ```tsx
 * <ButtonGroup>
 *   <Button variant="primary">Accept</Button>
 *   <Button>Decline</Button>
 * </ButtonGroup>
 * ```
 *
 * @category Button
 */
export const ButtonGroup = forwardRef<HTMLDivElement, ButtonGroupProps>(
  function ButtonGroup({ equalWidth = true, gap, children, ...rest }, ref) {
    return (
      <ButtonGroup__Root
        ref={ref}
        $equalWidth={equalWidth}
        $gap={gap}
        {...rest}
      >
        {children}
      </ButtonGroup__Root>
    );
  },
);

const ButtonGroup__Root = styled.div<{ $equalWidth: boolean; $gap?: GapToken }>`
  display: grid;
  grid-auto-flow: column;
  grid-auto-columns: ${({ $equalWidth }) => ($equalWidth ? "1fr" : "auto")};
  align-items: stretch;
  width: max-content;
  max-width: 100%;
  gap: ${({ $gap }) => ($gap ? GAP_VAR[$gap] : "var(--gap-related)")};
`;
