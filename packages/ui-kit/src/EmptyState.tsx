import type { HTMLAttributes, ReactNode } from "react";
import styled, { css } from "styled-components";

export type EmptyStateLayout = "inline" | "fill";

export interface EmptyStateProps extends HTMLAttributes<HTMLDivElement> {
  children?: ReactNode;
  layout?: EmptyStateLayout;
}

/**
 * Muted placeholder text shown when a panel has nothing to render. Replaces
 * the many ad-hoc `Empty = styled.div` definitions sprinkled across widgets.
 *
 * `inline` is the default, small vertical padding, sits where it's mounted
 * inside a panel's stack of children. `fill` centres in the available space
 * and is appropriate as a panel's sole child.
 */
export function EmptyState({
  children,
  layout = "inline",
  ...rest
}: EmptyStateProps) {
  return (
    <EmptyState__Body $layout={layout} {...rest}>
      {children}
    </EmptyState__Body>
  );
}

const LAYOUT_STYLES = {
  inline: css`
    /* Horizontal padding matches PanelBody's 16px. The doc above describes
       inline as sitting inside a panel's stack of children, which implied an
       already-padded parent, but Panel is deliberately padding: 0 full-bleed
       and every one of the 15 call sites renders this as a direct Panel
       child. So with no horizontal padding the empty-state text sat flush
       against the panel border everywhere it appeared. Nothing relies on the
       old zero, so there is no double-padding risk. */
    padding: var(--space-8, 8px) var(--space-16, 16px);
  `,
  fill: css`
    /* The padding is inside the 100%, so a fill empty state occupies exactly
       the box it was given. Without this it is 32px wider than its parent and
       the sentence is sliced by the panel edge at small tile sizes. */
    box-sizing: border-box;
    width: 100%;
    height: 100%;
    flex: 1;
    min-height: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    text-align: center;
    padding: var(--space-16, 16px);
  `,
} as const;

const EmptyState__Body = styled.div<{ $layout: EmptyStateLayout }>`
  color: var(--color-text-muted);
  font-size: var(--font-size-sm);
  letter-spacing: 0.04em;

  ${({ $layout }) => LAYOUT_STYLES[$layout]}
`;
