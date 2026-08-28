import styled, { css } from "styled-components";
import { fitBox } from "./fitBox";

export type ReadoutTone = "default" | "go" | "warning" | "alert";

const toneColor = (tone: ReadoutTone | undefined) => {
  switch (tone) {
    case "alert":
      return "var(--color-status-nogo-fg)";
    case "warning":
      return "var(--color-status-warning-bg)";
    case "go":
      return "var(--color-status-go-fg)";
    default:
      return "var(--color-text-primary)";
  }
};

/**
 * Big centred readout: typical "tiny mode" hero element. Fills the remaining
 * panel space and centres a single dominant value (e.g. ΔV, time-to-impact,
 * warp rate). Use `$tone` to colour-code the readout for state-driven widgets.
 *
 * Pair with `<ReadoutCaption>` underneath for an optional sub-label.
 */
export const BigReadout = styled.div<{ $tone?: ReadoutTone }>`
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--space-4, 4px);
  text-align: center;
  /* Both off the type/line-height scales on purpose: the size is fluid rather
     than a rung, and 1.05 is tuned to it. A body line-height clips descenders
     at the top of the clamp. */
  font-size: clamp(20px, 6vw, 38px);
  font-weight: 700;
  letter-spacing: 0.04em;
  line-height: 1.05;
  color: ${({ $tone }) => toneColor($tone)};
  min-width: 0;
`;

/**
 * Smaller-scale variant for "small" responsive modes: same hero treatment
 * but at a compact size. Doesn't fill, sits alongside other content.
 */
export const Readout = styled.div<{ $tone?: ReadoutTone }>`
  display: inline-flex;
  align-items: baseline;
  gap: var(--space-6, 6px);
  /* Display tier: the type scale stops at lg (16px) because everything above
     it in this codebase is a fluid clamp or a JS-computed fit. Stays literal. */
  font-size: 22px;
  font-weight: 700;
  letter-spacing: 0.04em;
  color: ${({ $tone }) => toneColor($tone)};
`;

/** Muted secondary line for both readout sizes (e.g. units, mode tag). */
export const ReadoutCaption = styled.span`
  font-size: var(--font-size-xs);
  font-weight: 400;
  letter-spacing: 0.05em;
  color: var(--color-text-muted);
  text-transform: uppercase;
`;

/**
 * Status pill: single-token badge ("NOMINAL", "GO", "ABORT"). Designed for
 * tiny-mode widgets that boil their state down to one indicator (thermal
 * band, landing hazard grade, gonogo state).
 */
export const StatusPill = styled.div<{ $tone: ReadoutTone }>`
  ${fitBox("status-pill")}
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: var(--space-6, 6px) var(--space-12, 12px);
  border-radius: var(--radius-pill, 999px);
  font-size: var(--font-size-sm);
  font-weight: 700;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: ${({ $tone }) => toneColor($tone)};
  background: ${({ $tone }) => {
    switch ($tone) {
      case "alert":
        return "var(--color-status-alert-muted)";
      case "warning":
        return "var(--color-tag-dark-brown-bg)";
      case "go":
        return "var(--color-surface-raised)";
      default:
        return "var(--color-surface-raised)";
    }
  }};
  border: 1px solid
    ${({ $tone }) => {
      switch ($tone) {
        case "alert":
          return "var(--color-status-nogo-bg)";
        case "warning":
          return "var(--color-status-warning-bg)";
        case "go":
          return "var(--color-status-go-bg)";
        default:
          return "var(--color-border-subtle)";
      }
    }};
  ${({ $tone }) =>
    $tone === "alert" &&
    css`
      @media (prefers-reduced-motion: no-preference) {
        animation: pill-pulse 1.4s var(--ease-emphasis, ease-in-out) infinite;
      }
      @keyframes pill-pulse {
        0%,
        100% {
          opacity: 1;
        }
        50% {
          opacity: 0.7;
        }
      }
    `}
`;
