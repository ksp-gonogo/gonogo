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
 * `inline` is the default — small vertical padding, sits where it's mounted
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
    padding: 8px 0;
  `,
  fill: css`
    width: 100%;
    height: 100%;
    flex: 1;
    min-height: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    text-align: center;
    padding: 16px;
  `,
} as const;

const EmptyState__Body = styled.div<{ $layout: EmptyStateLayout }>`
  color: var(--color-text-muted);
  font-size: var(--font-size-sm);
  letter-spacing: 0.04em;

  ${({ $layout }) => LAYOUT_STYLES[$layout]}
`;
