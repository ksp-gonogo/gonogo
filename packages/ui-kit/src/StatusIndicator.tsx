import type { HTMLAttributes, ReactNode } from "react";
import styled, { css, keyframes } from "styled-components";

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
  /**
   * Pulse the dot to signal an active, changing state (e.g. a live/connecting
   * data source). `"slow"` (2s) reads as steady-live, `"fast"` (1s) as
   * working/reconnecting. Omit for a static dot. Guarded by
   * `prefers-reduced-motion` (the dot holds still when the user opts out).
   */
  pulse?: "slow" | "fast";
}

/**
 * Coloured dot + one-line status text. Tone maps to the same palette
 * as `Badge` but the layout is different: dot on the left, free-form
 * label on the right, optional live-region semantics. Use for
 * "connection status," "TURN reachability," "data source health"
 * surfaces: anywhere a single sentence describes a state and a glance
 * at the dot tells you whether to worry.
 *
 * Sister primitive: `Badge`. Use `Badge` for compact uppercase pills,
 * `StatusIndicator` for sentence-length state with a leading dot.
 */
export function StatusIndicator({
  tone,
  children,
  live = false,
  pulse,
  ...rest
}: StatusIndicatorProps) {
  const liveAttrs = live
    ? { role: "status" as const, "aria-live": "polite" as const }
    : {};
  return (
    <StatusIndicator__Row data-tone={tone} {...liveAttrs} {...rest}>
      <StatusIndicator__Dot
        data-tone={tone}
        $pulse={pulse}
        aria-hidden="true"
      />
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
  gap: var(--space-8, 8px);
  font-size: var(--font-size-xs);
  padding: var(--space-6, 6px) var(--space-8, 8px);
  /* A readout, but a BOXED one, and it sits in bars next to the controls it has
     to line up with (the radio bar puts one between a mute and a talk key). The
     kit's one control height, see --control-height. */
  min-height: var(--control-height, 28px);
  background: var(--color-surface-raised);
  border: 1px solid;
  border-radius: var(--radius-sm, 3px);

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

const statusPulse = keyframes`
  0%, 100% { opacity: 1; }
  50% { opacity: 0.4; }
`;

const StatusIndicator__Dot = styled.span<{
  "data-tone": StatusTone;
  $pulse?: "slow" | "fast";
}>`
  width: 8px;
  height: 8px;
  border-radius: var(--radius-circle, 50%);
  flex-shrink: 0;

  ${({ "data-tone": tone }) => TONE_DOT[tone]}

  /* Indefinite animation needs its own reduced-motion guard: the global
     damper only clamps duration, it does not stop a looping pulse. The
     1s/2s periods are literal because they read as connection state
     (fast = reconnecting/working, slow = steady-live), not a motion choice. */
  ${({ $pulse }) =>
    $pulse
      ? css`
          @media (prefers-reduced-motion: no-preference) {
            animation: ${statusPulse} ${$pulse === "fast" ? "1s" : "2s"}
              var(--ease-emphasis, ease-in-out) infinite;
          }
        `
      : ""}
`;

const StatusIndicator__Text = styled.span`
  color: var(--color-text-primary);
  line-height: var(--line-height-body, 1.4);
`;
