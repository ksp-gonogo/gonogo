import { IconButton, Tooltip } from "@ksp-gonogo/ui-kit";
import { useEffect } from "react";
import styled, { css } from "styled-components";

interface FabPromptProps {
  /** Distance from the viewport bottom in px; omit to render in-flow inside a parent such as BannerStack. */
  bottom?: number;
  /** Main label: what the action will do. */
  label: string;
  /** Tap-target action. */
  onAccept: () => void;
  /** Dismiss without acting. */
  onDismiss: () => void;
  /** ms: auto-dismiss after this long. Default 15000. Set 0 to disable. */
  autoDismissMs?: number;
  /** Optional accessible name for the accept tap target. Falls back to label. */
  acceptLabel?: string;
}

/** Transient action prompt beside the FAB stack, with an accept target and a dismiss button; it auto-dismisses so an unseen prompt never sticks. */
export function FabPrompt({
  bottom,
  label,
  onAccept,
  onDismiss,
  autoDismissMs = 15000,
  acceptLabel,
}: Readonly<FabPromptProps>) {
  useEffect(() => {
    if (autoDismissMs <= 0) return;
    const t = window.setTimeout(onDismiss, autoDismissMs);
    return () => window.clearTimeout(t);
  }, [autoDismissMs, onDismiss]);

  return (
    <Wrap $bottom={bottom} role="status" aria-live="polite">
      <Accept
        type="button"
        onClick={onAccept}
        aria-label={acceptLabel ?? label}
      >
        {label}
      </Accept>
      <Tooltip text="Dismiss">
        <IconButton type="button" onClick={onDismiss} aria-label="Dismiss">
          ×
        </IconButton>
      </Tooltip>
    </Wrap>
  );
}

const Wrap = styled.div<{ $bottom: number | undefined }>`
  ${({ $bottom }) =>
    $bottom !== undefined
      ? css`
          position: fixed;
          bottom: calc(${$bottom}px + env(safe-area-inset-bottom, 0px));
          /* 72 = 24 (the Fab inset) + 40 (its width) + 8, part of the FAB geometry chain. */
          right: calc(72px + env(safe-area-inset-right, 0px));
          z-index: var(--z-fab);
        `
      : ""}
  min-height: 40px;
  display: inline-flex;
  align-items: stretch;
  background: var(--color-surface-raised);
  border: 1px solid var(--color-info-mark);
  /* --radius-pill holds at both the 40px height and the coarse-pointer 48px. */
  border-radius: var(--radius-pill);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.5);
  overflow: hidden;
  font-family: inherit;
  /* Not the entrance recipe: that pairing is tuned to the 40px banner slide. */
  animation: fabPromptIn var(--duration-slow) var(--ease-standard) both;

  @keyframes fabPromptIn {
    from {
      opacity: 0;
      transform: translateX(8px);
    }
    to {
      opacity: 1;
      transform: translateX(0);
    }
  }

  @media (pointer: coarse) {
    min-height: 48px;
  }

  @media (prefers-reduced-motion: reduce) {
    animation: none;
  }
`;

const Accept = styled.button`
  appearance: none;
  border: 0;
  background: transparent;
  color: var(--color-info-text);
  font-family: inherit;
  font-size: var(--font-size-compact);
  font-weight: 600;
  letter-spacing: 0.04em;
  padding: var(--inset-prompt-button);
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  text-align: start;

  &:hover {
    background: var(--color-border-subtle);
  }

  &:focus-visible {
    outline: 2px solid var(--color-info-mark);
    outline-offset: -2px;
  }
`;
