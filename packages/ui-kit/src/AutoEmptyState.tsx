import type { HTMLAttributes, ReactNode } from "react";
import styled from "styled-components";
import type { SpaceToken } from "./Stack";

export interface AutoEmptyStateProps extends HTMLAttributes<HTMLDivElement> {
  /**
   * Shown when the content area renders no DOM nodes at all, e.g. every
   * augment/source bound to a slot returned `null`. Hidden via a CSS sibling
   * selector the instant the content area has any child, so the caller never
   * needs to inspect what its (possibly opaque, externally-driven) children
   * actually rendered.
   */
  fallback: ReactNode;
  /** Gap between rendered children. Defaults to `sm`. */
  gap?: SpaceToken;
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
  gap = "sm",
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

const AutoEmptyState__Content = styled.div<{ $gap: SpaceToken }>`
  display: flex;
  flex-direction: column;
  gap: ${({ theme, $gap }) => theme.space[$gap]};
  flex: 1;
  min-height: 0;
  overflow: auto;
`;

const AutoEmptyState__Fallback = styled.div`
  ${AutoEmptyState__Content}:not(:empty) + & {
    display: none;
  }
`;
