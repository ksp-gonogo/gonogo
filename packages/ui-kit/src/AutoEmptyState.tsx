import type { HTMLAttributes, ReactNode } from "react";
import styled from "styled-components";
import { GAP_VAR, type GapToken } from "./scales";

export interface AutoEmptyStateProps extends HTMLAttributes<HTMLDivElement> {
  /**
   * Shown when the content area renders no DOM nodes at all, e.g. every
   * augment bound to a slot returned `null`. Hidden by a CSS sibling selector,
   * so the caller never inspects what its children rendered.
   */
  fallback: ReactNode;
  /** Gap between rendered children. Defaults to `related-dense`. */
  gap?: GapToken;
  children?: ReactNode;
}

/**
 * Pairs a scrollable content region with a fallback that auto-hides once the
 * region has rendered anything. For slot composition, where the frame owns the
 * fallback but its content comes from augments it cannot introspect.
 */
export function AutoEmptyState({
  fallback,
  gap = "related-dense",
  children,
  ...rest
}: AutoEmptyStateProps) {
  return (
    <>
      <AutoEmptyState__Content $gap={gap} {...rest}>
        {children}
      </AutoEmptyState__Content>
      <AutoEmptyState__Fallback>{fallback}</AutoEmptyState__Fallback>
    </>
  );
}

const AutoEmptyState__Content = styled.div<{ $gap: GapToken }>`
  display: flex;
  flex-direction: column;
  gap: ${({ $gap }) => GAP_VAR[$gap]};
  flex: 1;
  min-height: 0;
  overflow: auto;
`;

const AutoEmptyState__Fallback = styled.div`
  ${AutoEmptyState__Content}:not(:empty) + & {
    display: none;
  }
`;
