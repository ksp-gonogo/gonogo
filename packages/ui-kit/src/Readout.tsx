import styled, { css } from "styled-components";

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
 * Big centred readout — typical "tiny mode" hero element. Fills the remaining
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
  gap: 4px;
  text-align: center;
  font-size: clamp(20px, 6vw, 38px);
  font-weight: 700;
  letter-spacing: 0.04em;
  line-height: 1.05;
  color: ${({ $tone }) => toneColor($tone)};
  min-width: 0;
`;

/**
 * Smaller-scale variant for "small" responsive modes — same hero treatment
 * but at a compact size. Doesn't fill — sits alongside other content.
 */
export const Readout = styled.div<{ $tone?: ReadoutTone }>`
  display: inline-flex;
  align-items: baseline;
  gap: 6px;
  font-size: 22px;
  font-weight: 700;
  letter-spacing: 0.04em;
  color: ${({ $tone }) => toneColor($tone)};
`;

/** Muted secondary line for both readout sizes (e.g. units, mode tag). */
export const ReadoutCaption = styled.span`
  font-size: 11px;
  font-weight: 400;
  letter-spacing: 0.05em;
  color: var(--color-text-muted);
  text-transform: uppercase;
`;

/**
 * Status pill — single-token badge ("NOMINAL", "GO", "ABORT"). Designed for
 * tiny-mode widgets that boil their state down to one indicator (thermal
 * band, ground-survey grade, gonogo state).
 */
export const StatusPill = styled.div<{ $tone: ReadoutTone }>`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 6px 14px;
  border-radius: 999px;
  font-size: 12px;
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
        animation: pill-pulse 1.4s ease-in-out infinite;
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
