import type { HTMLAttributes, ReactNode } from "react";
import styled, { css } from "styled-components";

/**
 * Where an {@link EmptyState} sits: `inline` where it is mounted, `fill`
 * centred in the available space.
 *
 * @category EmptyState
 */
export type EmptyStateLayout = "inline" | "fill";

/**
 * Props for {@link EmptyState}. Any other `div` attribute passes through.
 *
 * @category EmptyState
 */
export interface EmptyStateProps extends HTMLAttributes<HTMLDivElement> {
  /** The placeholder text. */
  children?: ReactNode;
  /**
   * `inline`, the default, sits where it is mounted with no inset of its own;
   * `fill` centres the text in all the space its container gives it.
   */
  layout?: EmptyStateLayout;
}

/**
 * Muted placeholder text shown when a panel or list has nothing to render.
 *
 * `inline` is the default: it adds no inset of its own and sits where it is
 * mounted, taking the padding of the body or section around it, so it lines up
 * with the content it stands in for. `fill` centres in the available space and
 * suits a panel's sole child.
 *
 * @category EmptyState
 * @categoryDescription EmptyState
 * What a widget shows where there is no content to draw: a placeholder for an
 * empty panel or list, a notice, a spinner while it waits, and the note for a
 * trajectory that is withheld.
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
