import type { HTMLAttributes, ReactNode } from "react";
import styled from "styled-components";
import { GAP_VAR, type GapToken } from "./scales";

export interface AutoEmptyStateProps extends HTMLAttributes<HTMLDivElement> {
  /**
   * Shown when the content area renders no DOM nodes at all, e.g. every
   * augment/source bound to a slot returned `null`. Hidden via a CSS sibling
   * selector the instant the content area has any child, so the caller never
   * needs to inspect what its (possibly opaque, externally-driven) children
   * actually rendered.
   */
  fallback: ReactNode;
  /** Gap between rendered children. Defaults to `related-dense`. */
  gap?: GapToken;
  children?: ReactNode;
}

/**
 * Pairs a scrollable content region with a fallback that auto-hides once the
 * region has rendered anything. Built for slot/augment composition (see
 * `Objectives`): the frame owns the fallback but not the content, which may
 * come from one or more externally-registered augments the frame can't
 * introspect. Extracted from Objectives's `Sections`/`EmptyFallback` pair
 * (a bespoke `:not(:empty)` sibling rule) so the next slot-composing widget
 * reuses it instead of hand-rolling the same CSS again.
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
