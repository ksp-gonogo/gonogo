import type { HTMLAttributes, ReactNode } from "react";
import styled, { css } from "styled-components";

export type StatusTone = "neutral" | "info" | "go" | "warn" | "nogo";

export interface StatusIndicatorProps
  extends Omit<HTMLAttributes<HTMLDivElement>, "children"> {
  tone: StatusTone;
  children: ReactNode;
  /**
   * When true, the indicator becomes a screen-reader live region.
   * Use for state that updates dynamically and the user benefits from
   * being told (connection going from probing → ok / fail). Default
   * false to keep it out of the accessibility tree for purely decorative
   * uses.
   */
  live?: boolean;
}

/**
 * Coloured dot + one-line status text. Tone maps to the same palette
 * as `Badge` but the layout is different: dot on the left, free-form
 * label on the right, optional live-region semantics. Use for
 * "connection status," "TURN reachability," "data source health"
 * surfaces — anywhere a single sentence describes a state and a glance
 * at the dot tells you whether to worry.
 *
 * Sister primitive: `Badge`. Use `Badge` for compact uppercase pills,
 * `StatusIndicator` for sentence-length state with a leading dot.
 */
export function StatusIndicator({
  tone,
  children,
  live = false,
  ...rest
}: StatusIndicatorProps) {
  const liveAttrs = live
    ? { role: "status" as const, "aria-live": "polite" as const }
    : {};
  return (
    <StatusIndicator__Row data-tone={tone} {...liveAttrs} {...rest}>
      <StatusIndicator__Dot data-tone={tone} aria-hidden="true" />
      <StatusIndicator__Text>{children}</StatusIndicator__Text>
    </StatusIndicator__Row>
  );
}

const TONE_BORDER = {
  neutral: css`
    border-color: var(--color-border-subtle);
  `,
  info: css`
    border-color: var(--color-status-info-bg);
  `,
  go: css`
    border-color: var(--color-status-go-bg);
  `,
  warn: css`
    border-color: var(--color-status-warning-bg);
  `,
  nogo: css`
    border-color: var(--color-status-nogo-bg);
  `,
} as const;

const StatusIndicator__Row = styled.div<{ "data-tone": StatusTone }>`
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 11px;
  padding: 6px 8px;
  background: var(--color-surface-raised);
  border: 1px solid;
  border-radius: 3px;

  ${({ "data-tone": tone }) => TONE_BORDER[tone]}
`;

const TONE_DOT = {
  neutral: css`
    background: var(--color-text-dim);
  `,
  info: css`
    background: var(--color-status-info-bg);
  `,
  go: css`
    background: var(--color-status-go-bg);
  `,
  warn: css`
    background: var(--color-status-warning-bg);
  `,
  nogo: css`
    background: var(--color-status-nogo-bg);
  `,
} as const;

const StatusIndicator__Dot = styled.span<{ "data-tone": StatusTone }>`
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;

  ${({ "data-tone": tone }) => TONE_DOT[tone]}
`;

const StatusIndicator__Text = styled.span`
  color: var(--color-text-primary);
  line-height: 1.4;
`;
