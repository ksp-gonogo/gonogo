import type { Tone } from "@ksp-gonogo/sitrep-sdk";
import type { HTMLAttributes, ReactNode } from "react";
import styled, { css, keyframes } from "styled-components";
import { TONE_MARK, toneEdge } from "./tone";

export interface StatusIndicatorProps
  extends Omit<HTMLAttributes<HTMLDivElement>, "children"> {
  tone: Tone;
  children: ReactNode;
  /**
   * When true, the indicator becomes a screen-reader live region.
   * Use for state that updates dynamically and the user benefits from
   * being told (connection going from probing to ok or fail). Default
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
 * Coloured dot + one-line status text: dot on the left, free-form label on
 * the right, optional live-region semantics. Use for
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

const StatusIndicator__Row = styled.div<{ "data-tone": Tone }>`
  display: flex;
  align-items: center;
  gap: var(--gap-glyph-box);
  font-size: var(--font-size-compact);
  /* Small, so a wrapped sentence clears the border without pushing a single line past the control height. */
  padding: var(--inset-status-box);
  /* A boxed readout that sits in bars beside controls, so it takes the kit's one control height. */
  min-height: var(--control-height);
  background: var(--color-surface-raised);
  border: 1px solid;
  border-radius: var(--radius-regular);

  border-color: ${({ "data-tone": tone }) => toneEdge(tone)};
`;

const statusPulse = keyframes`
  0%, 100% { opacity: 1; }
  50% { opacity: 0.4; }
`;

const StatusIndicator__Dot = styled.span<{
  "data-tone": Tone;
  $pulse?: "slow" | "fast";
}>`
  width: 8px;
  height: 8px;
  border-radius: var(--radius-circle);
  flex-shrink: 0;

  background: ${({ "data-tone": tone }) => TONE_MARK[tone]};

  /* A looping pulse needs its own reduced-motion guard; the 1s/2s periods encode connection state. */
  ${({ $pulse }) =>
    $pulse
      ? css`
          @media (prefers-reduced-motion: no-preference) {
            animation: ${statusPulse} ${$pulse === "fast" ? "1s" : "2s"}
              var(--ease-emphasis) infinite;
          }
        `
      : ""}
`;

const StatusIndicator__Text = styled.span`
  color: var(--color-text-primary);
  line-height: var(--line-height-body);
`;
