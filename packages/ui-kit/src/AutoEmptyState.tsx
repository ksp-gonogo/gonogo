import type { HTMLAttributes, ReactNode } from "react";
import styled from "styled-components";
import { GAP_VAR, type GapToken } from "./scales";

/**
 * Props for {@link AutoEmptyState}. Any other `div` attribute passes through
 * to the content region.
 *
 * @category EmptyState
 */
export interface AutoEmptyStateProps extends HTMLAttributes<HTMLDivElement> {
  /**
   * Shown while the content region renders no DOM nodes at all, for example
   * when every augment bound to a slot returned `null`. The switch is pure
   * CSS, so the caller never inspects what its children rendered.
   */
  fallback: ReactNode;
  /** Gap between rendered children. Defaults to `related-dense`. */
  gap?: GapToken;
  children?: ReactNode;
}

/**
 * A content region (a vertical flex column) followed by a fallback that hides
 * itself once the region has rendered anything. Use it where a frame owns the
 * fallback but its content comes from augments or other children it cannot
 * inspect. It never scrolls on its own; the panel body it sits in scrolls.
 *
 * @example
 * ```tsx
 * // Each SensorRow renders null for a sensor that is switched off.
 * <AutoEmptyState fallback={<EmptyState>No sensors active</EmptyState>}>
 *   {sensors.map((s) => (
 *     <SensorRow key={s.id} sensor={s} />
 *   ))}
 * </AutoEmptyState>
 * ```
 *
 * @category EmptyState
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
`;

const AutoEmptyState__Fallback = styled.div`
  ${AutoEmptyState__Content}:not(:empty) + & {
    display: none;
  }
`;
