import { useEffect } from "react";
import styled, { css } from "styled-components";

interface FabPromptProps {
  /**
   * Distance from the bottom of the viewport in px, when the prompt is
   * rendered standalone. Omit to render in-flow (e.g. as a child of
   * BannerStack) so the parent owns positioning.
   */
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

/**
 * Sausage-shaped action prompt that sits next to a FAB stack. Same
 * height as the FABs from `@ksp-gonogo/ui/Fab`, wider, with a primary
 * tap-target on the left and a small dismiss × on the right.
 *
 * Designed for transient "Switch to X?" suggestions, auto-dismisses
 * after a configurable timeout so a user who never sees it isn't left
 * with a stuck UI element. Uses role="status" + aria-live so screen
 * readers pick it up without interrupting urgent alerts.
 *
 * Positioning is fixed bottom-right when `bottom` is supplied, offset
 * enough to clear a 40px (or 48px coarse-pointer) FAB at the same
 * `bottom`. Omit `bottom` to render in-flow, the prompt becomes a
 * regular flex child and the parent (e.g. `BannerStack`) owns
 * positioning.
 */
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
      <Dismiss
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss"
        title="Dismiss"
      >
        ×
      </Dismiss>
    </Wrap>
  );
}

const Wrap = styled.div<{ $bottom: number | undefined }>`
  ${({ $bottom }) =>
    $bottom !== undefined
      ? css`
          position: fixed;
          bottom: calc(${$bottom}px + env(safe-area-inset-bottom, 0px));
          /* 72 is 24 (Fab's right inset) + 40 (StyledFab width) + 8. Held
             literal with the rest of the FAB-geometry chain, see BannerStack. */
          right: calc(72px + env(safe-area-inset-right, 0px));
          z-index: var(--z-fab);
        `
      : ""}
  height: 40px;
  display: inline-flex;
  align-items: stretch;
  background: var(--color-surface-raised);
  border: 1px solid var(--color-status-info-fg);
  /* Stadium, not a corner: the old 20px was exactly half the 40px height, and
     the coarse block below hand-recomputed it as 24px for its 48px height.
     --radius-pill clamps to half the shorter side either way, so the coarse
     override is gone rather than duplicated. */
  border-radius: var(--radius-pill);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.5);
  overflow: hidden;
  font-family: inherit;
  /* Snapped, not exact: this was 0.18s ease-out. 180ms to 200ms, and
     ease-out to ease (the scale has no ease-out rung). Both moves are inside
     the noise of an 8px slide-and-fade. The entrance recipe
     (--duration-entrance with --ease-entrance) is deliberately NOT used
     here: that pairing is tuned to the 40px banner slide. */
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
    height: 48px;
  }

  @media (prefers-reduced-motion: reduce) {
    animation: none;
  }
`;

const Accept = styled.button`
  appearance: none;
  border: 0;
  background: transparent;
  color: var(--color-status-info-fg);
  font-family: inherit;
  font-size: var(--font-size-sm);
  font-weight: 600;
  letter-spacing: 0.04em;
  padding: 0 var(--space-12);
  cursor: pointer;
  display: inline-flex;
  align-items: center;

  &:hover {
    background: var(--color-border-subtle);
  }

  &:focus-visible {
    outline: 2px solid var(--color-status-info-fg);
    outline-offset: -2px;
  }
`;

const Dismiss = styled.button`
  appearance: none;
  border: 0;
  border-left: 1px solid var(--color-border-subtle);
  background: transparent;
  color: var(--color-text-dim);
  font-family: inherit;
  /* Display tier: the type scale stops at lg (16px). This is a glyph size
     for the × character, not body type, so it stays literal. */
  font-size: 18px;
  line-height: var(--line-height-flush);
  padding: 0 var(--space-12);
  cursor: pointer;
  display: inline-flex;
  align-items: center;

  &:hover {
    background: var(--color-border-subtle);
    color: var(--color-text-primary);
  }

  &:focus-visible {
    outline: 2px solid var(--color-status-info-fg);
    outline-offset: -2px;
  }
`;
