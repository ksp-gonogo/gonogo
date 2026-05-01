import type { HTMLAttributes, ReactNode } from "react";
import styled, { css } from "styled-components";

export type BadgeTone = "neutral" | "go" | "nogo" | "warn" | "info";
export type BadgeSize = "sm" | "md";

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: BadgeTone;
  size?: BadgeSize;
  children: ReactNode;
}

/**
 * Compact label/state pill. Replaces ad-hoc styled spans (e.g. AlarmsModal's
 * `KindBadge` and `StateTag`) so widgets get a consistent typographic and
 * colour treatment.
 *
 * For tagged categories with their own bespoke palette (`telemetry`, `kos`,
 * etc.) prefer the existing `Tag` primitive — `Badge` is for state colour
 * (go/nogo/warn/info/neutral).
 */
export function Badge({
  tone = "neutral",
  size = "md",
  children,
  ...rest
}: BadgeProps) {
  return (
    <Badge__Body $tone={tone} $size={size} {...rest}>
      {children}
    </Badge__Body>
  );
}

const TONE_STYLES = {
  neutral: css`
    background: var(--color-surface-raised);
    border-color: var(--color-border-subtle);
    color: var(--color-text-muted);
  `,
  go: css`
    background: var(--color-status-go-bg);
    border-color: var(--color-status-go-bg);
    color: var(--color-status-go-fg);
  `,
  nogo: css`
    background: var(--color-status-nogo-bg);
    border-color: var(--color-status-nogo-bg);
    color: var(--color-status-nogo-fg);
  `,
  warn: css`
    background: var(--color-status-warning-bg);
    border-color: var(--color-status-warning-bg);
    color: var(--color-status-warning-fg);
  `,
  info: css`
    background: var(--color-status-info-bg);
    border-color: var(--color-status-info-bg);
    color: var(--color-status-info-fg);
  `,
} as const;

const SIZE_STYLES = {
  sm: css`
    font-size: 10px;
    padding: 1px 4px;
  `,
  md: css`
    font-size: var(--font-size-xs);
    padding: 1px 6px;
  `,
} as const;

const Badge__Body = styled.span<{ $tone: BadgeTone; $size: BadgeSize }>`
  display: inline-block;
  border: 1px solid;
  border-radius: 3px;
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  white-space: nowrap;

  ${({ $size }) => SIZE_STYLES[$size]}
  ${({ $tone }) => TONE_STYLES[$tone]}
`;
