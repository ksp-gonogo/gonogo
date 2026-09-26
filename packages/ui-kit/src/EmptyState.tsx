import type { HTMLAttributes, ReactNode } from "react";
import styled, { css } from "styled-components";

export type EmptyStateLayout = "inline" | "fill";

export interface EmptyStateProps extends HTMLAttributes<HTMLDivElement> {
  children?: ReactNode;
  layout?: EmptyStateLayout;
}

/**
 * Muted placeholder text shown when a panel has nothing to render.
 *
 * `inline` is the default: it adds no inset of its own and sits where it is
 * mounted, taking the padding of the body or section around it, so it lines up
 * with the content it stands in for. `fill` centres in the available space and
 * is appropriate as a panel's sole child.
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
  inline: css``,
  fill: css`
    width: 100%;
    height: 100%;
    flex: 1;
    min-height: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    text-align: center;
    padding: var(--inset-empty-state);
  `,
} as const;

const EmptyState__Body = styled.div<{ $layout: EmptyStateLayout }>`
  color: var(--color-text-muted);
  font-size: var(--font-size-compact);
  letter-spacing: 0.04em;

  ${({ $layout }) => LAYOUT_STYLES[$layout]}
`;
